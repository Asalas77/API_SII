import { baseBoleta, baseEnvioBoleta, type AmbienteSii } from '../ambientes.js';
import { SiiAutenticacionError, SiiError } from '../comun/errores.js';
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
import { buscarTexto, leerTextoXml, parsearXml } from '../comun/xml.js';
import {
  ESTADOS_ENVIO_FINALES,
  GLOSAS_ESTADO_ENVIO,
  type EstadoBoleta,
  type EstadoEnvioBoleta,
  type ParametrosEstadoBoleta,
  type RespuestaEnvioBoletaJson,
  type RespuestaEstadoEnvioJson,
  type ResultadoEnvio,
} from './tipos.js';

export interface BoletaApiClientOpciones {
  ambiente: AmbienteSii;
  /** RUT de la empresa emisora, sin dígito verificador. */
  rutEmpresa: RutLike;
  dvEmpresa: string;
  /** RUT del usuario que firma/envía (titular del certificado), sin DV. */
  rutUsuario: RutLike;
  dvUsuario: string;
  firmador: FirmadorXml;
  fetchImpl?: FetchImpl;
  reintentos?: OpcionesReintento;
  /** `false` desactiva la caché de token. */
  cacheToken?: OpcionesCacheToken | false;
  /** Enviar boletas por el host temporal alternativo (pangal / rahue). */
  usarHostEnvioAlternativo?: boolean;
}

const FECHA_DD_MM_YYYY = /^\d{2}-\d{2}-\d{4}$/;

/**
 * Cliente de la API REST de boleta electrónica del SII.
 *
 * Límite del SII: máximo 500 boletas por envío (recomendado 50). Aquí NO se
 * valida; es responsabilidad del dominio.
 */
export class BoletaApiClient {
  private readonly ambiente: AmbienteSii;
  private readonly rutEmpresa: string;
  private readonly dvEmpresa: string;
  private readonly rutUsuario: string;
  private readonly dvUsuario: string;
  private readonly firmador: FirmadorXml;
  private readonly fetchImpl: FetchImpl;
  private readonly reintentos?: OpcionesReintento;
  private readonly usarHostEnvioAlternativo: boolean;
  private readonly gestorToken: GestorToken;

  constructor(opciones: BoletaApiClientOpciones) {
    this.ambiente = opciones.ambiente;
    this.rutEmpresa = normalizarRut(opciones.rutEmpresa);
    this.dvEmpresa = opciones.dvEmpresa.toUpperCase();
    this.rutUsuario = normalizarRut(opciones.rutUsuario);
    this.dvUsuario = opciones.dvUsuario.toUpperCase();
    this.firmador = opciones.firmador;
    this.fetchImpl = opciones.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    this.reintentos = opciones.reintentos;
    this.usarHostEnvioAlternativo = opciones.usarHostEnvioAlternativo ?? false;
    this.gestorToken = new GestorToken(
      'boleta',
      this.ambiente,
      this.rutEmpresa,
      opciones.cacheToken,
    );
  }

  private get base(): string {
    return baseBoleta(this.ambiente);
  }

  /** GET semilla (vale 2 minutos). */
  async obtenerSemilla(): Promise<string> {
    const resp = await solicitar(
      this.fetchImpl,
      `${this.base}/boleta.electronica.semilla`,
      { method: 'GET', headers: { Accept: 'application/xml' } },
      'Boleta: obtener semilla',
      this.reintentos,
    );
    const xml = await leerTextoXml(resp);
    const doc = parsearXml(xml);
    this.validarEstado00(doc, xml, 'semilla');
    const semilla = buscarTexto(doc, 'SEMILLA');
    if (!semilla) throw new SiiAutenticacionError('Respuesta de semilla sin SEMILLA', { cuerpo: xml });
    return semilla;
  }

  /**
   * Obtiene un token (con caché). Firma las dos líneas exactas
   * `<?xml ...?>\n<getToken>...</getToken>` (sin salto final).
   */
  obtenerToken(): Promise<string> {
    return this.gestorToken.obtener(() => this.solicitarToken());
  }

