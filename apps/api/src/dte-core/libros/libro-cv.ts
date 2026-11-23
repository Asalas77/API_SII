import { ErrorValidacionDte } from '../documento/errores.js';
import { firmarXml } from '../firma/firma.js';
import { aIso88591, formatearTimestampSii } from '../xml/xml.util.js';
import {
  type CertificadoFirma,
  enteroNoNegativo,
  enteroSigno,
  fechaLibro,
  NS_SII_LIBRO,
  NS_XSI_LIBRO,
  periodoLibro,
  resolucionLibro,
  rutLibro,
  tag,
  tagOpc,
  textoLibro,
  type TipoEnvioLibro,
  type TipoLibro,
  validarCaratulaComun,
} from './comun.js';

// ---------------------------------------------------------------------------------------------
// Modelo de entrada
// ---------------------------------------------------------------------------------------------

export type TipoOperacionLibro = 'COMPRA' | 'VENTA';

export interface CaratulaLibroCV {
  /** RUT del contribuyente dueño del libro (`76086428-5`). */
  rutEmisorLibro: string;
  /** RUT de quien envía (titular del certificado). */
  rutEnvia: string;
  /** `AAAA-MM`. En libros ESPECIAL de varios períodos, el primero. */
  periodoTributario: string;
  /** Fecha y número de la resolución que autoriza al contribuyente. */
  fechaResolucion: string;
  numeroResolucion: number;
  tipoOperacion: TipoOperacionLibro;
  tipoLibro: TipoLibro;
  tipoEnvio: TipoEnvioLibro;
  /** Obligatorio en envíos PARCIAL. */
  nroSegmento?: number;
  /** Obligatorio si `tipoLibro` es ESPECIAL (set de pruebas: 1 ventas, 2 compras). */
  folioNotificacion?: number;
  /** Obligatorio si `tipoLibro` es RECTIFICA. */
  codAutRec?: string;
}

/** Códigos de IVA no recuperable (compras). */
export type CodigoIvaNoRecuperable = 1 | 2 | 3 | 4 | 9;
export const CODIGOS_IVA_NO_RECUPERABLE: readonly number[] = [1, 2, 3, 4, 9];

export interface ImpuestoLibro {
  /** Código de impuesto o recargo (tabla 7 del formato; p. ej. 15 IVA retenido total, 28 combustibles). */
  codigo: number;
  /** Tasa en % (hasta 3 enteros y 2 decimales). */
  tasa: number;
  /** Valor del impuesto (con derecho a crédito en compras). */
  monto: number;
}

/**
 * Una línea del Detalle. Los montos son pesos enteros y positivos: el tipo de documento (nota de
 * crédito, etc.) determina cómo los interpreta el SII. Un documento `anulado` (folio anulado antes
 * de enviarse al SII) solo informa tipo y folio.
 */
export interface DetalleLibroCV {
  tipoDoc: number;
  folio: number;
  anulado?: boolean;
  /** Solo en envíos AJUSTE: 1 agrega (por defecto), 2 elimina. */
  operacion?: 1 | 2;
  /** `Emisor=1`: nota de crédito/débito que afecta a una factura de compra. */
  notaDeFacturaDeCompra?: boolean;
  /** `IndFactCompra=1`. */
  facturaDeCompra?: boolean;
  /** 1 IVA (por defecto), 2 Ley 18.211. */
  tipoImpuesto?: 1 | 2;
  /** Tasa del IVA en %. Por defecto 19 cuando hay neto o IVA. */
  tasaIva?: number;
  numeroInterno?: string;
  indServicio?: 1 | 2 | 3;
  indSinCosto?: 1;
  /** `AAAA-MM-DD`. */
  fechaDoc?: string;
  codigoSucursal?: number;
  /** Receptor (ventas) o proveedor (compras). */
  rutContraparte?: string;
  razonSocial?: string;
  /**
   * Receptor extranjero (exportación 110/111/112): `NumId` (hasta 20) y `Nacionalidad` (código de país de Aduana,
   * hasta 3 caracteres). Va entre `RznSoc` y `TpoDocRef`.
   */
  extranjero?: { numId?: string; nacionalidad?: string };
  tipoDocRef?: number;
  folioDocRef?: number;

