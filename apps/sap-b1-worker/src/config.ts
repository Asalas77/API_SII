import { existsSync } from 'node:fs';
import { normalizarRut } from './rut.js';

export interface Config {
  sl: {
    url: string;
    version: 'v1' | 'v2';
    companyDb: string;
    usuario: string;
    password: string;
    timeoutMs: number;
    /** Tamaño de página OData (`Prefer: odata.maxpagesize`). */
    paginaMax: number;
  };
  api: {
    url: string;
    apiKey: string;
    /** RUT del emisor, normalizado (`76086428-5`). */
    rutEmpresa: string;
    timeoutMs: number;
  };
  intervaloSegundos: number;
  conciliacionMinutos: number;
  concurrencia: number;
  enviarAutomaticamente: boolean;
  /** Mínimo entre dos consultas de estado al SII del mismo documento. */
  seguimientoMinSegundos: number;
  /** Base del backoff exponencial de los reintentos (ms); tope en `backoffMaxMs`. */
  backoffBaseMs: number;
  backoffMaxMs: number;
  b1: {
    codigosExentos: string[];
    /** `PaymentGroupCode` que se consideran pago contado (formaPago 1). */
    gruposPagoContado: number[];
    /** Campo (UDF) del socio de negocios con el giro. */
    campoGiro: string;
  };
}

export class ErrorConfig extends Error {}

type Env = Record<string, string | undefined>;

/** Carga `.env` (si existe) con `process.loadEnvFile`; las variables ya definidas no se pisan. */
export function cargarEnv(ruta = '.env'): void {
  if (existsSync(ruta)) process.loadEnvFile(ruta);
}

function lista(valor: string | undefined, porDefecto: string): string[] {
  return (valor ?? porDefecto)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Valida a mano las variables de entorno; acumula todos los problemas en un solo error.
 * `requiereSl: false` permite `instalar-udfs --dry-run` sin credenciales de Service Layer.
 */
export function leerConfig(
  env: Env = process.env,
  opciones: { requiereSl?: boolean; requiereApi?: boolean } = {},
): Config {
  const errores: string[] = [];
  const requiereSl = opciones.requiereSl ?? true;
  const requiereApi = opciones.requiereApi ?? true;

  const requerida = (nombre: string, exigir: boolean): string => {
    const v = env[nombre]?.trim();
    if (!v && exigir) errores.push(`${nombre} es obligatoria`);
    return v ?? '';
  };
  const entero = (nombre: string, porDefecto: number, min: number, max: number): number => {
    const crudo = env[nombre]?.trim();
    if (crudo === undefined || crudo === '') return porDefecto;
    const n = Number(crudo);
    if (!Number.isInteger(n) || n < min || n > max) {
      errores.push(`${nombre} debe ser un entero entre ${min} y ${max} (recibido "${crudo}")`);
      return porDefecto;
    }
    return n;
  };
  const booleano = (nombre: string, porDefecto: boolean): boolean => {
    const crudo = env[nombre]?.trim().toLowerCase();
    if (crudo === undefined || crudo === '') return porDefecto;
    if (['true', '1', 'si'].includes(crudo)) return true;
    if (['false', '0', 'no'].includes(crudo)) return false;
    errores.push(`${nombre} debe ser true o false (recibido "${crudo}")`);
    return porDefecto;
  };
  const url = (nombre: string, porDefecto: string | undefined, exigir: boolean): string => {
    const v = env[nombre]?.trim() || porDefecto || '';
    if (!v) {
      if (exigir) errores.push(`${nombre} es obligatoria`);
      return '';
    }
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
    } catch {
      errores.push(`${nombre} debe ser una URL http(s) (recibido "${v}")`);
    }
    return v.replace(/\/+$/, '');
  };

  const version = env['SL_VERSION']?.trim() || 'v2';
  if (version !== 'v1' && version !== 'v2') errores.push('SL_VERSION debe ser v1 o v2');

  const rutCrudo = env['EMPRESA_RUT']?.trim() ?? '';
  const rutEmpresa = normalizarRut(rutCrudo);
  if (!rutCrudo) {
    if (requiereApi) errores.push('EMPRESA_RUT es obligatoria');
  } else if (!rutEmpresa) {
    errores.push(`EMPRESA_RUT no es un RUT válido (recibido "${rutCrudo}")`);
  }

  const gruposPago = (env['B1_GRUPOS_PAGO_CONTADO']?.trim() || '-1')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  if (gruposPago.some((n) => !Number.isInteger(n))) {
    errores.push('B1_GRUPOS_PAGO_CONTADO debe ser una lista de enteros (PaymentGroupCode) separados por coma');
  }

  const campoGiro = env['B1_CAMPO_GIRO']?.trim() || 'U_SII_Giro';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(campoGiro)) {
    errores.push('B1_CAMPO_GIRO no es un nombre de campo válido');
  }

  const config: Config = {
    sl: {
      url: url('SL_URL', undefined, requiereSl),
      version: version === 'v1' ? 'v1' : 'v2',
      companyDb: requerida('SL_COMPANY_DB', requiereSl),
      usuario: requerida('SL_USER', requiereSl),
      password: requerida('SL_PASSWORD', requiereSl),
      timeoutMs: entero('SL_TIMEOUT_MS', 30_000, 1000, 3_600_000),
      paginaMax: entero('SL_PAGINA_MAX', 100, 1, 1000),
    },
    api: {
      url: url('API_URL', 'http://localhost:3000', requiereApi),
      apiKey: requerida('API_KEY', requiereApi),
      rutEmpresa: rutEmpresa ?? '',
      timeoutMs: entero('API_TIMEOUT_MS', 60_000, 1000, 3_600_000),
    },
    intervaloSegundos: entero('INTERVALO_SEGUNDOS', 30, 1, 86_400),
    conciliacionMinutos: entero('CONCILIACION_MINUTOS', 60, 1, 10_080),
    concurrencia: entero('CONCURRENCIA', 2, 1, 16),
    enviarAutomaticamente: booleano('ENVIAR_AUTOMATICAMENTE', true),
    seguimientoMinSegundos: entero('SEGUIMIENTO_MIN_SEGUNDOS', 120, 0, 86_400),
    backoffBaseMs: entero('BACKOFF_BASE_MS', 30_000, 0, 3_600_000),
    backoffMaxMs: entero('BACKOFF_MAX_MS', 600_000, 0, 86_400_000),
    b1: {
      codigosExentos: lista(env['B1_CODIGOS_EXENTOS'], 'IVA_EXE,EXE'),
      gruposPagoContado: gruposPago,
      campoGiro,
    },
  };
  if (errores.length > 0) {
    throw new ErrorConfig(`Configuración inválida:\n - ${errores.join('\n - ')}`);
  }
  return config;
}

/** Valores que nunca deben aparecer en un log. */
export function secretos(c: Config): string[] {
  return [c.api.apiKey, c.sl.password].filter((s) => s.length >= 4);
}
