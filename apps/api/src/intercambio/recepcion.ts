import { createPublicKey } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import {
  aIso88591,
  desdeIso88591,
  formatearRut,
  validarRut,
  validarXsd,
  verificarFirmaXml,
  verificarTed,
} from '../dte-core/index.js';
import {
  EstadoRecepDte,
  EstadoRecepEnv,
  GLOSA_RECEP_DTE,
  GLOSA_RECEP_ENV,
  type EstadoRecepDteCodigo,
  type EstadoRecepEnvCodigo,
} from './estados.js';

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';

/** RUT del contribuyente que recibe el envío (quien responde). */
export interface ReceptorEnvio {
  /** Cuerpo numérico (sin DV ni puntos). */
  rut: string | number;
  dv: string;
}

/** Envíos y DTE ya recibidos, para detectar repetidos. */
export interface HistorialRecepcion {
  /** Claves `SetDTE/@ID` + RUT emisor de la carátula de los envíos ya aceptados. */
  envios?: Array<{ idSet: string; rutEmisor: string }>;
  /** DTE ya recibidos (RUT emisor del documento, tipo y folio). */
  dtes?: Array<{ rutEmisor: string; tipoDte: number; folio: number }>;
}

/** Metadatos de la recepción que viajan en `RecepcionEnvio` (los asigna el buzón). */
export interface MetadatosRecepcion {
  /** `NmbEnvio`: nombre del archivo recibido (máx. 80). */
  nombreArchivo?: string;
  /** `CodEnvio`: número único (entero positivo, máx. 10 dígitos) que asigna el receptor. */
  codigoEnvio?: number;
  /** `FchRecep`. Por defecto, ahora. */
  fechaRecepcion?: Date;
}

export interface AnalisisDte {
  /** Posición (base 0) dentro del `SetDTE`. */
  indice: number;
  /** `Documento/@ID` (p. ej. `F33T1`). */
  idDocumento?: string;
  tipoDte: number;
  folio: number;
  /** `yyyy-mm-dd`. */
  fechaEmision: string;
  rutEmisor: string;
  rutReceptor: string;
  montoTotal: number;
  estado: EstadoRecepDteCodigo;
  /** Glosa del estado (la del XSD, más el detalle si lo hay), máx. 256 caracteres. */
  glosa: string;
  /** Detalle de las verificaciones que fallaron. */
  errores: string[];
}

export interface AnalisisEnvio extends MetadatosRecepcion {
  estado: EstadoRecepEnvCodigo;
  glosa: string;
  /** Receptor al que se dirige la respuesta (RUT de quien analizó el envío), formato `12345678-5`. */
  receptor: string;
  tipoSobre?: 'EnvioDTE' | 'EnvioBOLETA';
  /** `SetDTE/@ID` (va en `EnvioDTEID`). */
  idSet?: string;
  /** `DigestValue` de la firma del sobre (va en `Digest`). */
  digest?: string;
  rutEmisor?: string;
  rutEnvia?: string;
  /** `RutReceptor` de la carátula. */
  rutReceptor?: string;
  /** Clave de unicidad del envío (`idSet` + RUT emisor); guárdela para el historial. */
  claveEnvio?: { idSet: string; rutEmisor: string };
  erroresXsd: string[];
  erroresFirma: string[];
  dtes: AnalisisDte[];
}

/* ------------------------------------------------------------------ utilidades DOM */

function hijos(el: Element, nombre: string): Element[] {
  const salida: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === nombre) salida.push(n as Element);
  }
  return salida;
}

function ruta(el: Element | undefined, ...nombres: string[]): Element | undefined {
  let actual = el;
  for (const nombre of nombres) {
    if (!actual) return undefined;
    actual = hijos(actual, nombre)[0];
  }
  return actual;
}

function texto(el: Element | undefined, ...nombres: string[]): string | undefined {
  const t = ruta(el, ...nombres)?.textContent?.trim();
  return t === undefined || t === '' ? undefined : t;
}

function normalizarRut(rut: string): string {
  return rut.replace(/\./g, '').trim().toUpperCase();
}

/** Declaración de codificación del XML (`undefined` si no la hay). */
function codificacionDeclarada(buf: Buffer): string | undefined {
  const cabecera = buf.subarray(0, 200).toString('latin1');
  return /^﻿?\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera)?.[1]?.toLowerCase();
}

