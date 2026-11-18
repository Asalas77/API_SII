import { urlDte, type AmbienteSii } from '../ambientes.js';
import {
  SiiAutenticacionError,
  SiiEnvioDteError,
  SiiError,
} from '../comun/errores.js';
import type { FirmadorXml } from '../comun/firmador.js';
import {
  GestorToken,
  construirMultipartEnvio,
  headersEnvio,
  normalizarRut,
  solicitar,
  type FetchImpl,
  type OpcionesCacheToken,
  type OpcionesReintento,
  type RutLike,
} from '../comun/http.js';
import {
  buscarClave,
  buscarTexto,
  comoArreglo,
  escaparXml,
  leerTextoXml,
  parsearXml,
} from '../comun/xml.js';

export interface DteSiiClientOpciones {
  ambiente: AmbienteSii;
  /** RUT de la empresa emisora, sin dígito verificador. */
  rutEmpresa: RutLike;
  dvEmpresa: string;
  /** RUT del usuario titular del certificado, sin DV. */
  rutUsuario: RutLike;
  dvUsuario: string;
  firmador: FirmadorXml;
  fetchImpl?: FetchImpl;
  reintentos?: OpcionesReintento;
  /** `false` desactiva la caché de token. */
  cacheToken?: OpcionesCacheToken | false;
}

export interface ResultadoEnvioDte {
  trackId: string;
  status: string;
  mensaje?: string;
}

export interface RespuestaConsultaSii {
  estado: string;
  glosa: string;
  /** XML SII:RESPUESTA ya des-escapado. */
  xmlRespuesta: string;
  /** Contenido de SII:RESP_HDR parseado (ESTADO, GLOSA, ERR_CODE, ...). */
  cabecera: Record<string, unknown>;
  /** Contenido de SII:RESP_BODY parseado (TIPO_DOCTO, INFORMADOS, ...), si existe. */
  cuerpo?: unknown;
}

export interface ParametrosEstadoDte {
  rutEmisor: RutLike;
  dvEmisor: string;
  rutReceptor: RutLike;
  dvReceptor: string;
  tipoDte: number;
  folio: number;
  /** Formato ddmmyyyy */
  fechaEmision: string;
  monto: number;
}

/** Glosas de STATUS del upload (SII_Envio_Automatico_DTE_Upload). */
export const GLOSAS_STATUS_UPLOAD: Readonly<Record<string, string>> = {
  '0': 'Upload OK',
  '1': 'El sender no tiene permiso para enviar',
  '2': 'Error en tamaño del archivo (muy grande o muy chico)',
  '3': 'Archivo cortado (tamaño distinto al parámetro size)',
  '5': 'No está autenticado',
  '6': 'Empresa no autorizada a enviar archivos',
  '7': 'Esquema inválido',
  '8': 'Firma del documento inválida',
  '9': 'Sistema bloqueado',
  '99': 'Error interno',
};

/** ESTADO de las consultas que indican token/cookie inválido. */
const ESTADOS_TOKEN_INVALIDO = new Set(['001', '002', '003']);

const FECHA_DDMMYYYY = /^\d{8}$/;

/** Cliente SOAP + upload de los servicios DTE del SII (maullin / palena). */
export class DteSiiClient {
  private readonly ambiente: AmbienteSii;
  private readonly rutEmpresa: string;
  private readonly dvEmpresa: string;
  private readonly rutUsuario: string;
  private readonly dvUsuario: string;
  private readonly firmador: FirmadorXml;
  private readonly fetchImpl: FetchImpl;
  private readonly reintentos?: OpcionesReintento;
  private readonly gestorToken: GestorToken;

  constructor(opciones: DteSiiClientOpciones) {
    this.ambiente = opciones.ambiente;
    this.rutEmpresa = normalizarRut(opciones.rutEmpresa);
    this.dvEmpresa = opciones.dvEmpresa.toUpperCase();
    this.rutUsuario = normalizarRut(opciones.rutUsuario);
    this.dvUsuario = opciones.dvUsuario.toUpperCase();
    this.firmador = opciones.firmador;
    this.fetchImpl = opciones.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    this.reintentos = opciones.reintentos;
    this.gestorToken = new GestorToken('dte', this.ambiente, this.rutEmpresa, opciones.cacheToken);
  }