  montoExento?: number;
  montoNeto?: number;
  /** IVA con derecho a crédito (compras) o IVA del documento (ventas). Por defecto `round(neto * tasa)`. */
  montoIva?: number;
  /** Parte del neto que corresponde a activo fijo (ya incluida en `montoNeto`). */
  montoNetoActivoFijo?: number;
  ivaActivoFijo?: number;
  ivaNoRecuperable?: Array<{ codigo: CodigoIvaNoRecuperable; monto: number }>;
  ivaUsoComun?: number;
  /** Ventas: IVA de una nota de crédito fuera de plazo (ya incluido en `montoIva`). */
  ivaFueraPlazo?: number;
  ivaPropio?: number;
  ivaTerceros?: number;
  otrosImpuestos?: ImpuestoLibro[];
  /** Impuestos sin derecho a crédito (compras). */
  impuestoSinCredito?: number;
  ivaRetenidoTotal?: number;
  ivaRetenidoParcial?: number;
  ivaNoRetenido?: number;
  creditoEmpresaConstructora?: number;
  depositoEnvases?: number;
  /**
   * Monto total. Si se omite se calcula; si se informa y no cuadra con los componentes se rechaza
   * (el SII valida la cuadratura).
   */
  montoTotal?: number;
}

/** Documentos que solo viajan totalizados en el ResumenPeriodo (boletas 39/41, etc.). */
export interface ResumenDocumentoLibro {
  tipoDoc: number;
  cantidad: number;
  cantidadAnulados?: number;
  montoExento: number;
  montoNeto: number;
  montoIva: number;
  montoTotal: number;
}

export interface OpcionesLibroCV {
  caratula: CaratulaLibroCV;
  detalle: DetalleLibroCV[];
  /** Solo ResumenPeriodo (boletas u otros documentos tipo resumen). */
  resumenesAdicionales?: ResumenDocumentoLibro[];
  /**
   * Envío AJUSTE: el ResumenPeriodo debe totalizar todo el período *incluido* el ajuste; aquí se
   * entregan esos documentos (sin `operacion`). En los demás envíos se ignora.
   */
  documentosPeriodo?: DetalleLibroCV[];
  /** Compras: factor de proporcionalidad del IVA de uso común (0,001 a 99,999). */
  factorProporcionalidad?: number;
  certificado: CertificadoFirma;
  fechaFirma?: Date;
  /** Atributo `ID` de `EnvioLibro` (por defecto derivado de operación, período y tipo de envío). */
  idEnvio?: string;
}

// ---------------------------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------------------------

/** Totales de un tipo de documento (una fila de `TotalesPeriodo` o `TotalesSegmento`). */
export interface TotalesTipoDoc {
  tipoDoc: number;
  tipoImpuesto: 1 | 2;
  cantidad: number;
  anulados: number;
  montoExento: number;
  montoNeto: number;
  montoIva: number;
  ivaUsoComun: number;
  ivaNoRecuperable: Array<{ codigo: number; cantidad: number; monto: number }>;
  otrosImpuestos: Array<{ codigo: number; monto: number }>;
  impuestoSinCredito: number;
  montoTotal: number;
}

export interface LibroConstruido {
  /** Libro firmado, sin declaración XML. */
  xml: string;
  /** Libro firmado con declaración ISO-8859-1, codificado en Latin-1. */
  xmlIso: Buffer;
  idEnvio: string;
  resumenPeriodo: TotalesTipoDoc[] | null;
  resumenSegmento: TotalesTipoDoc[] | null;
  /**
   * Saldo informativo del período: las notas de crédito (60, 61, 112) restan y el resto suma. El
   * XML lleva cada tipo con montos positivos, tal como lo pide el formato.
   */
  saldo: { montoExento: number; montoNeto: number; montoIva: number; montoTotal: number } | null;
  /** Cantidad de líneas de Detalle emitidas. */
  cantidadDetalle: number;
  advertencias: string[];
}

// ---------------------------------------------------------------------------------------------
// Constantes del formato
// ---------------------------------------------------------------------------------------------

/** Tipos que solo se informan en el resumen (no van en el Detalle). */
export const TIPOS_SOLO_RESUMEN: readonly number[] = [35, 38, 39, 41, 105, 500, 501, 919, 920, 922, 924];
/** Notas de crédito: restan en el saldo. */
export const TIPOS_NOTA_CREDITO: readonly number[] = [60, 61, 112];
const MAX_TOTALES = 40;
const TASA_IVA_DEFECTO = 19;

// ---------------------------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------------------------

interface Fila {
  d: DetalleLibroCV;
  anulado: boolean;
  signo: 1 | -1;
  tipoImp: 1 | 2;
  tasa: number | undefined;
  exento: number;
  neto: number;
  iva: number;
  netoAF: number;
  ivaAF: number;
  noRec: Array<{ codigo: number; monto: number }>;
  usoComun: number;
  fueraPlazo: number;
  propio: number;
  terceros: number;
  otros: ImpuestoLibro[];
  sinCred: number;
  retTotal: number;
  retParcial: number;
  noRetenido: number;
  credEC: number;
  depEnvase: number;
  total: number;
}

function redondear(n: number): number {
  return Math.round(n);
}

