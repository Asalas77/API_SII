import { Injectable, Logger } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { AccesoEmpresas } from '../auth/principal.js';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { aIso88591, formatearRut, validarXsd } from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import {
  construirEnvioRecibos,
  construirResultadoDte,
  EstadoDte,
  TIPOS_RECIBO,
  type EstadoDteCodigo,
  type RespuestaConstruida,
} from '../intercambio/index.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { BuzonService } from './correo/buzon.service.js';
import {
  DteRecibido,
  type EstadoComercialDte,
} from './entities/dte-recibido.entity.js';
import { EnvioRecibido } from './entities/envio-recibido.entity.js';
import type {
  AceptarDto,
  RechazarDto,
  ReciboMercaderiasDto,
} from './recepcion.dto.js';
import {
  aRespuestaDteRecibido,
  type DteRecibidoRespuesta,
  RecepcionService,
} from './recepcion.service.js';

export interface RespuestaGenerada {
  dte: DteRecibidoRespuesta;
  respuesta: {
    tipo: 'ResultadoDTE' | 'EnvioRecibos';
    /** XML firmado (sin declaración XML; la descarga lo entrega en ISO-8859-1). */
    xml: string;
    descarga: string;
  };
  correo: {
    solicitado: boolean;
    enviado: boolean;
    destinatario: string | null;
    error: string | null;
  };
}

interface OpcionesCorreo {
  enviarCorreo?: boolean;
  destinatario?: string;
}

/**
 * Respuestas comerciales a un DTE recibido: `ResultadoDTE` (aceptación o rechazo) y `EnvioRecibos`
 * (recibo de mercaderías, Ley 19.983), firmadas con el certificado de la empresa y, si se pide, enviadas
 * por SMTP al emisor.
 */