  // -- SOAP -----------------------------------------------------------------

  private async soap(
    ruta: 'semilla' | 'token' | 'estadoEnvio' | 'estadoDte',
    cuerpo: string,
    nombreRetorno: string,
    contexto: string,
    token?: string,
  ): Promise<string> {
    const envelope =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      `<soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;
    const headers: Record<string, string> = {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '""',
    };
    if (token) headers.Cookie = `TOKEN=${token}`;
    const resp = await solicitar(
      this.fetchImpl,
      urlDte(this.ambiente, ruta),
      { method: 'POST', headers, body: envelope },
      contexto,
      this.reintentos,
    );
    const xml = await leerTextoXml(resp);
    const doc = parsearXml(xml);
    const falla = buscarClave(doc, 'faultstring');
    if (falla !== undefined) {
      throw new SiiError(`${contexto}: SOAP Fault - ${JSON.stringify(falla)}`, { cuerpo: xml });
    }
    // El parser ya des-escapa las entidades: el valor es el XML SII:RESPUESTA.
    const retorno = buscarTexto(doc, nombreRetorno);
    if (retorno === undefined) {
      throw new SiiError(`${contexto}: respuesta SOAP sin ${nombreRetorno}`, { cuerpo: xml });
    }
    return retorno;
  }

  private validarEstado00(respuesta: string, que: string): Record<string, unknown> {
    const doc = parsearXml(respuesta);
    const estado = buscarTexto(doc, 'ESTADO');
    if (estado !== '00') {
      const glosa = buscarTexto(doc, 'GLOSA');
      throw new SiiAutenticacionError(
        `SII rechazó ${que}: ESTADO ${estado ?? '(ausente)'}${glosa ? ` - ${glosa}` : ''}`,
        { cuerpo: respuesta },
      );
    }
    return doc;
  }

  /** CrSeed.jws / getSeed. */
  async obtenerSemilla(): Promise<string> {
    const retorno = await this.soap('semilla', '<getSeed/>', 'getSeedReturn', 'DTE: obtener semilla');
    const doc = this.validarEstado00(retorno, 'semilla');
    const semilla = buscarTexto(doc, 'SEMILLA');
    if (!semilla) throw new SiiAutenticacionError('Respuesta de semilla sin SEMILLA', { cuerpo: retorno });
    return semilla;
  }

  /** GetTokenFromSeed.jws / getToken (con caché). */
  obtenerToken(): Promise<string> {
    return this.gestorToken.obtener(() => this.solicitarToken());
  }

  private async solicitarToken(): Promise<string> {
    const semilla = await this.obtenerSemilla();
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
    const firmado = this.firmador.firmarXml(xml);
    const retorno = await this.soap(
      'token',
      `<getToken><pszXml>${escaparXml(firmado)}</pszXml></getToken>`,
      'getTokenReturn',
      'DTE: obtener token',
    );
    const doc = this.validarEstado00(retorno, 'token');
    const token = buscarTexto(doc, 'TOKEN');
    if (!token) throw new SiiAutenticacionError('Respuesta de token sin TOKEN', { cuerpo: retorno });
    return token;
  }

  // -- Upload ---------------------------------------------------------------

  /** DTEUpload: envía un EnvioDTE firmado (multipart). */
  async enviarDte(envioXml: Buffer | string, nombreArchivo: string): Promise<ResultadoEnvioDte> {
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      async (token) => {
        const resp = await solicitar(
          this.fetchImpl,
          urlDte(this.ambiente, 'upload'),
          {
            method: 'POST',
            headers: headersEnvio(token, 'text/xml'),
            body: construirMultipartEnvio(
              {
                rutSender: this.rutUsuario,
                dvSender: this.dvUsuario,
                rutCompany: this.rutEmpresa,
                dvCompany: this.dvEmpresa,
              },
              envioXml,
              nombreArchivo,
              'text/xml',
            ),
          },
          'DTE: upload',
          this.reintentos,
        );
        return this.interpretarRecepcion(await leerTextoXml(resp));
      },
    );
  }

  private interpretarRecepcion(xml: string): ResultadoEnvioDte {
    const doc = parsearXml(xml);
    const status = buscarTexto(doc, 'STATUS');
    if (status === undefined) {
      throw new SiiError('Respuesta de upload sin STATUS', { cuerpo: xml });
    }
    const glosa = GLOSAS_STATUS_UPLOAD[status] ?? 'Error interno (STATUS desconocido)';
    if (status === '0') {
      const trackId = buscarTexto(doc, 'TRACKID');
      if (!trackId) throw new SiiError('Upload OK pero sin TRACKID', { cuerpo: xml });
      return { trackId, status, mensaje: glosa };
    }
    if (status === '5') {
      throw new SiiAutenticacionError(`Upload DTE: ${glosa}`, { cuerpo: xml });
    }
    const errores = comoArreglo<string>(buscarClave(doc, 'ERROR')).map(String);
    throw new SiiEnvioDteError(status, glosa, errores, xml);
  }

  // -- Consultas ------------------------------------------------------------

  /** QueryEstUp.jws / getEstUp: estado de un envío por TrackId. */
  async consultarEstadoEnvio(trackId: string | number): Promise<RespuestaConsultaSii> {
    const track = String(trackId).trim();
    if (!/^\d+$/.test(track)) throw new SiiError(`trackId inválido: ${track}`);
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      (token) =>
        this.consulta(
          'estadoEnvio',
          'getEstUp',
          // Los nombres de parámetros siguen el WSDL de QueryEstUp (RutCompania/DvCompania).
          { RutCompania: this.rutEmpresa, DvCompania: this.dvEmpresa, TrackId: track },
          token,
          'DTE: estado de envío',
        ),
    );
  }

  /** QueryEstDte.jws / getEstDte: estado de un documento. */
  async consultarEstadoDte(params: ParametrosEstadoDte): Promise<RespuestaConsultaSii> {
    if (!FECHA_DDMMYYYY.test(params.fechaEmision)) {
      throw new SiiError(`fechaEmision debe tener formato ddmmyyyy: ${params.fechaEmision}`);
    }
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      (token) =>
        this.consulta(
          'estadoDte',
          'getEstDte',
          {
            RutConsultante: this.rutUsuario,
            DvConsultante: this.dvUsuario,
            RutCompania: normalizarRut(params.rutEmisor),
            DvCompania: params.dvEmisor.toUpperCase(),
            RutReceptor: normalizarRut(params.rutReceptor),
            DvReceptor: params.dvReceptor.toUpperCase(),
            TipoDte: String(params.tipoDte),
            FolioDte: String(params.folio),
            FechaEmisionDte: params.fechaEmision,
            MontoDte: String(params.monto),
          },
          token,
          'DTE: estado de documento',
        ),
    );
  }

  private async consulta(
    ruta: 'estadoEnvio' | 'estadoDte',
    operacion: 'getEstUp' | 'getEstDte',
    parametros: Record<string, string>,
    token: string,
    contexto: string,
  ): Promise<RespuestaConsultaSii> {
    const campos = Object.entries({ ...parametros, Token: token })
      .map(([k, v]) => `<${k}>${escaparXml(v)}</${k}>`)
      .join('');
    const retorno = await this.soap(
      ruta,
      `<${operacion}>${campos}</${operacion}>`,
      `${operacion}Return`,
      contexto,
      token,
    );
    const doc = parsearXml(retorno);
    const estado = buscarTexto(doc, 'ESTADO') ?? '';
    if (ESTADOS_TOKEN_INVALIDO.has(estado)) {
      throw new SiiAutenticacionError(`${contexto}: token inválido (ESTADO ${estado})`, {
        cuerpo: retorno,
      });
    }
    const cabecera = (buscarClave(doc, 'RESP_HDR') as Record<string, unknown> | undefined) ?? {};
    return {
      estado,
      glosa: buscarTexto(doc, 'GLOSA') ?? '',
      xmlRespuesta: retorno,
      cabecera,
      cuerpo: buscarClave(doc, 'RESP_BODY'),
    };
  }
}