function decodificar(xml: Buffer | string): { texto: string; paraXsd: Buffer } {
  if (typeof xml === 'string') return { texto: xml.replace(/^﻿/, ''), paraXsd: aIso88591(xml.replace(/^﻿/, '')) };
  const utf8 = (codificacionDeclarada(xml) ?? '') === 'utf-8';
  const conBom = xml.length >= 3 && xml[0] === 0xef && xml[1] === 0xbb && xml[2] === 0xbf;
  if (utf8 || conBom) {
    const t = xml.toString('utf8').replace(/^﻿/, '');
    return { texto: t, paraXsd: xml };
  }
  return { texto: desdeIso88591(xml), paraXsd: xml };
}

function parsear(textoXml: string): { doc?: Document; errores: string[] } {
  const errores: string[] = [];
  try {
    const doc = new DOMParser({
      onError: (nivel: string, msg: string) => {
        if (nivel !== 'warning') errores.push(msg);
      },
    }).parseFromString(textoXml, 'text/xml') as unknown as Document;
    if (errores.length > 0 || !doc?.documentElement) {
      return { errores: errores.length > 0 ? errores : ['El documento no tiene elemento raíz'] };
    }
    return { doc, errores };
  } catch (e) {
    return { errores: [(e as Error).message] };
  }
}

/* ------------------------------------------------------------------ TED */

