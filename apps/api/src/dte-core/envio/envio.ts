import { firmarXml } from '../firma/firma.js';
import { aIso88591, escaparXml, formatearRut, formatearTimestampSii, formatearFechaSii, validarDv } from '../xml/xml.util.js';
import { ErrorValidacionDte } from '../documento/errores.js';
import { NS_SII, NS_XSI } from '../documento/construir-dte.js';

/** RUT del SII como receptor de los envíos. */
export const RUT_SII = '60803000-K';

/** Máximos del sobre: `EnvioDTE_v10.xsd` admite 2000 DTE; `EnvioBOLETA_v11.xsd`, 500 boletas. */
export const MAX_DTE_POR_SOBRE = 2000;
export const MAX_BOLETAS_POR_SOBRE = 500;
/** Tamaño recomendado de un envío de boletas (menor latencia y menos reintentos). */
export const BOLETAS_POR_SOBRE_RECOMENDADO = 50;

export interface CaratulaEnvio {
  /** RUT del emisor (cuerpo numérico) y DV. */
  rutEmisor: string | number;
  dvEmisor: string;
  /** RUT de quien envía (titular del certificado digital) y DV. */
  rutEnvia: string | number;
  dvEnvia: string;
  /** Formato `12345678-9`. Por defecto el SII (`60803000-K`); en intercambio, el RUT del cliente. */
  rutReceptor?: string;
  /** Fecha de la resolución que autoriza al emisor. */
  fechaResolucion: Date | string;
  numeroResolucion: number;
  /** Momento de firma del sobre (`TmstFirmaEnv`). Por defecto, ahora. */
  fechaFirma?: Date;
}

export interface OpcionesEnvio {
  dtesFirmados: string[];
  caratula: CaratulaEnvio;
  certificado: { certificadoPem: string; clavePrivadaPem: string };
}

export interface EnvioConstruido {
  /** Sobre firmado, sin declaración XML. */
  xml: string;
  /** Sobre con declaración ISO-8859-1, codificado en Latin-1. */
  xmlIso: Buffer;
}

const ID_SET = 'SetDoc';

function rutDe(rut: string | number, dv: string, ctx: string): string {
  const cuerpo = String(rut).replace(/\D/g, '');
  if (!cuerpo || !/^[\dkK]$/.test(dv) || !validarDv(cuerpo, dv)) {
    throw new ErrorValidacionDte(`${ctx}: RUT inválido (${rut}-${dv})`);
  }
  return formatearRut(cuerpo, dv);
}

/** Quita la declaración `<?xml ...?>` y espacios externos; el contenido no se re-serializa. */
function sinDeclaracion(xml: string): string {
  return xml.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, '').trim();
}

/** Tipo (`TipoDTE`) de un DTE firmado, leído del texto sin parsear el XML completo. */
function tipoDeDte(dte: string, indice: number): number {
  const m = /<IdDoc>\s*<TipoDTE>(\d+)<\/TipoDTE>/.exec(dte);
  if (!dte.trimStart().startsWith('<DTE') || !m) {
    throw new ErrorValidacionDte(`El documento ${indice + 1} no es un <DTE> válido (falta IdDoc/TipoDTE)`);
  }
  if (!dte.includes('<Signature')) throw new ErrorValidacionDte(`El DTE ${indice + 1} no está firmado`);
  return Number(m[1]);
}

function fechaResolucion(f: Date | string): string {
  if (typeof f === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new ErrorValidacionDte(`fechaResolucion inválida: ${f}`);
    return f;
  }
  return formatearFechaSii(f);
}

