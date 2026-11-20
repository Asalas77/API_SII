import type {
  DetalleLibroCV,
  DetalleLibroGuias,
  ImpuestoLibro,
  ResumenDocumentoLibro,
  TipoOperacionGuia,
} from '../dte-core/index.js';

/** Lo que se necesita de un documento emitido para armar los libros (subconjunto de la entidad). */
export interface DocumentoParaLibro {
  tipoDte: number;
  folio: number;
  fechaEmision: string;
  estado: string;
  rutReceptor: number | null;
  dvReceptor: string | null;
  razonSocialReceptor: string | null;
  montoNeto: number | null;
  montoExento: number | null;
  iva: number | null;
  montoTotal: number;
  xmlFirmado: string;
}

/** Tipos del libro de ventas que van con Detalle; las boletas solo como resumen. */
export const TIPOS_VENTA_DETALLE: readonly number[] = [33, 34, 56, 61];
export const TIPOS_BOLETA_RESUMEN: readonly number[] = [39, 41];
const TASA_IVA = 19;

/** Primer y último día (`AAAA-MM-DD`) del período `AAAA-MM`. */
export function rangoPeriodo(periodo: string): { desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) throw new Error(`Período inválido: ${periodo}`);
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, '0')}` };
}

/** Un documento rechazado por el SII no es una venta válida: no entra a los libros. */
export function entraAlLibro(d: Pick<DocumentoParaLibro, 'estado'>): boolean {
  return d.estado !== 'rechazado';
}

function bloqueTotales(xml: string): string {
  return /<Totales>([\s\S]*?)<\/Totales>/.exec(xml)?.[1] ?? '';
}

function numeroDe(bloque: string, etiqueta: string): number | undefined {
  const m = new RegExp(`<${etiqueta}>(\\d+)</${etiqueta}>`).exec(bloque);
  return m ? Number(m[1]) : undefined;
}

/** Montos del XML (`Totales`) para los documentos que no traen columnas de montos. */
export function totalesDeXml(xml: string): {
  neto?: number;
  exento?: number;
  iva?: number;
  tasaIva?: number;
  impuestos: ImpuestoLibro[];
} {
  const t = bloqueTotales(xml);
  const tasa = /<TasaIVA>([\d.]+)<\/TasaIVA>/.exec(t);
  const impuestos: ImpuestoLibro[] = [];
  for (const m of t.matchAll(/<ImptoReten>([\s\S]*?)<\/ImptoReten>/g)) {
    const codigo = numeroDe(m[1], 'TipoImp');
    const monto = numeroDe(m[1], 'MontoImp');
    const tasaImp = /<TasaImp>([\d.]+)<\/TasaImp>/.exec(m[1]);
    if (codigo !== undefined && monto !== undefined) {
      impuestos.push({ codigo, tasa: tasaImp ? Number(tasaImp[1]) : 0, monto });
    }
  }
  return {
    neto: numeroDe(t, 'MntNeto'),
    exento: numeroDe(t, 'MntExe'),
    iva: numeroDe(t, 'IVA'),
    tasaIva: tasa ? Number(tasa[1]) : undefined,
    impuestos,
  };
}

interface ReferenciaXml {
  tipo: number;
  folio: number;
  codRef?: number;
  fecha?: string;
}

/** Referencias numéricas del XML (se ignora `SET` y las no numéricas). */
export function referenciasDeXml(xml: string): ReferenciaXml[] {
  const r: ReferenciaXml[] = [];
  for (const m of xml.matchAll(/<Referencia>([\s\S]*?)<\/Referencia>/g)) {
    const tipo = /<TpoDocRef>(\d+)<\/TpoDocRef>/.exec(m[1]);
    const folio = /<FolioRef>(\d+)<\/FolioRef>/.exec(m[1]);
    if (!tipo || !folio) continue;
    const cod = /<CodRef>(\d)<\/CodRef>/.exec(m[1]);
    const fecha = /<FchRef>(\d{4}-\d{2}-\d{2})<\/FchRef>/.exec(m[1]);
    r.push({
      tipo: Number(tipo[1]),
      folio: Number(folio[1]),
      ...(cod ? { codRef: Number(cod[1]) } : {}),
      ...(fecha ? { fecha: fecha[1] } : {}),
    });
  }
  return r;
}

function rutReceptor(d: DocumentoParaLibro): string | undefined {
  return d.rutReceptor === null || d.dvReceptor === null ? undefined : `${d.rutReceptor}-${d.dvReceptor}`;
}

/**
 * Línea del libro de ventas para un documento emitido (33, 34, 56, 61). Usa las columnas de montos
 * y, si faltan, el `Totales` del XML firmado; los impuestos adicionales salen siempre del XML. Un
 * documento en estado `anulado` (folio anulado) se informa solo con su tipo y folio.
 */
export function documentoADetalleVenta(d: DocumentoParaLibro): DetalleLibroCV {
  if (d.estado === 'anulado') return { tipoDoc: d.tipoDte, folio: d.folio, anulado: true };
  const x = totalesDeXml(d.xmlFirmado);
  const neto = d.montoNeto ?? x.neto ?? 0;
  const exento = d.montoExento ?? x.exento ?? 0;
  const iva = d.iva ?? x.iva ?? 0;
  // Nota de crédito que anula por completo otro documento: se informa la referencia.
  const anulada = d.tipoDte === 61 ? referenciasDeXml(d.xmlFirmado).find((r) => r.codRef === 1 && [33, 34, 56].includes(r.tipo)) : undefined;
  return {
    tipoDoc: d.tipoDte,
    folio: d.folio,
    fechaDoc: d.fechaEmision,
    ...(rutReceptor(d) ? { rutContraparte: rutReceptor(d) } : {}),
    ...(d.razonSocialReceptor ? { razonSocial: d.razonSocialReceptor } : {}),
    ...(neto > 0 ? { tasaIva: x.tasaIva ?? TASA_IVA } : {}),
    ...(exento > 0 ? { montoExento: exento } : {}),
    ...(neto > 0 ? { montoNeto: neto } : {}),
    montoIva: iva,
    ...(x.impuestos.length > 0 ? { otrosImpuestos: x.impuestos } : {}),
    montoTotal: d.montoTotal,
    ...(anulada ? { tipoDocRef: anulada.tipo, folioDocRef: anulada.folio } : {}),
  };
}

/** Resumen por tipo (39/41) de las boletas del período; los folios anulados cuentan pero no suman montos. */
export function resumenesDeBoletas(docs: DocumentoParaLibro[]): ResumenDocumentoLibro[] {
  const porTipo = new Map<number, ResumenDocumentoLibro>();
  for (const d of docs) {
    let r = porTipo.get(d.tipoDte);
    if (!r) {
      r = { tipoDoc: d.tipoDte, cantidad: 0, cantidadAnulados: 0, montoExento: 0, montoNeto: 0, montoIva: 0, montoTotal: 0 };
      porTipo.set(d.tipoDte, r);
    }
    r.cantidad += 1;
    if (d.estado === 'anulado') {
      r.cantidadAnulados = (r.cantidadAnulados ?? 0) + 1;
      continue;
    }
    const x = totalesDeXml(d.xmlFirmado);
    r.montoNeto += d.montoNeto ?? x.neto ?? 0;
    r.montoExento += d.montoExento ?? x.exento ?? 0;
    r.montoIva += d.iva ?? x.iva ?? 0;
    r.montoTotal += d.montoTotal;
  }
  return [...porTipo.values()]
    .map((r) => (r.cantidadAnulados === 0 ? { ...r, cantidadAnulados: undefined } : r))
    .sort((a, b) => a.tipoDoc - b.tipoDoc);
}

/** `IndTraslado` de la guía -> `TpoOper` del libro (8 traslado para exportación: otros; 9 venta de exportación: venta). */
const TIPO_OPERACION_POR_TRASLADO: Record<number, TipoOperacionGuia> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 6, 9: 1 };

/** Línea del libro de guías para una guía de despacho (52) emitida. */
export function documentoADetalleGuia(d: DocumentoParaLibro): DetalleLibroGuias {
  if (d.estado === 'anulado') return { folio: d.folio, anulado: 1 };
  const x = totalesDeXml(d.xmlFirmado);
  const traslado = /<IndTraslado>(\d)<\/IndTraslado>/.exec(d.xmlFirmado);
  const tipoOperacion = TIPO_OPERACION_POR_TRASLADO[traslado ? Number(traslado[1]) : 1] ?? 1;
  const neto = d.montoNeto ?? x.neto ?? 0;
  const iva = d.iva ?? x.iva ?? 0;
  const ref = referenciasDeXml(d.xmlFirmado).find((r) => [33, 34].includes(r.tipo));
  return {
    folio: d.folio,
    tipoOperacion,
    fechaDoc: d.fechaEmision,
    ...(rutReceptor(d) ? { rutReceptor: rutReceptor(d) } : {}),
    ...(d.razonSocialReceptor ? { razonSocial: d.razonSocialReceptor } : {}),
    ...(neto > 0 ? { montoNeto: neto, tasaIva: x.tasaIva ?? TASA_IVA, iva } : {}),
    montoTotal: d.montoTotal,
    ...(ref ? { tipoDocRef: ref.tipo, folioDocRef: ref.folio, ...(ref.fecha ? { fechaDocRef: ref.fecha } : {}) } : {}),
  };
}