function base64ABase64Url(v: string): string {
  return v.replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Clave pública del CAF incrustado en el TED (`CAF/DA/RSAPK/M` y `E`), en PEM. */
export function clavePublicaDeTed(tedXml: string): string | undefined {
  const m = /<RSAPK>\s*<M>([^<]+)<\/M>\s*<E>([^<]+)<\/E>\s*<\/RSAPK>/.exec(tedXml);
  if (!m) return undefined;
  try {
    return createPublicKey({
      key: { kty: 'RSA', n: base64ABase64Url(m[1]), e: base64ABase64Url(m[2]) },
      format: 'jwk',
    })
      .export({ type: 'spki', format: 'pem' })
      .toString();
  } catch {
    return undefined;
  }
}

function campoTed(ted: string, etiqueta: string): string | undefined {
  return new RegExp(`<DD>[\\s\\S]*?<${etiqueta}>([^<]*)</${etiqueta}>`).exec(ted)?.[1];
}

/** Verifica la firma del TED con el CAF incrustado y que sus datos coincidan con el DTE. */
function verificarTedDeDte(
  ted: string | undefined,
  dte: { tipoDte: number; folio: number; rutEmisor: string; montoTotal: number },
): { firmaValida: boolean; errores: string[] } {
  if (!ted) return { firmaValida: false, errores: ['El DTE no contiene TED'] };
  const pem = clavePublicaDeTed(ted);
  if (!pem) return { firmaValida: false, errores: ['TED: no se pudo extraer la clave pública del CAF (RSAPK)'] };
  if (!verificarTed(ted, pem)) {
    return { firmaValida: false, errores: ['TED: la firma FRMT no corresponde a los datos del timbre'] };
  }
  const errores: string[] = [];
  const comparar = (etiqueta: string, esperado: string, obtenido: string | undefined): void => {
    if (obtenido?.trim() !== esperado) errores.push(`TED/${etiqueta} (${obtenido ?? 'ausente'}) no coincide con el DTE (${esperado})`);
  };
  comparar('RE', dte.rutEmisor, campoTed(ted, 'RE') && normalizarRut(campoTed(ted, 'RE') as string));
  comparar('TD', String(dte.tipoDte), campoTed(ted, 'TD'));
  comparar('F', String(dte.folio), campoTed(ted, 'F'));
  comparar('MNT', String(dte.montoTotal), campoTed(ted, 'MNT'));
  return { firmaValida: true, errores };
}

/* ------------------------------------------------------------------ firmas */

interface FirmaUbicada {
  /** `'sobre'` o índice del DTE que la contiene. */
  duenio: 'sobre' | number;
  uriReferencia: string | undefined;
  digest: string | undefined;
}

function ubicarFirmas(doc: Document, dtes: Element[]): FirmaUbicada[] {
  const nodos = Array.from(doc.getElementsByTagNameNS(NS_DSIG, 'Signature'));
  return nodos.map((nodo) => {
    const padre = nodo.parentNode;
    const idx = dtes.findIndex((d) => d === padre);
    const ref = nodo.getElementsByTagNameNS(NS_DSIG, 'Reference')[0];
    return {
      duenio: idx >= 0 ? idx : 'sobre',
      uriReferencia: ref?.getAttribute('URI') ?? undefined,
      digest: nodo.getElementsByTagNameNS(NS_DSIG, 'DigestValue')[0]?.textContent?.trim(),
    };
  });
}

/* ------------------------------------------------------------------ análisis */

function recortar(glosa: string): string {
  return glosa.length > 256 ? `${glosa.slice(0, 253)}...` : glosa;
}

function glosaEnv(estado: EstadoRecepEnvCodigo, detalle?: string): string {
  return recortar(detalle ? `${GLOSA_RECEP_ENV[estado]}: ${detalle}` : GLOSA_RECEP_ENV[estado]);
}

function glosaDte(estado: EstadoRecepDteCodigo, detalle?: string): string {
  return recortar(detalle ? `${GLOSA_RECEP_DTE[estado]}: ${detalle}` : GLOSA_RECEP_DTE[estado]);
}

/**
 * Analiza un `EnvioDTE` (o `EnvioBOLETA`) recibido de otro contribuyente y determina los estados
 * de recepción del envío (`EstadoRecepEnv`) y de cada DTE (`EstadoRecepDTE`).
 *
 * Orden de las verificaciones del envío (se detiene en la primera que falla):
 * 1. Archivo legible (XML bien formado) -> 91.
 * 2. Validación contra el XSD -> 1.
 * 3. Firma del sobre (`Signature` del `SetDTE`) -> 2.
 * 4. RUT receptor de la carátula = receptor -> 3.
 * 5. Envío repetido (`SetDTE/@ID` + RUT emisor en el historial) -> 90.
 *
 * Para cada DTE (si el sobre fue legible y válido): firma del DTE y del TED (con la clave del CAF
 * incrustado) -> 1; RUT emisor = carátula y DV válido -> 2; RUT receptor = receptor -> 3;
 * repetido (historial o dentro del mismo envío) -> 4; datos del TED distintos a los del DTE -> 99.
 * Un DTE rechazado no cambia el estado del envío: éste queda en 0 y el rechazo se informa en `RecepcionDTE`.
 */
export function analizarEnvioRecibido(
  xml: Buffer | string,
  receptor: ReceptorEnvio,
  historial: HistorialRecepcion = {},
  metadatos: MetadatosRecepcion = {},
): AnalisisEnvio {
  const rutReceptor = normalizarRut(formatearRut(receptor.rut, receptor.dv));
  const base: AnalisisEnvio = {
    ...metadatos,
    estado: EstadoRecepEnv.OK,
    glosa: GLOSA_RECEP_ENV[EstadoRecepEnv.OK],
    receptor: rutReceptor,
    erroresXsd: [],
    erroresFirma: [],
    dtes: [],
  };
  const fallar = (estado: EstadoRecepEnvCodigo, detalle?: string): AnalisisEnvio => ({
    ...base,
    estado,
    glosa: glosaEnv(estado, detalle),
  });

  // 1. Legibilidad
  let decodificado: ReturnType<typeof decodificar>;
  try {
    decodificado = decodificar(xml);
  } catch (e) {
    return fallar(EstadoRecepEnv.ARCHIVO_ILEGIBLE, (e as Error).message);
  }
  const { texto: textoXml, paraXsd } = decodificado;
  const { doc, errores: erroresParseo } = parsear(textoXml);
  if (!doc) return { ...fallar(EstadoRecepEnv.ARCHIVO_ILEGIBLE, erroresParseo[0]), erroresXsd: erroresParseo };

  const raiz = doc.documentElement;
  const tipoSobre = raiz.localName === 'EnvioDTE' || raiz.localName === 'EnvioBOLETA' ? raiz.localName : undefined;
  if (!tipoSobre) {
    return fallar(EstadoRecepEnv.ERROR_SCHEMA, `Elemento raíz inesperado: ${raiz.localName}`);
  }
  base.tipoSobre = tipoSobre;

  // 2. Schema
  const xsd = validarXsd(paraXsd, tipoSobre);
  if (!xsd.valido) {
    return { ...fallar(EstadoRecepEnv.ERROR_SCHEMA, xsd.errores[0]), erroresXsd: xsd.errores };
  }

  const setDte = hijos(raiz, 'SetDTE')[0];
  const caratula = ruta(setDte, 'Caratula');
  const dtesEl = hijos(setDte, 'DTE');
  const idSet = setDte.getAttribute('ID') ?? '';
  const rutEmisorCaratula = normalizarRut(texto(caratula, 'RutEmisor') ?? '');
  base.idSet = idSet;
  base.rutEmisor = rutEmisorCaratula;
  base.rutEnvia = texto(caratula, 'RutEnvia');
  base.rutReceptor = normalizarRut(texto(caratula, 'RutReceptor') ?? '');
  base.claveEnvio = { idSet, rutEmisor: rutEmisorCaratula };

  // 3. Firmas
  const firmas = ubicarFirmas(doc, dtesEl);
  const firmaSobre = firmas.find((f) => f.duenio === 'sobre');
  base.digest = firmaSobre?.digest;
  const erroresFirmaPorDte = new Map<number, string[]>();
  const erroresSobre: string[] = [];
  const verificacion = verificarFirmaXml(textoXml);
  if (!verificacion.valida) {
    for (const err of verificacion.errores) {
      const k = /^Firma (\d+):/.exec(err);
      const duenio = k ? firmas[Number(k[1]) - 1]?.duenio : 'sobre';
      if (typeof duenio === 'number') {
        erroresFirmaPorDte.set(duenio, [...(erroresFirmaPorDte.get(duenio) ?? []), err]);
      } else {
        erroresSobre.push(err);
      }
    }
  }
  // La firma debe referenciar el elemento correcto (SetDTE para el sobre, Documento para cada DTE).
  if (!firmaSobre) erroresSobre.push('El sobre no contiene firma');
  else if (firmaSobre.uriReferencia !== `#${idSet}`) {
    erroresSobre.push(`La firma del sobre referencia ${firmaSobre.uriReferencia ?? '(sin URI)'} y no #${idSet}`);
  }
  base.erroresFirma = [...erroresSobre, ...[...erroresFirmaPorDte.values()].flat()];
  if (erroresSobre.length > 0) {
    // Se informa igualmente el detalle por DTE, útil para depurar.
    base.dtes = analizarDtes(dtesEl, textoXml, firmas, erroresFirmaPorDte, rutEmisorCaratula, rutReceptor, historial);
    return { ...fallar(EstadoRecepEnv.ERROR_FIRMA, erroresSobre[0]), dtes: base.dtes };
  }

  // 4. RUT receptor de la carátula
  if (base.rutReceptor !== rutReceptor) {
    base.dtes = analizarDtes(dtesEl, textoXml, firmas, erroresFirmaPorDte, rutEmisorCaratula, rutReceptor, historial);
    return {
      ...fallar(
        EstadoRecepEnv.RUT_RECEPTOR_NO_CORRESPONDE,
        `la carátula dirige el envío a ${base.rutReceptor} y se esperaba ${rutReceptor}`,
      ),
      dtes: base.dtes,
    };
  }

  // 5. Envío repetido
  if (historial.envios?.some((e) => e.idSet === idSet && normalizarRut(e.rutEmisor) === rutEmisorCaratula)) {
    return { ...fallar(EstadoRecepEnv.ARCHIVO_REPETIDO, `SetDTE ${idSet} del emisor ${rutEmisorCaratula}`) };
  }

  base.dtes = analizarDtes(dtesEl, textoXml, firmas, erroresFirmaPorDte, rutEmisorCaratula, rutReceptor, historial);
  return base;
}

function analizarDtes(
  dtesEl: Element[],
  textoXml: string,
  firmas: FirmaUbicada[],
  erroresFirmaPorDte: Map<number, string[]>,
  rutEmisorCaratula: string,
  rutReceptor: string,
  historial: HistorialRecepcion,
): AnalisisDte[] {
  const textosDte = textoXml.match(/<DTE\b[\s\S]*?<\/DTE>/g) ?? [];
  const aislado = textosDte.length === dtesEl.length;
  const vistos = new Set<string>();

  return dtesEl.map((dteEl, indice): AnalisisDte => {
    const contenedor = ['Documento', 'Exportaciones', 'Liquidacion']
      .map((n) => hijos(dteEl, n)[0])
      .find((x) => x !== undefined);
    const encabezado = ruta(contenedor, 'Encabezado');
    const tipoDte = Number(texto(encabezado, 'IdDoc', 'TipoDTE') ?? 0);
    const folio = Number(texto(encabezado, 'IdDoc', 'Folio') ?? 0);
    const rutEmisor = normalizarRut(texto(encabezado, 'Emisor', 'RUTEmisor') ?? '');
    const dte: AnalisisDte = {
      indice,
      idDocumento: contenedor?.getAttribute('ID') ?? undefined,
      tipoDte,
      folio,
      fechaEmision: texto(encabezado, 'IdDoc', 'FchEmis') ?? '',
      rutEmisor,
      rutReceptor: normalizarRut(texto(encabezado, 'Receptor', 'RUTRecep') ?? ''),
      montoTotal: Number(texto(encabezado, 'Totales', 'MntTotal') ?? 0),
      estado: EstadoRecepDte.OK,
      glosa: GLOSA_RECEP_DTE[EstadoRecepDte.OK],
      errores: [],
    };
    const rechazar = (estado: EstadoRecepDteCodigo, detalle: string): AnalisisDte => ({
      ...dte,
      estado,
      glosa: glosaDte(estado, detalle),
      errores: [...dte.errores, detalle],
    });

    // Firma del DTE (y que referencie su Documento)
    const errFirma = [...(erroresFirmaPorDte.get(indice) ?? [])];
    const firmaDte = firmas.find((f) => f.duenio === indice);
    if (!firmaDte) errFirma.push('El DTE no contiene firma');
    else if (dte.idDocumento && firmaDte.uriReferencia !== `#${dte.idDocumento}`) {
      errFirma.push(`La firma del DTE referencia ${firmaDte.uriReferencia ?? '(sin URI)'} y no #${dte.idDocumento}`);
    }
    if (errFirma.length > 0) return rechazar(EstadoRecepDte.ERROR_FIRMA, errFirma[0]);

    // TED
    const ted = aislado ? /<TED\b[\s\S]*?<\/TED>/.exec(textosDte[indice])?.[0] : undefined;
    const resultadoTed = aislado
      ? verificarTedDeDte(ted, { tipoDte, folio, rutEmisor, montoTotal: dte.montoTotal })
      : { firmaValida: false, errores: ['No fue posible aislar el TED del DTE'] };
    if (!resultadoTed.firmaValida) return rechazar(EstadoRecepDte.ERROR_FIRMA, resultadoTed.errores[0]);

    // RUT emisor
    if (!validarRut(rutEmisor)) return rechazar(EstadoRecepDte.ERROR_RUT_EMISOR, `RUT emisor inválido (${rutEmisor})`);
    if (rutEmisor !== rutEmisorCaratula) {
      return rechazar(
        EstadoRecepDte.ERROR_RUT_EMISOR,
        `RUT emisor del DTE (${rutEmisor}) distinto al de la carátula (${rutEmisorCaratula})`,
      );
    }
    // RUT receptor
    if (dte.rutReceptor !== rutReceptor) {
      return rechazar(
        EstadoRecepDte.ERROR_RUT_RECEPTOR,
        `RUT receptor del DTE (${dte.rutReceptor}) no corresponde a ${rutReceptor}`,
      );
    }
    // Repetido
    const clave = `${rutEmisor}|${tipoDte}|${folio}`;
    const repetido =
      vistos.has(clave) ||
      (historial.dtes ?? []).some((h) => `${normalizarRut(h.rutEmisor)}|${h.tipoDte}|${h.folio}` === clave);
    vistos.add(clave);
    if (repetido) return rechazar(EstadoRecepDte.REPETIDO, `DTE ${tipoDte} folio ${folio} ya recibido`);
    // Datos del TED distintos a los del DTE
    if (resultadoTed.errores.length > 0) return rechazar(EstadoRecepDte.OTROS, resultadoTed.errores[0]);
    return dte;
  });
}