@Injectable()
export class RespuestasService {
  private readonly log = new Logger(RespuestasService.name);

  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly recepcion: RecepcionService,
    private readonly sii: SiiClienteFactory,
    private readonly buzon: BuzonService,
  ) {}

  async aceptar(
    id: string,
    dto: AceptarDto,
    acceso: AccesoEmpresas,
  ): Promise<RespuestaGenerada> {
    const estado = dto.reparos
      ? EstadoDte.ACEPTADO_CON_DISCREPANCIAS
      : EstadoDte.ACEPTADO;
    return this.resultadoComercial(
      id,
      estado,
      dto.glosa,
      undefined,
      dto,
      acceso,
    );
  }

  async rechazar(
    id: string,
    dto: RechazarDto,
    acceso: AccesoEmpresas,
  ): Promise<RespuestaGenerada> {
    return this.resultadoComercial(
      id,
      EstadoDte.RECHAZADO,
      dto.glosa,
      dto.codigoRechazo,
      dto,
      acceso,
    );
  }

  /** Genera el `EnvioRecibos` (Ley 19.983) del DTE. Una sola vez por documento. */
  async reciboMercaderias(
    id: string,
    dto: ReciboMercaderiasDto,
    acceso: AccesoEmpresas,
  ): Promise<RespuestaGenerada> {
    const { dte, empresa } = await this.recepcion.obtenerDte(id, acceso);
    if (dte.estadoComercial === 'rechazado') {
      throw conflicto(
        'No se puede dar recibo de mercaderías de un DTE rechazado',
      );
    }
    if (dte.xmlEnvioRecibos !== null) {
      throw conflicto('El DTE ya tiene un recibo de mercaderías generado');
    }
    if (!(TIPOS_RECIBO as readonly number[]).includes(dte.tipoDte)) {
      throw new ProblemaHttp(
        422,
        'TIPO_NO_ADMITIDO',
        'Tipo de documento sin recibo',
        `El recibo de mercaderías (Ley 19.983) solo admite los tipos ${TIPOS_RECIBO.join(', ')} (el DTE es ${dte.tipoDte})`,
      );
    }
    const destino = await this.prepararCorreo(empresa, dte, dto);
    const certificado = await this.sii.certificadoActivo(empresa.id);
    const rutResponde = formatearRut(empresa.rut, empresa.dv);
    const rutEmisor = formatearRut(dte.rutEmisor, dte.dvEmisor);
    const generado = construirEnvioRecibos(
      [
        {
          tipoDoc: dte.tipoDte,
          folio: dte.folio,
          fechaEmision: dte.fechaEmision,
          rutEmisor,
          rutReceptor: rutResponde,
          montoTotal: dte.montoTotal,
        },
      ],
      {
        rutResponde,
        rutRecibe: rutEmisor,
        rutFirma: dto.rutFirma,
        recinto: dto.recinto,
        certificado,
        nombreContacto: empresa.razonSocial,
        mailContacto: empresa.correoIntercambio ?? undefined,
      },
    );
    validarRespuesta(generado, 'EnvioRecibos');
    // Condicional: dos solicitudes simultáneas no generan dos recibos.
    const r = await this.ejecutor.ejecutar((em) =>
      em.update(
        DteRecibido,
        { id, xmlEnvioRecibos: IsNull() },
        { xmlEnvioRecibos: generado.xml, acuseReciboMercaderias: true },
      ),
    );
    if (!r.affected)
      throw conflicto('El DTE ya tiene un recibo de mercaderías generado');
    return this.terminar(
      id,
      acceso,
      empresa,
      'EnvioRecibos',
      generado,
      destino,
      {
        asunto: `Recibo de mercaderías - DTE ${dte.tipoDte} folio ${dte.folio}`,
        archivo: `EnvioRecibos_${dte.tipoDte}_${dte.folio}.xml`,
      },
    );
  }

  /** XML (ISO-8859-1) de la última respuesta comercial generada. */
  async xmlResultado(
    id: string,
    acceso: AccesoEmpresas,
  ): Promise<{ buffer: Buffer; nombre: string }> {
    const { dte } = await this.recepcion.obtenerDte(id, acceso);
    if (!dte.xmlResultadoDte)
      throw noEncontrado('El ResultadoDTE del documento', id);
    return {
      buffer: aIso88591(dte.xmlResultadoDte),
      nombre: `ResultadoDTE_${dte.tipoDte}_${dte.folio}.xml`,
    };
  }

  async xmlRecibos(
    id: string,
    acceso: AccesoEmpresas,
  ): Promise<{ buffer: Buffer; nombre: string }> {
    const { dte } = await this.recepcion.obtenerDte(id, acceso);
    if (!dte.xmlEnvioRecibos)
      throw noEncontrado('El EnvioRecibos del documento', id);
    return {
      buffer: aIso88591(dte.xmlEnvioRecibos),
      nombre: `EnvioRecibos_${dte.tipoDte}_${dte.folio}.xml`,
    };
  }

  // -------------------------------------------------------------------------------------------

  private async resultadoComercial(
    id: string,
    estado: EstadoDteCodigo,
    glosa: string | undefined,
    codigoRechazo: number | undefined,
    opciones: OpcionesCorreo,
    acceso: AccesoEmpresas,
  ): Promise<RespuestaGenerada> {
    const { dte, empresa } = await this.recepcion.obtenerDte(id, acceso);
    if (dte.estadoComercial !== 'pendiente') {
      throw conflicto(
        `El DTE ya fue respondido (${dte.estadoComercial}); no se puede responder otra vez`,
      );
    }
    const envio = await this.ejecutor.ejecutar((em) =>
      em.getRepository(EnvioRecibido).findOneOrFail({
        where: { id: dte.envioRecibidoId },
        select: { id: true, codigoEnvio: true, remitente: true },
      }),
    );
    const destino = await this.prepararCorreo(
      empresa,
      dte,
      opciones,
      envio.remitente,
    );
    const certificado = await this.sii.certificadoActivo(empresa.id);
    const rutResponde = formatearRut(empresa.rut, empresa.dv);
    const rutEmisor = formatearRut(dte.rutEmisor, dte.dvEmisor);
    const idRespuesta = await this.siguienteIdRespuesta();
    const generado = construirResultadoDte(
      [
        {
          tipoDte: dte.tipoDte,
          folio: dte.folio,
          fechaEmision: dte.fechaEmision,
          rutEmisor,
          rutReceptor: rutResponde,
          montoTotal: dte.montoTotal,
          codigoEnvio: envio.codigoEnvio,
          estado,
          glosa,
          codigoRechazo,
        },
      ],
      {
        idRespuesta,
        certificado,
        rutResponde,
        rutRecibe: rutEmisor,
        nombreContacto: empresa.razonSocial,
        mailContacto: empresa.correoIntercambio ?? undefined,
      },
    );
    validarRespuesta(generado, 'RespuestaEnvioDTE');
    const nuevo: EstadoComercialDte =
      estado === EstadoDte.RECHAZADO
        ? 'rechazado'
        : estado === EstadoDte.ACEPTADO
          ? 'aceptado'
          : 'aceptado_con_reparos';
    const r = await this.ejecutor.ejecutar((em) =>
      em.update(
        DteRecibido,
        { id, estadoComercial: 'pendiente' },
        {
          estadoComercial: nuevo,
          glosa: glosa ?? null,
          xmlResultadoDte: generado.xml,
          respondidoEn: new Date(),
        },
      ),
    );
    if (!r.affected)
      throw conflicto(
        'El DTE ya fue respondido; no se puede responder otra vez',
      );
    return this.terminar(
      id,
      acceso,
      empresa,
      'ResultadoDTE',
      generado,
      destino,
      {
        asunto: `${nuevo === 'rechazado' ? 'Rechazo' : 'Aceptación'} de DTE ${dte.tipoDte} folio ${dte.folio}`,
        archivo: `ResultadoDTE_${dte.tipoDte}_${dte.folio}.xml`,
      },
    );
  }

  /**
   * Valida de antemano que se pueda enviar el correo (SMTP y destinatario), para no dejar una respuesta
   * guardada y no entregada por un error de configuración.
   */
  private async prepararCorreo(
    empresa: Empresa,
    dte: DteRecibido,
    opciones: OpcionesCorreo,
    remitenteEnvio?: string | null,
  ): Promise<string | null> {
    if (!opciones.enviarCorreo) return null;
    const cred = await this.buzon.credenciales(empresa.id);
    if (!cred?.smtp) {
      throw new ProblemaHttp(
        422,
        'SMTP_NO_CONFIGURADO',
        'Sin SMTP',
        'enviarCorreo requiere un buzón con SMTP configurado (PUT /v1/empresas/{rut}/buzon-correo)',
      );
    }
    const destino =
      opciones.destinatario ??
      remitenteEnvio ??
      (
        await this.ejecutor.ejecutar((em) =>
          em
            .getRepository(EnvioRecibido)
            .findOne({
              where: { id: dte.envioRecibidoId },
              select: { id: true, remitente: true },
            }),
        )
      )?.remitente ??
      null;
    if (!destino) {
      throw new ProblemaHttp(
        422,
        'SIN_DESTINATARIO',
        'Sin destinatario',
        'El envío se recibió sin remitente de correo; indique `destinatario` (correo de intercambio del emisor)',
      );
    }
    return destino;
  }

  private async terminar(
    id: string,
    acceso: AccesoEmpresas,
    empresa: Empresa,
    tipo: 'ResultadoDTE' | 'EnvioRecibos',
    generado: RespuestaConstruida,
    destino: string | null,
    correo: { asunto: string; archivo: string },
  ): Promise<RespuestaGenerada> {
    let enviado = false;
    let error: string | null = null;
    if (destino) {
      try {
        await this.buzon.enviar(empresa, {
          para: destino,
          asunto: correo.asunto,
          texto: `Se adjunta la respuesta (${tipo}) al documento recibido, firmada electrónicamente.`,
          adjuntos: [
            {
              nombre: correo.archivo,
              tipo: 'application/xml',
              contenido: generado.xmlIso,
            },
          ],
        });
        enviado = true;
      } catch (e) {
        // La respuesta ya quedó guardada y se puede descargar; el fallo de correo se informa sin perderla.
        error = e instanceof ProblemaHttp ? e.detail : (e as Error).message;
        this.log.warn(`No se pudo enviar ${tipo} de ${id}: ${error}`);
      }
    }
    const { dte } = await this.recepcion.obtenerDte(id, acceso);
    return {
      dte: aRespuestaDteRecibido(dte, `${empresa.rut}-${empresa.dv}`),
      respuesta: {
        tipo,
        xml: generado.xml,
        descarga: `/v1/dte-recibidos/${id}/${tipo === 'ResultadoDTE' ? 'resultado-dte' : 'envio-recibos'}`,
      },
      correo: {
        solicitado: destino !== null,
        enviado,
        destinatario: destino,
        error,
      },
    };
  }

  private async siguienteIdRespuesta(): Promise<number> {
    const filas = await this.ejecutor.ejecutar((em) =>
      em.query<Array<{ n: number }>>(
        `SELECT nextval('seq_id_respuesta_intercambio')::int AS n`,
      ),
    );
    return Number(filas[0].n);
  }
}

function conflicto(detail: string): ProblemaHttp {
  return new ProblemaHttp(409, 'ESTADO_INVALIDO', 'Estado inválido', detail);
}

/** El XML generado debe validar contra el XSD oficial antes de guardarse o enviarse. */
function validarRespuesta(
  r: RespuestaConstruida,
  esquema: 'RespuestaEnvioDTE' | 'EnvioRecibos',
): void {
  const xsd = validarXsd(r.xmlIso, esquema);
  if (!xsd.valido) {
    throw new ProblemaHttp(
      422,
      'DOCUMENTO_INVALIDO',
      'Respuesta inválida',
      `La respuesta generada no valida contra el XSD del SII (${esquema}): ${xsd.errores.slice(0, 3).join('; ')}`,
    );
  }
}