function validarFila(d: DetalleLibroCV, i: number, op: TipoOperacionLibro): Fila {
  const ctx = `Detalle ${i + 1} (tipo ${d.tipoDoc} folio ${d.folio})`;
  if (!Number.isInteger(d.tipoDoc) || d.tipoDoc <= 0) throw new ErrorValidacionDte(`${ctx}: tipoDoc inválido`);
  if (TIPOS_SOLO_RESUMEN.includes(d.tipoDoc)) {
    throw new ErrorValidacionDte(`${ctx}: el tipo ${d.tipoDoc} solo se informa en el resumen (resumenesAdicionales)`);
  }
  if (!Number.isInteger(d.folio) || d.folio <= 0 || d.folio > 9_999_999_999) {
    throw new ErrorValidacionDte(`${ctx}: folio inválido`);
  }
  const signo: 1 | -1 = d.operacion === 2 ? -1 : 1;
  const base = {
    d,
    signo,
    tipoImp: d.tipoImpuesto ?? 1,
  };
  if (d.anulado) {
    return {
      ...base,
      anulado: true,
      tasa: undefined,
      exento: 0, neto: 0, iva: 0, netoAF: 0, ivaAF: 0, noRec: [], usoComun: 0, fueraPlazo: 0,
      propio: 0, terceros: 0, otros: [], sinCred: 0, retTotal: 0, retParcial: 0, noRetenido: 0,
      credEC: 0, depEnvase: 0, total: 0,
    };
  }

  if (d.fechaDoc === undefined) throw new ErrorValidacionDte(`${ctx}: falta fechaDoc`);
  fechaLibro(d.fechaDoc, `${ctx}: fechaDoc`);
  if (d.rutContraparte === undefined) {
    throw new ErrorValidacionDte(`${ctx}: falta el RUT ${op === 'VENTA' ? 'del receptor' : 'del proveedor'}`);
  }
  rutLibro(d.rutContraparte, `${ctx}: rutContraparte`);

  const n = (v: number | undefined, campo: string) => (v === undefined ? 0 : enteroNoNegativo(v, `${ctx}: ${campo}`));
  const exento = n(d.montoExento, 'montoExento');
  const neto = n(d.montoNeto, 'montoNeto');
  let tasa = d.tasaIva;
  if (tasa !== undefined && (typeof tasa !== 'number' || tasa < 0 || tasa > 100)) {
    throw new ErrorValidacionDte(`${ctx}: tasaIva inválida`);
  }
  const ivaCalculado = redondear((neto * (tasa ?? TASA_IVA_DEFECTO)) / 100);
  const iva = d.montoIva === undefined ? ivaCalculado : n(d.montoIva, 'montoIva');
  if (tasa === undefined && (neto > 0 || iva > 0)) tasa = TASA_IVA_DEFECTO;

  const netoAF = n(d.montoNetoActivoFijo, 'montoNetoActivoFijo');
  if (netoAF > neto) throw new ErrorValidacionDte(`${ctx}: el neto de activo fijo excede el monto neto`);
  const noRec = (d.ivaNoRecuperable ?? []).map((x) => {
    if (!CODIGOS_IVA_NO_RECUPERABLE.includes(x.codigo)) {
      throw new ErrorValidacionDte(`${ctx}: código de IVA no recuperable inválido (${x.codigo})`);
    }
    return { codigo: x.codigo, monto: n(x.monto, 'ivaNoRecuperable.monto') };
  });
  if (new Set(noRec.map((x) => x.codigo)).size !== noRec.length) {
    throw new ErrorValidacionDte(`${ctx}: código de IVA no recuperable repetido`);
  }
  if (noRec.length > 5) throw new ErrorValidacionDte(`${ctx}: máximo 5 códigos de IVA no recuperable`);
  const otros = (d.otrosImpuestos ?? []).map((x) => {
    if (!Number.isInteger(x.codigo) || x.codigo <= 0) throw new ErrorValidacionDte(`${ctx}: código de impuesto inválido`);
    if (typeof x.tasa !== 'number' || x.tasa < 0 || x.tasa > 999.99) {
      throw new ErrorValidacionDte(`${ctx}: tasa del impuesto ${x.codigo} inválida`);
    }
    return { codigo: x.codigo, tasa: x.tasa, monto: n(x.monto, `impuesto ${x.codigo}`) };
  });
  if (otros.length > 20) throw new ErrorValidacionDte(`${ctx}: máximo 20 otros impuestos`);

  const fila: Fila = {
    ...base,
    anulado: false,
    tasa,
    exento,
    neto,
    iva,
    netoAF,
    ivaAF: n(d.ivaActivoFijo, 'ivaActivoFijo'),
    noRec,
    usoComun: n(d.ivaUsoComun, 'ivaUsoComun'),
    fueraPlazo: n(d.ivaFueraPlazo, 'ivaFueraPlazo'),
    propio: n(d.ivaPropio, 'ivaPropio'),
    terceros: n(d.ivaTerceros, 'ivaTerceros'),
    otros,
    sinCred: n(d.impuestoSinCredito, 'impuestoSinCredito'),
    retTotal: n(d.ivaRetenidoTotal, 'ivaRetenidoTotal'),
    retParcial: n(d.ivaRetenidoParcial, 'ivaRetenidoParcial'),
    noRetenido: n(d.ivaNoRetenido, 'ivaNoRetenido'),
    credEC: n(d.creditoEmpresaConstructora, 'creditoEmpresaConstructora'),
    depEnvase: n(d.depositoEnvases, 'depositoEnvases'),
    total: 0,
  };
  const calculado =
    fila.exento +
    fila.neto +
    fila.iva +
    fila.usoComun +
    fila.noRec.reduce((s, x) => s + x.monto, 0) +
    fila.otros.reduce((s, x) => s + x.monto, 0) +
    fila.sinCred +
    fila.depEnvase -
    fila.retTotal -
    fila.retParcial -
    fila.credEC;
  if (calculado < 0) throw new ErrorValidacionDte(`${ctx}: el monto total calculado es negativo`);
  if (d.montoTotal !== undefined) {
    const informado = enteroNoNegativo(d.montoTotal, `${ctx}: montoTotal`);
    if (informado !== calculado) {
      throw new ErrorValidacionDte(
        `${ctx}: el monto total informado (${informado}) no cuadra con los componentes (${calculado})`,
      );
    }
  }
  fila.total = calculado;
  return fila;
}

