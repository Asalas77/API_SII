import { createHash } from 'node:crypto';
import { desdeIso88591 } from '../dte-core/index.js';
import { totalesDeXml } from '../libros/libros-desde-documentos.js';

/** SHA-256 hexadecimal del archivo tal cual llegó (clave de deduplicación por empresa). */
export function hashArchivo(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Texto del XML según su declaración (ISO-8859-1 por defecto, UTF-8 si lo declara o trae BOM). */
export function decodificarXml(buffer: Buffer): string {
  const cabecera = buffer.subarray(0, 200).toString('latin1');
  const declarada = /^﻿?\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera)?.[1]?.toLowerCase();
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const texto = declarada === 'utf-8' || bom ? buffer.toString('utf8') : desdeIso88591(buffer);
  return texto.replace(/^﻿/, '');
}

/** Los `<DTE>` del sobre, textuales (cada uno conserva su firma verificable). */
export function extraerDtesDeSobre(textoXml: string): string[] {
  return [...textoXml.matchAll(/<DTE\b[\s\S]*?<\/DTE>/g)].map((m) => m[0]);
}

/** Valor del primer `<etiqueta>` (sin atributos) del texto. */
function valor(texto: string, etiqueta: string): string | undefined {
  const v = new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(texto)?.[1]?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/** `TmstFirmaEnv` de la carátula como instante (hora de Chile si no trae zona). */
export function fechaFirmaDeSobre(textoXml: string): Date | undefined {
  const t = valor(/<Caratula[\s\S]*?<\/Caratula>/.exec(textoXml)?.[0] ?? '', 'TmstFirmaEnv');
  if (!t) return undefined;
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** `RutEmisor` de la carátula tal como viene (para responder aunque el sobre no valide). */
export function rutEmisorDeCaratula(textoXml: string): string | undefined {
  return valor(/<Caratula[\s\S]*?<\/Caratula>/.exec(textoXml)?.[0] ?? '', 'RutEmisor')?.toUpperCase();
}

export interface DatosDte {
  razonSocialEmisor?: string;
  montoNeto?: number;
  montoExento?: number;
  iva?: number;
  otrosImpuestos: Array<{ codigo: number; tasa: number; monto: number }>;
}

/** Datos del DTE que el análisis del intercambio no entrega (emisor y desglose de montos). */
export function datosDeDte(dteXml: string): DatosDte {
  const encabezado = /<Emisor>[\s\S]*?<\/Emisor>/.exec(dteXml)?.[0] ?? '';
  const t = totalesDeXml(dteXml);
  return {
    razonSocialEmisor: valor(encabezado, 'RznSoc') ?? valor(encabezado, 'RznSocEmisor'),
    montoNeto: t.neto,
    montoExento: t.exento,
    iva: t.iva,
    otrosImpuestos: t.impuestos,
  };
}
