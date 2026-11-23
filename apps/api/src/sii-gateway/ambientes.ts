/** Ambientes del SII soportados. */
export type AmbienteSii = 'certificacion' | 'produccion';

/**
 * User-Agent fijo que el SII exige en el upload de DTE y en el envío de boletas.
 */
export const USER_AGENT_SII =
  'Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.0; YComp 5.0.2.4)';

/** Hosts de los servicios DTE (SOAP + upload). */
export const HOSTS_DTE: Readonly<Record<AmbienteSii, string>> = {
  certificacion: 'https://maullin.sii.cl',
  produccion: 'https://palena.sii.cl',
};

export const RUTAS_DTE = {
  semilla: '/DTEWS/CrSeed.jws',
  token: '/DTEWS/GetTokenFromSeed.jws',
  estadoEnvio: '/DTEWS/QueryEstUp.jws',
  estadoDte: '/DTEWS/QueryEstDte.jws',
  upload: '/cgi_dte/UPL/DTEUpload',
} as const;

/**
 * Web service de Registro de Aceptación/Reclamo de DTE (Ley 20.956). Los hosts y rutas salen de los WSDL
 * oficiales descargados (`docs/referencias-sii/registro-reclamo/`): certificación `ws2.sii.cl` con la ruta
 * `/WSREGISTRORECLAMODTECERT/...` (distinta de la de producción), producción `ws1.sii.cl`.
 */
export const URLS_RECLAMO: Readonly<Record<AmbienteSii, string>> = {
  certificacion: 'https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice',
  produccion: 'https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice',
};

export function urlReclamo(ambiente: AmbienteSii): string {
  return URLS_RECLAMO[ambiente];
}

/** URL base de la API REST de boleta electrónica (todos los recursos). */
export const BASES_BOLETA: Readonly<Record<AmbienteSii, string>> = {
  certificacion: 'https://apicert.sii.cl/recursos/v1',
  produccion: 'https://api.sii.cl/recursos/v1',
};

/**
 * Hosts temporales exclusivos para `POST /boleta.electronica.envio`
 * (pangal en certificación, rahue en producción).
 */
export const BASES_ENVIO_BOLETA_ALTERNATIVO: Readonly<Record<AmbienteSii, string>> = {
  certificacion: 'https://pangal.sii.cl/recursos/v1',
  produccion: 'https://rahue.sii.cl/recursos/v1',
};

export function hostDte(ambiente: AmbienteSii): string {
  return HOSTS_DTE[ambiente];
}

export function urlDte(ambiente: AmbienteSii, ruta: keyof typeof RUTAS_DTE): string {
  return `${HOSTS_DTE[ambiente]}${RUTAS_DTE[ruta]}`;
}

export function baseBoleta(ambiente: AmbienteSii): string {
  return BASES_BOLETA[ambiente];
}

/** Base para el envío de boletas; usa el host alternativo si `usarHostAlternativo`. */
export function baseEnvioBoleta(ambiente: AmbienteSii, usarHostAlternativo = false): string {
  return usarHostAlternativo
    ? BASES_ENVIO_BOLETA_ALTERNATIVO[ambiente]
    : BASES_BOLETA[ambiente];
}
