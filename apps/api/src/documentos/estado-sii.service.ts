import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { AccesoEmpresas } from '../auth/principal.js';
import { aProblema } from '../comun/problem.filter.js';
import { ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { EnvioDocumento } from '../envios/entities/envio-documento.entity.js';
import { type ClientesSii, SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import {
  type AmbienteSii,
  clasificarEstadoDte,
  SiiError,
  SiiLimiteExcedidoError,
  SiiRedError,
  SiiServidorError,
} from '../sii-gateway/index.js';
import type { ConsultarEstadosDto } from './documentos.dto.js';
import { DocumentosService } from './documentos.service.js';
import { Documento } from './entities/documento.entity.js';
import { esErrorDeConsulta, ESTADOS_CONSULTABLES, mapearEstadoSii } from './estado-sii.js';

/** Máximo de consultas simultáneas al SII dentro de un lote. */
export const CONCURRENCIA_LOTE = 3;
export const LIMITE_LOTE_POR_DEFECTO = 50;
export const LIMITE_LOTE_MAXIMO = 200;

export interface ResultadoConsultaEstado {
  documento: Documento;
  /** RUT de la empresa emisora, `76086428-5`. */
  rutEmpresa: string;
  estadoAnterior: string;
  estadoSii: string;
  glosaSii: string;
  esFinal: boolean;
  descripcionEstado: string;
  advertencia?: string;
}

export interface ItemLoteEstado {
  documentoId: string;
  tipoDte: number | null;
  folio: number | null;
  ok: boolean;
  estadoAnterior: string | null;
  estado: string | null;
  estadoSii: string | null;
  glosaSii: string | null;
  esFinal: boolean | null;
  advertencia?: string;
  error?: { code: string; detail: string };
}

export interface RespuestaLoteEstado {
  total: number;
  consultados: number;
  conError: number;
  resultados: ItemLoteEstado[];
}

export type ConsultaDocumento =
  | { resultado: ResultadoConsultaEstado; error?: undefined }
  | { resultado?: undefined; error: { code: string; detail: string } };

/** Entrega los clientes del SII por ambiente, creándolos una sola vez (descifrar el PFX es lento). */
export type ProveedorClientes = (ambiente: AmbienteSii) => Promise<ClientesSii>;

/** `2026-11-18` -> `18112026` (separador vacío) o `18-11-2026`. */
const diaMesAnio = (iso: string, separador: string): string => {
  const [a, m, d] = iso.split('-');
  return `${d}${separador}${m}${separador}${a}`;
};

/** Red caída, SII con error 5xx o límite de tasa: 503 (reintentable); el resto de fallas del SII: 502. */
function aErrorSii(e: unknown): unknown {
  if (e instanceof ProblemaHttp || !(e instanceof SiiError)) return e;
  const reintentable =
    e instanceof SiiRedError || e instanceof SiiServidorError || e instanceof SiiLimiteExcedidoError;
  return new ProblemaHttp(
    reintentable ? 503 : 502,
    reintentable ? 'SII_NO_DISPONIBLE' : 'SII_CONSULTA_ERROR',
    reintentable ? 'SII no disponible' : 'Error en la consulta al SII',
    e.message,
  );
}

function itemError(
  documentoId: string,
  documento: Documento | null,
  code: string,
  detail: string,
): ItemLoteEstado {
  return {
    documentoId,
    tipoDte: documento?.tipoDte ?? null,
    folio: documento?.folio ?? null,
    ok: false,
    estadoAnterior: documento?.estado ?? null,
    estado: documento?.estado ?? null,
    estadoSii: null,
    glosaSii: null,
    esFinal: null,
    error: { code, detail },
  };
}

@Injectable()
export class EstadoSiiService {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly documentos: DocumentosService,
    private readonly sii: SiiClienteFactory,
  ) {}

  /** Clientes del SII de la empresa, memoizados por ambiente. */
  proveedorClientes(empresa: Empresa): ProveedorClientes {
    const cache = new Map<AmbienteSii, Promise<ClientesSii>>();
    return (ambiente) => {
      let p = cache.get(ambiente);
      if (!p) {
        p = this.sii.paraEmpresa(empresa, ambiente);
        cache.set(ambiente, p);
      }
      return p;
    };
  }

  /** Consulta el estado de un documento al SII y lo aplica. 404 si es de otra empresa; 409 si no se envió. */
  async consultarEstadoDocumento(
    id: string,
    acceso: AccesoEmpresas,
  ): Promise<ResultadoConsultaEstado> {
    const { documento, empresa } = await this.documentos.obtener(id, acceso);
    this.exigirEnviado(documento);
    return this.consultarYAplicar(documento, empresa, this.proveedorClientes(empresa));
  }

  /**
   * Consulta en lote los documentos `enviado` de la empresa (o los indicados), con concurrencia baja.
   * Un fallo en un documento se informa en su ítem y no aborta el lote.
   */
  async consultarLote(rutEmpresa: string, dto: ConsultarEstadosDto): Promise<RespuestaLoteEstado> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const limite = Math.min(dto.limite ?? LIMITE_LOTE_POR_DEFECTO, LIMITE_LOTE_MAXIMO);
    const ids = dto.documentoIds;

    const docs = await this.ejecutor.ejecutar((em) =>
      ids
        ? em.getRepository(Documento).find({ where: { id: In(ids), empresaId: empresa.id } })
        : em.getRepository(Documento).find({
            where: { empresaId: empresa.id, estado: 'enviado' },
            order: { creadoEn: 'ASC' },
            take: limite,
          }),
    );

    const items: Array<ItemLoteEstado | Documento> = [];
    if (ids) {
      const porId = new Map(docs.map((d) => [d.id, d] as const));
      for (const id of ids) {
        items.push(
          porId.get(id) ??
            itemError(id, null, 'NO_ENCONTRADO', `El documento ${id} no existe para la empresa`),
        );
      }
    } else {
      items.push(...docs);
    }

    const aConsultar = items.filter((x): x is Documento => x instanceof Documento);
    const consultas = await this.consultarVarios(aConsultar, empresa, this.proveedorClientes(empresa));
    const resultados = items.map((item): ItemLoteEstado => {
      if (!(item instanceof Documento)) return item;
      const c = consultas.get(item.id);
      if (!c || c.error) {
        return itemError(item.id, item, c?.error.code ?? 'ERROR_INTERNO', c?.error.detail ?? '');
      }
      const r = c.resultado;
      return {
        documentoId: item.id,
        tipoDte: item.tipoDte,
        folio: item.folio,
        ok: true,
        estadoAnterior: r.estadoAnterior,
        estado: r.documento.estado,
        estadoSii: r.estadoSii,
        glosaSii: r.glosaSii,
        esFinal: r.esFinal,
        ...(r.advertencia ? { advertencia: r.advertencia } : {}),
      };
    });

    const conError = resultados.filter((r) => !r.ok).length;
    return {
      total: resultados.length,
      consultados: resultados.length - conError,
      conError,
      resultados,
    };
  }

  /**
   * Consulta varios documentos con como máximo `CONCURRENCIA_LOTE` llamadas simultáneas al SII.
   * Nunca lanza por un documento: cada uno queda con su `resultado` o su `error`.
   */
  async consultarVarios(
    docs: Documento[],
    empresa: Empresa,
    clientes: ProveedorClientes,
    ambiente?: AmbienteSii,
  ): Promise<Map<string, ConsultaDocumento>> {
    const salida = new Map<string, ConsultaDocumento>();
    let siguiente = 0;
    const trabajador = async () => {
      for (;;) {
        const doc = docs[siguiente++];
        if (!doc) return;
        try {
          this.exigirEnviado(doc);
          salida.set(doc.id, {
            resultado: await this.consultarYAplicar(doc, empresa, clientes, ambiente),
          });
        } catch (e) {
          const p = aProblema(e);
          salida.set(doc.id, { error: { code: p.code, detail: p.detail } });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCIA_LOTE, docs.length) }, () => trabajador()),
    );
    return salida;
  }

  /** 409 si el documento aún no salió en un envío al SII. */
  exigirEnviado(documento: Documento): void {
    if (!ESTADOS_CONSULTABLES.has(documento.estado)) {
      throw new ProblemaHttp(
        409,
        'ESTADO_INVALIDO',
        'Estado inválido',
        `El documento ${documento.tipoDte}-${documento.folio} está ${documento.estado}: solo se consulta el estado de documentos ya enviados al SII (use POST /v1/empresas/{rut}/envios)`,
      );
    }
  }

  /**
   * Consulta al SII (getEstDte o estado de boleta según el tipo) y, si la respuesta es un estado
   * válido, guarda `estado_sii`/`glosa_sii`/`consultado_sii_en` y aplica el mapeo al `estado`. Si el
   * SII devuelve un error de consulta o la llamada falla, lanza y NO modifica nada.
   *
   * `ambiente`: el del envío que llevó el documento; por defecto el del último envío del documento
   * o, si no hay, el de la empresa.
   */
  async consultarYAplicar(
    documento: Documento,
    empresa: Empresa,
    clientes: ProveedorClientes,
    ambiente?: AmbienteSii,
  ): Promise<ResultadoConsultaEstado> {
    const amb = ambiente ?? (await this.ambienteDe(documento.id)) ?? empresa.ambienteSii;
    const c = await clientes(amb);
    const esBoleta = documento.tipoDte === 39 || documento.tipoDte === 41;
    const rutReceptor = documento.rutReceptor ?? 66666666;
    const dvReceptor = documento.dvReceptor ?? '6';

    let codigo: string;
    let glosa: string;
    let resumen: Record<string, unknown>;
    try {
      if (esBoleta) {
        const r = await c.boleta.consultarEstadoBoleta({
          tipo: documento.tipoDte,
          folio: documento.folio,
          rutReceptor,
          dvReceptor,
          monto: documento.montoTotal,
          fechaEmision: diaMesAnio(documento.fechaEmision, '-'),
        });
        codigo = String(r.codigo ?? '').trim().toUpperCase();
        glosa = r.descripcion ?? '';
        resumen = { canal: 'boleta', codigo: r.codigo, descripcion: r.descripcion };
      } else {
        const r = await c.dte.consultarEstadoDte({
          rutEmisor: empresa.rut,
          dvEmisor: empresa.dv,
          rutReceptor,
          dvReceptor,
          tipoDte: documento.tipoDte,
          folio: documento.folio,
          fechaEmision: diaMesAnio(documento.fechaEmision, ''),
          monto: documento.montoTotal,
        });
        codigo = r.estado.trim().toUpperCase();
        const h = r.cabecera;
        const texto = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
        glosa = texto(h['GLOSA_ERR']) || texto(h['GLOSA_ESTADO']) || r.glosa.trim();
        resumen = { canal: 'dte', estado: r.estado, glosa: r.glosa, cabecera: h };
      }
    } catch (e) {
      throw aErrorSii(e);
    }

    if (esErrorDeConsulta(codigo)) {
      throw new ProblemaHttp(
        502,
        'SII_CONSULTA_ERROR',
        'Error en la consulta al SII',
        `El SII respondió ${codigo || '(sin estado)'}: ${clasificarEstadoDte(codigo).descripcionEstado}${glosa ? ` (${glosa})` : ''}`,
      );
    }

    const { descripcionEstado, esFinal } = clasificarEstadoDte(codigo);
    const glosaSii = glosa || descripcionEstado;

    // Se vuelve a leer con bloqueo y el mapeo se calcula sobre el estado vigente: otra consulta o
    // la consulta del envío pudieron cambiarlo mientras se esperaba al SII.
    const { actualizado, estadoAnterior, mapeo } = await this.ejecutor.ejecutar(async (em) => {
      const fresco = await em.getRepository(Documento).findOneOrFail({
        where: { id: documento.id },
        lock: { mode: 'pessimistic_write' },
      });
      const previo = fresco.estado;
      const m = mapearEstadoSii(codigo, previo);
      await em.update(
        Documento,
        { id: fresco.id },
        {
          estadoSii: codigo,
          glosaSii,
          consultadoSiiEn: new Date(),
          respuestaEstadoSii: resumen,
          ...(m.estado ? { estado: m.estado } : {}),
        },
      );
      return {
        actualizado: await em.getRepository(Documento).findOneOrFail({ where: { id: fresco.id } }),
        estadoAnterior: previo,
        mapeo: m,
      };
    });

    return {
      documento: actualizado,
      rutEmpresa: `${empresa.rut}-${empresa.dv}`,
      estadoAnterior,
      estadoSii: codigo,
      glosaSii,
      esFinal,
      descripcionEstado,
      ...(mapeo.advertencia ? { advertencia: mapeo.advertencia } : {}),
    };
  }

  /** Ambiente del último envío que incluyó el documento. */
  private async ambienteDe(documentoId: string): Promise<AmbienteSii | null> {
    const fila = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioDocumento).findOne({
        where: { documentoId },
        relations: { envio: true },
        order: { envio: { creadoEn: 'DESC' } },
      }),
    );
    return fila?.envio?.ambienteSii ?? null;
  }
}
