import { Injectable } from '@nestjs/common';
import type { AccesoEmpresas } from '../auth/principal.js';
import { ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import {
  ACCIONES_RECLAMO,
  TIPOS_RECLAMO_DTE,
  type ReferenciaDocumentoReclamo,
  type RespuestaCedible,
  type RespuestaEventos,
  type RespuestaFechaRecepcion,
  type RespuestaRegistroReclamo,
} from '../sii-gateway/index.js';
import { DteRecibido, type RegistroSii } from './entities/dte-recibido.entity.js';
import { plazoDeReclamo, plazoVencido } from './plazo.js';
import type { AccionSiiDto } from './recepcion.dto.js';
import { aRespuestaDteRecibido, type DteRecibidoRespuesta, RecepcionService } from './recepcion.service.js';

export interface ResultadoRegistroSii {
  dte: DteRecibidoRespuesta;
  accion: AccionSiiDto;
  glosaAccion: string;
  sii: { codigo: number; descripcion: string };
}

export interface ResultadoConsultaSii {
  dte: DteRecibidoRespuesta;
  sii: {
    eventos: RespuestaEventos;
    fechaRecepcion: RespuestaFechaRecepcion;
    cedible: RespuestaCedible;
  };
  /** `true` si el plazo de reclamo se recalculó con la fecha real de recepción en el SII. */
  plazoActualizado: boolean;
}

/**
 * Códigos de `ingresarAceptacionReclamoDoc` que no son éxito, con el estado HTTP y el código de error de la API.
 * (PDF "Registro de Aceptación/Reclamo de DTE" v1.1.) Los no listados se informan como 502.
 */
const ERRORES_REGISTRO: Record<number, { status: number; code: string }> = {
  1: { status: 422, code: 'SII_DATOS_INVALIDOS' }, // Rut emisor erróneo
  2: { status: 422, code: 'SII_DATOS_INVALIDOS' }, // Folio erróneo
  3: { status: 422, code: 'SII_DATOS_INVALIDOS' }, // Tipo de documento no corresponde
  4: { status: 422, code: 'SII_DATOS_INVALIDOS' }, // Acción inválida
  5: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // DTE ya reclamado
  6: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // No se puede acusar recibo de DTE reclamado
  7: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // Evento registrado previamente
  8: { status: 422, code: 'PLAZO_VENCIDO' }, // Pasados 8 días desde la recepción
  9: { status: 422, code: 'SII_DOCUMENTO_NO_REGISTRADO' },
  10: { status: 422, code: 'SII_DOCUMENTO_NO_REGISTRADO' }, // No emitido/recibido en el SII desde 14-01-2017
  11: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // No se puede reclamar DTE aceptado
  12: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // No se puede aceptar DTE rechazado
  13: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // No se puede reclamar DTE con recibo de mercaderías
  14: { status: 422, code: 'SII_ACCION_NO_AUTORIZADA' }, // Solo empresa receptora o emisora
  17: { status: 422, code: 'SII_ACCION_NO_AUTORIZADA' }, // Solo empresa receptora
  18: { status: 422, code: 'SII_DOCUMENTO_NO_REGISTRADO' }, // Documento no ha sido recibido
  19: { status: 409, code: 'SII_REGISTRO_CONFLICTO' }, // Reclamo de mercaderías ya realizado
};

/**
 * Registro de aceptación o reclamo de un DTE recibido ante el SII (Ley 20.956, web service
 * `RegistroReclamoDTE`) y consulta de su historial y de la fecha de recepción que fija el plazo de 8 días.
 */
@Injectable()
export class RegistroSiiService {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly recepcion: RecepcionService,
    private readonly sii: SiiClienteFactory,
  ) {}

  async registrar(id: string, accion: AccionSiiDto, acceso: AccesoEmpresas): Promise<ResultadoRegistroSii> {
    const { dte, empresa } = await this.recepcion.obtenerDte(id, acceso);
    exigirTipoSoportado(dte.tipoDte);
    // Pasados los 8 días el SII no admite ningún evento (tampoco ERM; PDF v1.1, validación 2): se evita la llamada.
    if (plazoVencido(dte.plazoReclamoHasta)) {
      throw plazoVencidoProblema(dte);
    }
    const clientes = await this.sii.paraEmpresa(empresa);
    const r = await clientes.reclamo.ingresarAceptacionReclamo(referencia(dte), accion);

    const registro: RegistroSii = dte.registroSii ?? { acciones: [] };
    registro.acciones.push({ accion, codigo: r.codigo, descripcion: r.descripcion, exito: r.exito, en: new Date().toISOString() });
    await this.ejecutor.ejecutar((em) =>
      em.update(
        DteRecibido,
        { id },
        {
          registroSii: registro,
          ...(r.exito && accion === 'ERM' ? { acuseReciboMercaderias: true } : {}),
          // El SII dice que el plazo ya venció: se deja de estimar y se bloquean nuevos intentos.
          ...(r.codigo === 8 ? { plazoReclamoHasta: new Date(), plazoConfirmadoSii: true } : {}),
        },
      ),
    );
    if (!r.exito) throw errorDeRegistro(r, dte);
    const actualizado = await this.recepcion.obtenerDte(id, acceso);
    return {
      dte: aRespuestaDteRecibido(actualizado.dte, `${empresa.rut}-${empresa.dv}`),
      accion,
      glosaAccion: ACCIONES_RECLAMO[accion],
      sii: { codigo: r.codigo, descripcion: r.descripcion },
    };
  }

  /**
   * Consulta al SII los eventos del documento, su fecha de recepción y si es cedible. Con la fecha real
   * recalcula `plazo_reclamo_hasta` (8 días corridos desde la recepción en el SII).
   */
  async consultar(id: string, acceso: AccesoEmpresas): Promise<ResultadoConsultaSii> {
    const { dte, empresa } = await this.recepcion.obtenerDte(id, acceso);
    exigirTipoSoportado(dte.tipoDte);
    const clientes = await this.sii.paraEmpresa(empresa);
    const ref = referencia(dte);
    const eventos = await clientes.reclamo.listarEventos(ref);
    const fechaRecepcion = await clientes.reclamo.consultarFechaRecepcion(ref);
    const cedible = await clientes.reclamo.consultarDocDteCedible(ref);

    const registro: RegistroSii = dte.registroSii ?? { acciones: [] };
    registro.eventos = eventos.eventos.map((e) => ({
      codigo: e.codigo,
      descripcion: e.descripcion,
      rutResponsable: `${e.rutResponsable}-${e.dvResponsable}`,
      fecha: e.fecha?.toISOString() ?? e.fechaTexto,
    }));
    registro.consultadoEn = new Date().toISOString();
    registro.cedible = { codigo: cedible.codigo, descripcion: cedible.descripcion, cedible: cedible.cedible };
    registro.fechaRecepcionTexto = fechaRecepcion.texto;

    const cambios: Partial<DteRecibido> = { registroSii: registro };
    let plazoActualizado = false;
    if (fechaRecepcion.fecha) {
      const plazo = plazoDeReclamo(new Date(), fechaRecepcion.fecha);
      cambios.fechaRecepcionSii = fechaRecepcion.fecha;
      cambios.plazoReclamoHasta = plazo.hasta;
      cambios.plazoConfirmadoSii = true;
      plazoActualizado = true;
    }
    if (eventos.eventos.some((e) => e.codigo === 'ERM')) cambios.acuseReciboMercaderias = true;
    await this.ejecutor.ejecutar((em) => em.update(DteRecibido, { id }, cambios));

    const actualizado = await this.recepcion.obtenerDte(id, acceso);
    return {
      dte: aRespuestaDteRecibido(actualizado.dte, `${empresa.rut}-${empresa.dv}`),
      sii: { eventos, fechaRecepcion, cedible },
      plazoActualizado,
    };
  }
}

