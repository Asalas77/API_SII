import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XmlDocument, XsdValidator } from 'libxml2-wasm';
import type { ErrorDetail } from 'libxml2-wasm';
import { xmlRegisterFsInputProviders } from 'libxml2-wasm/lib/nodejs.mjs';

export type EsquemaSii = 'DTE' | 'EnvioDTE' | 'EnvioBOLETA' | 'RespSII' | 'RespuestaEnvioDTE';

export interface ResultadoXsd {
  valido: boolean;
  errores: string[];
}

const ARCHIVOS: Record<EsquemaSii, string> = {
  DTE: 'DTE_v10.xsd',
  EnvioDTE: 'EnvioDTE_v10.xsd',
  EnvioBOLETA: 'EnvioBOLETA_v11.xsd',
  RespSII: 'RespSII_v10.xsd',
  RespuestaEnvioDTE: 'RespuestaEnvioDTE_v10.xsd',
};

let directorioXsd: string | undefined;
let proveedoresRegistrados = false;
const validadores = new Map<string, XsdValidator>();

/**
 * Localiza la carpeta de XSD: variable `SII_XSD_DIR` o, si no existe, la primera carpeta
 * `resources/sii/xsd` encontrada hacia arriba desde este archivo (sirve desde `src/` y `dist/`).
 */
export function directorioXsdSii(): string {
  const env = process.env.SII_XSD_DIR;
  if (env) {
    if (!existsSync(env)) throw new Error(`SII_XSD_DIR no existe: ${env}`);
    return resolve(env);
  }
  if (directorioXsd) return directorioXsd;
  let actual = import.meta.dirname;
  for (;;) {
    const candidato = join(actual, 'resources', 'sii', 'xsd');
    if (existsSync(candidato)) return (directorioXsd = candidato);
    const padre = dirname(actual);
    if (padre === actual) break;
    actual = padre;
  }
  throw new Error('No se encontró resources/sii/xsd; defina SII_XSD_DIR');
}

function obtenerValidador(esquema: EsquemaSii): XsdValidator {
  const archivo = ARCHIVOS[esquema];
  if (!archivo) throw new Error(`Esquema XSD desconocido: ${String(esquema)}`);
  const ruta = join(directorioXsdSii(), archivo);
  const cacheado = validadores.get(ruta);
  if (cacheado) return cacheado;

  if (!proveedoresRegistrados) {
    xmlRegisterFsInputProviders();
    proveedoresRegistrados = true;
  }
  const xsdDoc = XmlDocument.fromBuffer(readFileSync(ruta), { url: pathToFileURL(ruta).href });
  try {
    const validador = XsdValidator.fromDoc(xsdDoc);
    validadores.set(ruta, validador);
    return validador;
  } finally {
    xsdDoc.dispose();
  }
}

function formatearError(d: ErrorDetail): string {
  const ubicacion = d.line ? `línea ${d.line}` : 'sin línea';
  const ruta = d.xpath ? ` [${d.xpath}]` : '';
  return `${ubicacion}${ruta}: ${d.message.replace(/\s+/g, ' ').trim()}`;
}

/** Valida un XML contra el XSD oficial indicado. Los validadores compilados se cachean. */
export function validarXsd(xml: string | Buffer, esquema: EsquemaSii): ResultadoXsd {
  const validador = obtenerValidador(esquema);
  let doc: XmlDocument;
  try {
    doc = typeof xml === 'string' ? XmlDocument.fromString(xml) : XmlDocument.fromBuffer(xml);
  } catch (e) {
    const detalles = (e as { details?: ErrorDetail[] }).details;
    return {
      valido: false,
      errores: detalles?.length ? detalles.map(formatearError) : [`XML mal formado: ${(e as Error).message}`],
    };
  }
  try {
    validador.validate(doc);
    return { valido: true, errores: [] };
  } catch (e) {
    const detalles = (e as { details?: ErrorDetail[] }).details;
    return {
      valido: false,
      errores: detalles?.length ? detalles.map(formatearError) : [(e as Error).message],
    };
  } finally {
    doc.dispose();
  }
}

/** Libera los validadores cacheados (útil en tests o al apagar la aplicación). */
export function liberarValidadoresXsd(): void {
  for (const v of validadores.values()) v.dispose();
  validadores.clear();
}