interface Acum {
  tipoDoc: number;
  tipoImp: 1 | 2;
  cantidad: number;
  anulados: number;
  opExe: number;
  exento: number;
  neto: number;
  opIvaRec: number;
  iva: number;
  opAF: number;
  netoAF: number;
  ivaAF: number;
  noRec: Map<number, { op: number; monto: number }>;
  opUsoComun: number;
  usoComun: number;
  fueraPlazo: number;
  propio: number;
  terceros: number;
  otros: Map<number, number>;
  sinCred: number;
  opRetTotal: number;
  retTotal: number;
  opRetParcial: number;
  retParcial: number;
  credEC: number;
  depEnvase: number;
  total: number;
  opNoRetenido: number;
  noRetenido: number;
}

function acumVacio(tipoDoc: number, tipoImp: 1 | 2): Acum {
  return {
    tipoDoc, tipoImp, cantidad: 0, anulados: 0, opExe: 0, exento: 0, neto: 0, opIvaRec: 0, iva: 0, opAF: 0,
    netoAF: 0, ivaAF: 0, noRec: new Map(), opUsoComun: 0, usoComun: 0, fueraPlazo: 0, propio: 0, terceros: 0,
    otros: new Map(), sinCred: 0, opRetTotal: 0, retTotal: 0, opRetParcial: 0, retParcial: 0, credEC: 0,
    depEnvase: 0, total: 0, opNoRetenido: 0, noRetenido: 0,
  };
}

function acumular(filas: Fila[]): Acum[] {
  const mapa = new Map<string, Acum>();
  for (const f of filas) {
    const clave = `${f.d.tipoDoc}|${f.tipoImp}`;
    let a = mapa.get(clave);
    if (!a) mapa.set(clave, (a = acumVacio(f.d.tipoDoc, f.tipoImp)));
    const s = f.signo;
    a.cantidad += s;
    if (f.anulado) {
      a.anulados += s;
      continue;
    }
    const cuenta = (v: number) => (v > 0 ? s : 0);
    a.opExe += cuenta(f.exento);
    a.exento += s * f.exento;
    a.neto += s * f.neto;
    a.opIvaRec += cuenta(f.iva);
    a.iva += s * f.iva;
    a.opAF += cuenta(f.netoAF + f.ivaAF);
    a.netoAF += s * f.netoAF;
    a.ivaAF += s * f.ivaAF;
    for (const x of f.noRec) {
      const prev = a.noRec.get(x.codigo) ?? { op: 0, monto: 0 };
      a.noRec.set(x.codigo, { op: prev.op + cuenta(x.monto), monto: prev.monto + s * x.monto });
    }
    a.opUsoComun += cuenta(f.usoComun);
    a.usoComun += s * f.usoComun;
    a.fueraPlazo += s * f.fueraPlazo;
    a.propio += s * f.propio;
    a.terceros += s * f.terceros;
    for (const x of f.otros) a.otros.set(x.codigo, (a.otros.get(x.codigo) ?? 0) + s * x.monto);
    a.sinCred += s * f.sinCred;
    a.opRetTotal += cuenta(f.retTotal);
    a.retTotal += s * f.retTotal;
    a.opRetParcial += cuenta(f.retParcial);
    a.retParcial += s * f.retParcial;
    a.credEC += s * f.credEC;
    a.depEnvase += s * f.depEnvase;
    a.total += s * f.total;
    a.opNoRetenido += cuenta(f.noRetenido);
    a.noRetenido += s * f.noRetenido;
  }
  return [...mapa.values()].sort((x, y) => x.tipoDoc - y.tipoDoc || x.tipoImp - y.tipoImp);
}