function referencia(dte: DteRecibido): ReferenciaDocumentoReclamo {
  return { rutEmisor: dte.rutEmisor, dvEmisor: dte.dvEmisor, tipoDoc: dte.tipoDte, folio: dte.folio };
}

function exigirTipoSoportado(tipo: number): void {
  if (!TIPOS_RECLAMO_DTE.includes(tipo)) {
    throw new ProblemaHttp(
      422,
      'TIPO_NO_ADMITIDO',
      'Tipo sin registro ante el SII',
      `El servicio de aceptación/reclamo del SII solo opera sobre los tipos ${TIPOS_RECLAMO_DTE.join(', ')} (el DTE es ${tipo})`,
    );
  }
}

function plazoVencidoProblema(dte: DteRecibido): ProblemaHttp {
  return new ProblemaHttp(
    422,
    'PLAZO_VENCIDO',
    'Plazo de reclamo vencido',
    `Pasaron los 8 días corridos desde la recepción (plazo hasta ${dte.plazoReclamoHasta.toISOString()}${dte.plazoConfirmadoSii ? '' : ', estimado con la fecha de recepción propia'}); el SII no admite más aceptaciones, reclamos ni recibos`,
  );
}

function errorDeRegistro(r: RespuestaRegistroReclamo, dte: DteRecibido): ProblemaHttp {
  if (r.codigo === 8) return plazoVencidoProblema(dte);
  const mapeo = ERRORES_REGISTRO[r.codigo] ?? { status: 502, code: 'SII_ERROR' };
  return new ProblemaHttp(mapeo.status, mapeo.code, 'El SII no registró la acción', `SII (${r.codigo}): ${r.descripcion}`);
}