function construirSobre(
  raiz: 'EnvioDTE' | 'EnvioBOLETA',
  esquema: string,
  opciones: OpcionesEnvio,
  tiposPermitidos: readonly number[] | undefined,
  maximo: number,
): EnvioConstruido {
  const { dtesFirmados, caratula, certificado } = opciones;
  if (dtesFirmados.length === 0) throw new ErrorValidacionDte('El sobre debe contener al menos un documento');
  if (dtesFirmados.length > maximo) {
    throw new ErrorValidacionDte(`El sobre ${raiz} admite como máximo ${maximo} documentos (recibidos ${dtesFirmados.length})`);
  }
  if (!Number.isInteger(caratula.numeroResolucion) || caratula.numeroResolucion < 0 || caratula.numeroResolucion > 999999) {
    throw new ErrorValidacionDte(`numeroResolucion inválido: ${caratula.numeroResolucion}`);
  }

  const dtes = dtesFirmados.map(sinDeclaracion);
  const conteo = new Map<number, number>();
  dtes.forEach((dte, i) => {
    const tipo = tipoDeDte(dte, i);
    if (tiposPermitidos && !tiposPermitidos.includes(tipo)) {
      throw new ErrorValidacionDte(`El sobre ${raiz} solo admite documentos tipo ${tiposPermitidos.join('/')} (recibido ${tipo})`);
    }
    conteo.set(tipo, (conteo.get(tipo) ?? 0) + 1);
  });
  const subTotales = [...conteo.entries()].sort((a, b) => a[0] - b[0]);
  if (raiz === 'EnvioBOLETA' && subTotales.length > 2) throw new ErrorValidacionDte('Demasiados tipos de boleta en el sobre');
  if (raiz === 'EnvioDTE' && subTotales.length > 20) throw new ErrorValidacionDte('Demasiados tipos de documento en el sobre');

  const rutEmisor = rutDe(caratula.rutEmisor, caratula.dvEmisor, 'rutEmisor');
  const rutEnvia = rutDe(caratula.rutEnvia, caratula.dvEnvia, 'rutEnvia');
  const rutReceptor = (caratula.rutReceptor ?? RUT_SII).replace(/\./g, '').toUpperCase();
  if (!/^\d+-[\dK]$/.test(rutReceptor) || rutReceptor.length > 10) {
    throw new ErrorValidacionDte(`rutReceptor inválido: ${caratula.rutReceptor}`);
  }
  const ts = formatearTimestampSii(caratula.fechaFirma ?? new Date());

  const caratulaXml =
    '<Caratula version="1.0">' +
    `<RutEmisor>${rutEmisor}</RutEmisor>` +
    `<RutEnvia>${rutEnvia}</RutEnvia>` +
    `<RutReceptor>${escaparXml(rutReceptor)}</RutReceptor>` +
    `<FchResol>${fechaResolucion(caratula.fechaResolucion)}</FchResol>` +
    `<NroResol>${caratula.numeroResolucion}</NroResol>` +
    `<TmstFirmaEnv>${ts}</TmstFirmaEnv>` +
    subTotales.map(([tipo, n]) => `<SubTotDTE><TpoDTE>${tipo}</TpoDTE><NroDTE>${n}</NroDTE></SubTotDTE>`).join('') +
    '</Caratula>';

  const sobre =
    `<${raiz} xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}" xsi:schemaLocation="${NS_SII} ${esquema}" version="1.0">` +
    `<SetDTE ID="${ID_SET}">${caratulaXml}${dtes.join('')}</SetDTE>` +
    `</${raiz}>`;

  const xml = firmarXml(sobre, { ...certificado, idReferencia: ID_SET });
  return { xml, xmlIso: aIso88591(xml) };
}

/**
 * Arma y firma el sobre `EnvioDTE` (33, 34, 52, 56, 61). Los DTE firmados se insertan textualmente
 * (solo se quita su declaración XML) para no romper sus firmas. `SubTotDTE` se agrupa por tipo.
 * Hasta 2000 DTE por sobre (XSD).
 */
export function construirEnvioDte(opciones: OpcionesEnvio): EnvioConstruido {
  return construirSobre('EnvioDTE', 'EnvioDTE_v10.xsd', opciones, [33, 34, 46, 52, 56, 61], MAX_DTE_POR_SOBRE);
}

/**
 * Arma y firma el sobre `EnvioBOLETA` (solo boletas 39/41). Máximo 500 boletas (límite del SII;
 * se recomiendan {@link BOLETAS_POR_SOBRE_RECOMENDADO} por envío).
 */
export function construirEnvioBoleta(opciones: OpcionesEnvio): EnvioConstruido {
  return construirSobre('EnvioBOLETA', 'EnvioBOLETA_v11.xsd', opciones, [39, 41], MAX_BOLETAS_POR_SOBRE);
}