function aTotales(a: Acum): TotalesTipoDoc {
  return {
    tipoDoc: a.tipoDoc,
    tipoImpuesto: a.tipoImp,
    cantidad: a.cantidad,
    anulados: a.anulados,
    montoExento: a.exento,
    montoNeto: a.neto,
    montoIva: a.iva,
    ivaUsoComun: a.usoComun,
    ivaNoRecuperable: [...a.noRec.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([codigo, v]) => ({ codigo, cantidad: v.op, monto: v.monto })),
    otrosImpuestos: [...a.otros.entries()].sort((x, y) => x[0] - y[0]).map(([codigo, monto]) => ({ codigo, monto })),
    impuestoSinCredito: a.sinCred,
    montoTotal: a.total,
  };
}

function resumenAAcum(r: ResumenDocumentoLibro, i: number): Acum {
  const ctx = `resumenesAdicionales ${i + 1} (tipo ${r.tipoDoc})`;
  if (!Number.isInteger(r.tipoDoc) || r.tipoDoc <= 0) throw new ErrorValidacionDte(`${ctx}: tipoDoc inválido`);
  const a = acumVacio(r.tipoDoc, 1);
  a.cantidad = enteroNoNegativo(r.cantidad, `${ctx}: cantidad`);
  a.anulados = r.cantidadAnulados === undefined ? 0 : enteroNoNegativo(r.cantidadAnulados, `${ctx}: cantidadAnulados`);
  a.exento = enteroNoNegativo(r.montoExento, `${ctx}: montoExento`);
  a.neto = enteroNoNegativo(r.montoNeto, `${ctx}: montoNeto`);
  a.iva = enteroNoNegativo(r.montoIva, `${ctx}: montoIva`);
  a.total = enteroNoNegativo(r.montoTotal, `${ctx}: montoTotal`);
  if (a.exento + a.neto + a.iva !== a.total) {
    throw new ErrorValidacionDte(`${ctx}: el monto total no cuadra con exento + neto + IVA`);
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

/** Cantidad con signo: se omite si es cero. */
function opcCant(nombre: string, v: number): string {
  return v === 0 ? '' : tag(nombre, enteroSigno(v));
}

/** Monto con signo: se omite si es cero (campos opcionales). */
function opcMonto(nombre: string, v: number): string {
  return v === 0 ? '' : tag(nombre, enteroSigno(v));
}

function xmlTotales(
  a: Acum,
  nombreFila: 'TotalesPeriodo' | 'TotalesSegmento',
  factor: number | undefined,
): string {
  const periodo = nombreFila === 'TotalesPeriodo';
  // En el resumen de período los contadores son enteros positivos: se omiten si no son > 0.
  const cant = (n: string, v: number) => (periodo ? (v > 0 ? tag(n, v) : '') : opcCant(n, v));
  let creditoComun = '';
  let fct = '';
  if (periodo && factor !== undefined && a.usoComun > 0) {
    fct = tag('FctProp', factor.toFixed(3));
    creditoComun = tag('TotCredIVAUsoComun', redondear(factor * a.usoComun));
  }
  return (
    `<${nombreFila}>` +
    tag('TpoDoc', a.tipoDoc) +
    (a.tipoImp === 2 ? tag('TpoImp', 2) : '') +
    tag('TotDoc', periodo ? Math.max(0, a.cantidad) : enteroSigno(a.cantidad)) +
    cant('TotAnulado', a.anulados) +
    cant('TotOpExe', a.opExe) +
    tag('TotMntExe', enteroSigno(a.exento)) +
    tag('TotMntNeto', enteroSigno(a.neto)) +
    cant('TotOpIVARec', a.opIvaRec) +
    tag('TotMntIVA', enteroSigno(a.iva)) +
    cant('TotOpActivoFijo', a.opAF) +
    opcMonto('TotMntActivoFijo', a.netoAF) +
    opcMonto('TotMntIVAActivoFijo', a.ivaAF) +
    [...a.noRec.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(
        ([cod, v]) =>
          '<TotIVANoRec>' +
          tag('CodIVANoRec', cod) +
          cant('TotOpIVANoRec', v.op) +
          tag('TotMntIVANoRec', enteroSigno(v.monto)) +
          '</TotIVANoRec>',
      )
      .join('') +
    cant('TotOpIVAUsoComun', a.opUsoComun) +
    opcMonto('TotIVAUsoComun', a.usoComun) +
    fct +
    creditoComun +
    opcMonto('TotIVAFueraPlazo', a.fueraPlazo) +
    opcMonto('TotIVAPropio', a.propio) +
    opcMonto('TotIVATerceros', a.terceros) +
    [...a.otros.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([cod, m]) => `<TotOtrosImp>${tag('CodImp', cod)}${tag('TotMntImp', enteroSigno(m))}</TotOtrosImp>`)
      .join('') +
    opcMonto('TotImpSinCredito', a.sinCred) +
    cant('TotOpIVARetTotal', a.opRetTotal) +
    opcMonto('TotIVARetTotal', a.retTotal) +
    cant('TotOpIVARetParcial', a.opRetParcial) +
    opcMonto('TotIVARetParcial', a.retParcial) +
    opcMonto('TotCredEC', a.credEC) +
    opcMonto('TotDepEnvase', a.depEnvase) +
    tag('TotMntTotal', enteroSigno(a.total)) +
    cant('TotOpIVANoRetenido', a.opNoRetenido) +
    opcMonto('TotIVANoRetenido', a.noRetenido) +
    `</${nombreFila}>`
  );
}

function xmlExtranjero(e: DetalleLibroCV['extranjero']): string {
  if (!e || (!e.numId && !e.nacionalidad)) return '';
  return (
    '<Extranjero>' +
    (e.numId ? tag('NumId', textoLibro(e.numId, 20)) : '') +
    (e.nacionalidad ? tag('Nacionalidad', textoLibro(e.nacionalidad, 3)) : '') +
    '</Extranjero>'
  );
}

function xmlDetalle(f: Fila): string {
  const d = f.d;
  const cabecera =
    '<Detalle>' +
    tag('TpoDoc', d.tipoDoc) +
    (d.notaDeFacturaDeCompra ? tag('Emisor', 1) : '') +
    (d.facturaDeCompra ? tag('IndFactCompra', 1) : '') +
    tag('NroDoc', d.folio) +
    (f.anulado ? tag('Anulado', 'A') : '') +
    (d.operacion === undefined ? '' : tag('Operacion', d.operacion));
  if (f.anulado) return `${cabecera}</Detalle>`;

  const m = (nombre: string, v: number) => (v > 0 ? tag(nombre, v) : '');
  return (
    cabecera +
    (f.tipoImp === 2 ? tag('TpoImp', 2) : '') +
    tagOpc('TasaImp', f.tasa) +
    (d.numeroInterno ? tag('NumInt', textoLibro(d.numeroInterno, 10)) : '') +
    tagOpc('IndServicio', d.indServicio) +
    tagOpc('IndSinCosto', d.indSinCosto) +
    tag('FchDoc', d.fechaDoc as string) +
    tagOpc('CdgSIISucur', d.codigoSucursal) +
    tag('RUTDoc', rutLibro(d.rutContraparte as string, 'rutContraparte')) +
    (d.razonSocial ? tag('RznSoc', textoLibro(d.razonSocial, 50)) : '') +
    xmlExtranjero(d.extranjero) +
    tagOpc('TpoDocRef', d.tipoDocRef) +
    tagOpc('FolioDocRef', d.folioDocRef) +
    m('MntExe', f.exento) +
    m('MntNeto', f.neto) +
    tag('MntIVA', f.iva) +
    m('MntActivoFijo', f.netoAF) +
    m('MntIVAActivoFijo', f.ivaAF) +
    f.noRec
      .map((x) => `<IVANoRec>${tag('CodIVANoRec', x.codigo)}${tag('MntIVANoRec', x.monto)}</IVANoRec>`)
      .join('') +
    m('IVAUsoComun', f.usoComun) +
    m('IVAFueraPlazo', f.fueraPlazo) +
    m('IVAPropio', f.propio) +
    m('IVATerceros', f.terceros) +
    f.otros
      .map(
        (x) =>
          `<OtrosImp>${tag('CodImp', x.codigo)}${tag('TasaImp', x.tasa)}${tag('MntImp', x.monto)}</OtrosImp>`,
      )
      .join('') +
    m('MntSinCred', f.sinCred) +
    m('IVARetTotal', f.retTotal) +
    m('IVARetParcial', f.retParcial) +
    m('CredEC', f.credEC) +
    m('DepEnvase', f.depEnvase) +
    tag('MntTotal', f.total) +
    m('IVANoRetenido', f.noRetenido) +
    '</Detalle>'
  );
}

function saldoDe(acums: Acum[]) {
  const s = { montoExento: 0, montoNeto: 0, montoIva: 0, montoTotal: 0 };
  for (const a of acums) {
    const k = TIPOS_NOTA_CREDITO.includes(a.tipoDoc) ? -1 : 1;
    s.montoExento += k * a.exento;
    s.montoNeto += k * a.neto;
    s.montoIva += k * a.iva;
    s.montoTotal += k * a.total;
  }
  return s;
}

function validarCaratulaCV(c: CaratulaLibroCV): void {
  validarCaratulaComun(c);
  if (c.tipoOperacion !== 'COMPRA' && c.tipoOperacion !== 'VENTA') {
    throw new ErrorValidacionDte(`TipoOperacion inválido: ${String(c.tipoOperacion)}`);
  }
  if (c.tipoLibro === 'ESPECIAL' && c.folioNotificacion === undefined) {
    throw new ErrorValidacionDte('El libro ESPECIAL requiere FolioNotificacion');
  }
  if (c.tipoLibro === 'RECTIFICA' && !c.codAutRec) {
    throw new ErrorValidacionDte('El libro RECTIFICA requiere CodAutRec');
  }
  if (c.tipoLibro !== 'RECTIFICA' && c.codAutRec) {
    throw new ErrorValidacionDte('CodAutRec solo corresponde a libros RECTIFICA');
  }
  if (c.codAutRec && c.codAutRec.length > 10) throw new ErrorValidacionDte('CodAutRec admite hasta 10 caracteres');
}

/**
 * Arma, firma y devuelve el libro de compras o de ventas (`LibroCompraVenta`, IECV).
 *
 * - TOTAL: `ResumenPeriodo` + `Detalle`. PARCIAL: `ResumenSegmento` + `Detalle`.
 *   FINAL: solo `ResumenPeriodo` (calculado con `detalle`, que se entiende como todo el período, sin
 *   emitirlo). AJUSTE: `ResumenSegmento` (con signo) + `ResumenPeriodo` (de `documentosPeriodo`) + `Detalle`.
 * - Los totales por tipo excluyen los montos de folios anulados pero cuentan el documento en `TotDoc`.
 * - Se firma `EnvioLibro` (Id) y se valida con `validarXsd(xml, 'LibroCV')` en quien lo usa.
 *
 * No cubre: libros contables (CAL/COCERTIF), liquidaciones, Ley 18.211 como monto, tabacos, pasajes,
 * vehículos, montos no facturables, ni extranjeros. Ver `README.md`.
 */
export function construirLibroCompraVenta(opciones: OpcionesLibroCV): LibroConstruido {
  const { caratula: c } = opciones;
  validarCaratulaCV(c);
  const rutEmisor = rutLibro(c.rutEmisorLibro, 'rutEmisorLibro');
  const rutEnvia = rutLibro(c.rutEnvia, 'rutEnvia');
  const periodo = periodoLibro(c.periodoTributario);
  const res = resolucionLibro(c.fechaResolucion, c.numeroResolucion);
  const advertencias: string[] = [];

  if (opciones.factorProporcionalidad !== undefined) {
    const f = opciones.factorProporcionalidad;
    if (c.tipoOperacion !== 'COMPRA') throw new ErrorValidacionDte('El factor de proporcionalidad solo aplica a compras');
    if (typeof f !== 'number' || f < 0.001 || f > 99.999) {
      throw new ErrorValidacionDte('factorProporcionalidad debe estar entre 0,001 y 99,999');
    }
  }

  const filas = opciones.detalle.map((d, i) => validarFila(d, i, c.tipoOperacion));
  const vistos = new Set<string>();
  for (const f of filas) {
    const clave = `${f.d.tipoDoc}-${f.d.folio}-${f.d.operacion ?? 1}`;
    if (vistos.has(clave)) {
      throw new ErrorValidacionDte(`Documento repetido en el detalle: tipo ${f.d.tipoDoc} folio ${f.d.folio}`);
    }
    vistos.add(clave);
    if (c.tipoEnvio !== 'AJUSTE' && f.d.operacion !== undefined) {
      throw new ErrorValidacionDte('El campo operación solo corresponde a envíos AJUSTE');
    }
  }

  const adicionales = (opciones.resumenesAdicionales ?? []).map(resumenAAcum);
  for (const a of adicionales) {
    if (filas.some((f) => f.d.tipoDoc === a.tipoDoc)) {
      throw new ErrorValidacionDte(`El tipo ${a.tipoDoc} está en el detalle y también en resumenesAdicionales`);
    }
  }

  // --- Resúmenes ---
  const conDetalle = c.tipoEnvio !== 'FINAL' && filas.length > 0;
  let acumSegmento: Acum[] | null = null;
  let acumPeriodo: Acum[] | null = null;

  switch (c.tipoEnvio) {
    case 'TOTAL':
    case 'FINAL': {
      acumPeriodo = acumular(filas);
      break;
    }
    case 'PARCIAL': {
      if (filas.length === 0) throw new ErrorValidacionDte('El envío PARCIAL debe incluir Detalle');
      if (adicionales.length > 0) {
        throw new ErrorValidacionDte('Los documentos solo-resumen van en el ResumenPeriodo (envío TOTAL, FINAL o AJUSTE)');
      }
      acumSegmento = acumular(filas);
      break;
    }
    case 'AJUSTE': {
      if (!opciones.documentosPeriodo) {
        throw new ErrorValidacionDte(
          'El envío AJUSTE requiere documentosPeriodo: todos los documentos del período después del ajuste',
        );
      }
      acumSegmento = filas.length > 0 ? acumular(filas) : null;
      const completos = opciones.documentosPeriodo.map((d, i) => validarFila(d, i, c.tipoOperacion));
      acumPeriodo = acumular(completos);
      break;
    }
  }
  if (acumPeriodo) {
    acumPeriodo = [...acumPeriodo, ...adicionales].sort((x, y) => x.tipoDoc - y.tipoDoc || x.tipoImp - y.tipoImp);
  } else if (adicionales.length > 0) {
    throw new ErrorValidacionDte('Los documentos solo-resumen requieren un envío con ResumenPeriodo');
  }
  for (const [nombre, lista] of [['ResumenSegmento', acumSegmento], ['ResumenPeriodo', acumPeriodo]] as const) {
    if (lista && lista.length > MAX_TOTALES) {
      throw new ErrorValidacionDte(`${nombre}: máximo ${MAX_TOTALES} tipos de documento (hay ${lista.length})`);
    }
  }
  if (acumPeriodo && acumPeriodo.length === 0 && c.tipoEnvio !== 'TOTAL') {
    throw new ErrorValidacionDte(`El envío ${c.tipoEnvio} no tiene documentos que totalizar`);
  }
  if (c.tipoEnvio === 'TOTAL' && acumPeriodo?.length === 0) {
    acumPeriodo = null;
    advertencias.push('Libro sin documentos: se envía solo la carátula');
  }

  // --- XML ---
  const idEnvio =
    opciones.idEnvio ??
    `Libro${c.tipoOperacion === 'VENTA' ? 'Ventas' : 'Compras'}_${periodo.replace('-', '')}_${c.tipoEnvio}${
      c.nroSegmento ? `_${c.nroSegmento}` : ''
    }`;
  if (!/^[A-Za-z_][\w.-]*$/.test(idEnvio)) throw new ErrorValidacionDte(`idEnvio inválido: ${idEnvio}`);

  const caratulaXml =
    '<Caratula>' +
    tag('RutEmisorLibro', rutEmisor) +
    tag('RutEnvia', rutEnvia) +
    tag('PeriodoTributario', periodo) +
    tag('FchResol', res.fecha) +
    tag('NroResol', res.numero) +
    tag('TipoOperacion', c.tipoOperacion) +
    tag('TipoLibro', c.tipoLibro) +
    tag('TipoEnvio', c.tipoEnvio) +
    tagOpc('NroSegmento', c.nroSegmento) +
    tagOpc('FolioNotificacion', c.folioNotificacion) +
    (c.codAutRec ? tag('CodAutRec', textoLibro(c.codAutRec, 10)) : '') +
    '</Caratula>';

  const factor = opciones.factorProporcionalidad;
  const xmlSegmento = acumSegmento
    ? `<ResumenSegmento>${acumSegmento.map((a) => xmlTotales(a, 'TotalesSegmento', undefined)).join('')}</ResumenSegmento>`
    : '';
  const xmlPeriodo = acumPeriodo
    ? `<ResumenPeriodo>${acumPeriodo.map((a) => xmlTotales(a, 'TotalesPeriodo', factor)).join('')}</ResumenPeriodo>`
    : '';
  const xmlDet = conDetalle ? filas.map(xmlDetalle).join('') : '';
  const tmst = formatearTimestampSii(opciones.fechaFirma ?? new Date());

  const sinFirma =
    `<LibroCompraVenta xmlns="${NS_SII_LIBRO}" xmlns:xsi="${NS_XSI_LIBRO}" version="1.0">` +
    `<EnvioLibro ID="${idEnvio}">${caratulaXml}${xmlSegmento}${xmlPeriodo}${xmlDet}${tag('TmstFirma', tmst)}</EnvioLibro>` +
    '</LibroCompraVenta>';

  const xml = firmarXml(sinFirma, { ...opciones.certificado, idReferencia: idEnvio });
  return {
    xml,
    xmlIso: aIso88591(xml),
    idEnvio,
    resumenPeriodo: acumPeriodo ? acumPeriodo.map(aTotales) : null,
    resumenSegmento: acumSegmento ? acumSegmento.map(aTotales) : null,
    saldo: acumPeriodo ? saldoDe(acumPeriodo) : null,
    cantidadDetalle: conDetalle ? filas.length : 0,
    advertencias,
  };
}