  private async solicitarToken(): Promise<string> {
    const semilla = await this.obtenerSemilla();
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
    const firmado = this.firmador.firmarXml(xml);
    const resp = await solicitar(
      this.fetchImpl,
      `${this.base}/boleta.electronica.token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
        body: firmado,
      },
      'Boleta: obtener token',
      this.reintentos,
    );
    const texto = await leerTextoXml(resp);
    const doc = parsearXml(texto);
    this.validarEstado00(doc, texto, 'token');
    const token = buscarTexto(doc, 'TOKEN');
    if (!token) throw new SiiAutenticacionError('Respuesta de token sin TOKEN', { cuerpo: texto });
    return token;
  }

  private validarEstado00(doc: Record<string, unknown>, xml: string, que: string): void {
    const estado = buscarTexto(doc, 'ESTADO');
    if (estado !== '00') {
      const glosa = buscarTexto(doc, 'GLOSA');
      throw new SiiAutenticacionError(
        `SII rechazó ${que}: ESTADO ${estado ?? '(ausente)'}${glosa ? ` - ${glosa}` : ''}`,
        { cuerpo: xml },
      );
    }
  }

  /**
   * Envía un EnvioBOLETA firmado. Si se pasa string, se codifica según el
   * encoding declarado en el prólogo (ISO-8859-1 o UTF-8).
   */
  async enviarBoletas(envioXml: Buffer | string, nombreArchivo: string): Promise<ResultadoEnvio> {
    const url = `${baseEnvioBoleta(this.ambiente, this.usarHostEnvioAlternativo)}/boleta.electronica.envio`;
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      async (token) => {
        const resp = await solicitar(
          this.fetchImpl,
          url,
          {
            method: 'POST',
            headers: headersEnvio(token, 'application/json'),
            body: construirMultipartEnvio(
              {
                rutSender: this.rutUsuario,
                dvSender: this.dvUsuario,
                rutCompany: this.rutEmpresa,
                dvCompany: this.dvEmpresa,
              },
              envioXml,
              nombreArchivo,
            ),
          },
          'Boleta: enviar boletas',
          this.reintentos,
        );
        const json = await this.leerJson<RespuestaEnvioBoletaJson>(resp, 'envío');
        if (json.trackid === undefined || json.trackid === null) {
          throw new SiiError('Respuesta de envío sin trackid', { cuerpo: JSON.stringify(json) });
        }
        return { ...json, trackId: String(json.trackid) };
      },
    );
  }

  /** Estado de un envío por trackId. */
  async consultarEstadoEnvio(trackId: string | number): Promise<EstadoEnvioBoleta> {
    const track = String(trackId).trim();
    if (!/^\d{1,15}$/.test(track)) throw new SiiError(`trackId inválido: ${track}`);
    const url = `${this.base}/boleta.electronica.envio/${this.rutEmpresa}-${this.dvEmpresa}-${track}`;
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      async (token) => {
        const resp = await solicitar(
          this.fetchImpl,
          url,
          { method: 'GET', headers: { Cookie: `TOKEN=${token}`, Accept: 'application/json' } },
          'Boleta: estado de envío',
          this.reintentos,
        );
        const json = await this.leerJson<RespuestaEstadoEnvioJson>(resp, 'estado de envío');
        const glosa = (GLOSAS_ESTADO_ENVIO as Record<string, string>)[json.estado];
        return {
          ...json,
          trackId: String(json.trackid),
          descripcionEstado: glosa ?? `Estado desconocido: ${json.estado}`,
          esFinal: ESTADOS_ENVIO_FINALES.has(json.estado),
        };
      },
    );
  }

  /** Estado de una boleta individual. */
  async consultarEstadoBoleta(params: ParametrosEstadoBoleta): Promise<EstadoBoleta> {
    if (params.fechaEmision !== undefined && !FECHA_DD_MM_YYYY.test(params.fechaEmision)) {
      throw new SiiError(`fechaEmision debe tener formato DD-MM-YYYY: ${params.fechaEmision}`);
    }
    const qs = new URLSearchParams();
    if (params.rutReceptor !== undefined) qs.set('rut_receptor', normalizarRut(params.rutReceptor));
    if (params.dvReceptor !== undefined) qs.set('dv_receptor', params.dvReceptor.toUpperCase());
    if (params.monto !== undefined) qs.set('monto', String(params.monto));
    if (params.fechaEmision !== undefined) qs.set('fechaEmision', params.fechaEmision);
    const query = qs.toString();
    const url =
      `${this.base}/boleta.electronica/${this.rutEmpresa}-${this.dvEmpresa}-${params.tipo}-${params.folio}/estado` +
      (query ? `?${query}` : '');
    return this.gestorToken.conToken(
      () => this.solicitarToken(),
      async (token) => {
        const resp = await solicitar(
          this.fetchImpl,
          url,
          { method: 'GET', headers: { Cookie: `TOKEN=${token}`, Accept: 'application/json' } },
          'Boleta: estado de boleta',
          this.reintentos,
        );
        return this.leerJson<EstadoBoleta>(resp, 'estado de boleta');
      },
    );
  }

  private async leerJson<T>(resp: Response, que: string): Promise<T> {
    const texto = await resp.text();
    try {
      return JSON.parse(texto) as T;
    } catch (e) {
      throw new SiiError(`Respuesta JSON inválida del SII (${que})`, { cause: e, cuerpo: texto });
    }
  }
}
