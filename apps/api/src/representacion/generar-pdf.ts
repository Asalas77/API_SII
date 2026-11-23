import PDFDocument from 'pdfkit';
import { DESCRIPCION_IND_TRASLADO } from '../dte-core/documento/traslado.js';
import {
  GLOSA_CLAUSULA,
  GLOSA_FORMA_PAGO,
  GLOSA_MODALIDAD,
  GLOSA_PAIS,
  GLOSA_PUERTO,
  GLOSA_TIPO_BULTO,
  GLOSA_UNIDAD,
  GLOSA_VIA,
} from '../dte-core/exportacion/tablas/index.js';
import { extraerDatosImpresion, type DatosImpresion, type TipoImpresion, type TrasladoImpresion } from './datos-impresion.js';
import { dimensionesPng, generarPdf417, PX_POR_MODULO, XDIM_PT } from './timbre-pdf417.js';

export interface OpcionesPdf {
  /** `carta` (por defecto, salvo boletas) o `termica80` (papel continuo de 80 mm, por defecto en boletas). */
  formato?: 'carta' | 'termica80';
  /** Dirección regional o unidad del SII del emisor (p. ej. `SANTIAGO CENTRO`). Se imprime bajo el recuadro. */
  unidadSii?: string;
  /** Resolución que autoriza al contribuyente (leyenda `Res. N de AAAA`). */
  resolucion: { numero: number; fecha: string };
  /** Agrega acuse de recibo y leyenda CEDIBLE (solo 33, 34 y 52; ver `admiteCedible`; nunca en exportación ni notas). */
  cedible?: boolean;
  /** Logo (PNG/JPEG), esquina superior izquierda. */
  logo?: Buffer;
  /** URL de consulta del documento, bajo la leyenda `Verifique documento` (opcional). */
  urlVerificacion?: string;
}

const ROJO = '#D00000';
const GRIS = '#888888';
const PT_POR_CM = 28.3465;

/** Texto legal del acuse de recibo (Res. Ex. SII N° 51 de 2005, Ley 19.983). */
export const TEXTO_ACUSE_RECIBO =
  'El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4°, y la letra c) del Art. 5° de la Ley 19.983, acredita que la entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s).';

/**
 * Según el Manual de Muestras Impresas: llevan copia cedible las facturas (33, 34) y las guías de despacho (52) que
 * constituyen venta; las notas de crédito/débito y las boletas no. Una guía que no constituye venta o es traslado
 * interno (IndTraslado 4 a 8) tampoco lleva cedible.
 */
export function admiteCedible(tipo: TipoImpresion, indTraslado?: number): boolean {
  if (tipo === 33 || tipo === 34) return true;
  if (tipo === 52) return indTraslado === undefined || [1, 2, 3, 9, 11].includes(indTraslado);
  return false;
}

// ---------- formato ----------

/** Separador de miles chileno (punto). No usa Intl: `es-CL` no agrupa los números de 4 cifras. */
export function formatearMonto(n: number): string {
  const r = Math.round(n);
  return (r < 0 ? '-' : '') + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Monto en moneda extranjera: separador de miles con punto y decimales con coma, mínimo 2 y máximo `maxDec`
 * (los ceros sobrantes se recortan). El peso chileno sigue usando `formatearMonto` (sin decimales).
 */
export function formatearMontoMoneda(n: number, maxDec = 4): string {
  const [ent = '0', dec = ''] = Math.abs(n).toFixed(maxDec).split('.');
  const frac = dec.replace(/0+$/, '').padEnd(2, '0');
  return `${n < 0 ? '-' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`;
}

function formatearCantidad(n: number): string {
  if (Number.isInteger(n)) return formatearMonto(n);
  const [ent, dec] = n.toFixed(4).replace(/0+$/, '').split('.');
  return `${formatearMonto(Number(ent))},${dec}`;
}

function formatearPrecio(n: number): string {
  return Number.isInteger(n) ? formatearMonto(n) : formatearCantidad(n);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

const FORMAS_PAGO: Record<number, string> = { 1: 'Contado', 2: 'Crédito', 3: 'Sin costo (entrega gratuita)' };
/** Descripción de cada `IndTraslado` (1 a 12, Anexo de la Res. Ex. SII 144/2026). */
const TRASLADOS: Readonly<Record<number, string>> = DESCRIPCION_IND_TRASLADO;

/**
 * Filas "etiqueta / valor" de la sección "Datos del traslado". Los datos que se informaron como "Diferido" o
 * "Sin Dato" se imprimen como `DIFERIDO` / `SIN DATO`; los que no se informaron no aparecen.
 */
export function filasTraslado(d: DatosImpresion): [string, string][] {
  const t: TrasladoImpresion | undefined = d.traslado;
  if (!t) return [];
  const m = t.marcadores;
  const marca = (c: keyof TrasladoImpresion['marcadores']): string | undefined => (m[c] ? m[c]!.toUpperCase() : undefined);
  const filas: [string, string | undefined][] = [
    ['Tipo de traslado:', d.indTraslado !== undefined && TRASLADOS[d.indTraslado] ? `${d.indTraslado} - ${TRASLADOS[d.indTraslado]}` : undefined],
    ['Origen:', t.origen],
    ['Destino:', t.destino],
    ['Chofer:', t.choferNombre ?? marca('choferNombre')],
    ['RUT chofer:', t.choferRut ?? marca('choferRut')],
    ['RUT transportista:', t.rutTransportista ?? marca('transportista')],
    ['Patente:', t.patente ?? marca('patente')],
    ['Patente carro:', t.patenteCarro ?? marca('patenteCarro')],
    ['Fecha salida:', t.fechaSalida ? `${fechaCorta(t.fechaSalida)}${t.horaSalida ? ' ' + t.horaSalida : ''}` : marca('fechaSalida')],
    ['Fecha llegada:', t.fechaLlegada ? fechaCorta(t.fechaLlegada) : undefined],
  ];
  return filas.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '');
}
function conGlosa(codigo: number | undefined, tabla: ReadonlyMap<number, string>): string | undefined {
  if (codigo === undefined) return undefined;
  const g = tabla.get(codigo);
  return g ? `${g} (${codigo})` : String(codigo);
}

/**
 * Filas "etiqueta / valor" de la sección "Datos de la exportación" (110-112): los códigos de Aduana se imprimen
 * traducidos a su glosa (campos "P" del formato: país, puerto, vía, moneda).
 */
export function filasExportacion(d: DatosImpresion): [string, string][] {
  const e = d.exportacion;
  if (!e) return [];
  const a = e.aduana;
  const unidad = (c: number | undefined) => (c === undefined ? '' : ` ${GLOSA_UNIDAD.get(c) ?? `(cód. ${c})`}`);
  const bultos = a.bultos
    .map((b) => `${b.cantidad ?? ''} ${b.codigoTipo !== undefined ? (GLOSA_TIPO_BULTO.get(b.codigoTipo) ?? `cód. ${b.codigoTipo}`) : ''}${b.marcas ? ` [${b.marcas}]` : ''}${b.idContenedor ? ` cont. ${b.idContenedor}` : ''}${b.sello ? ` sello ${b.sello}` : ''}`.trim())
    .join('; ');
  const servicios: Record<number, string> = {
    3: 'Servicios calificados por Aduana',
    4: 'Servicios de hotelería',
    5: 'Servicio de transporte terrestre internacional',
    6: 'Servicios prestados y utilizados en el extranjero',
  };
  const filas: [string, string | undefined][] = [
    ['Moneda:', e.moneda],
    ['Tipo de cambio:', e.pesos?.tipoCambio !== undefined ? `${formatearMontoMoneda(e.pesos.tipoCambio)} pesos por unidad` : undefined],
    ['Tipo de operación:', e.indServicio !== undefined ? servicios[e.indServicio] : undefined],
    ['Forma de pago:', conGlosa(e.formaPagoExportacion, GLOSA_FORMA_PAGO)],
    ['Fecha cancelación:', e.fechaCancelacion ? fechaCorta(e.fechaCancelacion) : undefined],
    ['Modalidad de venta:', conGlosa(a.codigoModalidadVenta, GLOSA_MODALIDAD)],
    ['Cláusula de venta:', conGlosa(a.codigoClausulaVenta, GLOSA_CLAUSULA)],
    ['Total cláusula:', a.totalClausulaVenta !== undefined ? `${formatearMontoMoneda(a.totalClausulaVenta)} ${e.moneda}` : undefined],
    ['Vía de transporte:', conGlosa(a.codigoViaTransporte, GLOSA_VIA)],
    ['Medio de transporte:', a.nombreTransporte],
    ['Cía. transportista:', [a.nombreCompaniaTransporte, a.rutCompaniaTransporte].filter(Boolean).join(' - ') || undefined],
    ['Booking:', a.booking],
    ['Operador:', a.operador],
    ['Puerto de embarque:', conGlosa(a.codigoPuertoEmbarque, GLOSA_PUERTO)],
    ['Puerto de desembarque:', conGlosa(a.codigoPuertoDesembarque, GLOSA_PUERTO)],
    ['País receptor:', conGlosa(a.codigoPaisReceptor ?? e.extranjero.nacionalidad, GLOSA_PAIS)],
    ['País de destino:', conGlosa(a.codigoPaisDestino, GLOSA_PAIS)],
    ['Id. receptor extranjero:', e.extranjero.numId],
    ['Total bultos:', a.totalBultos !== undefined ? String(a.totalBultos) : undefined],
    ['Tipo de bultos:', bultos || undefined],
    ['Tara:', a.tara !== undefined ? `${formatearMontoMoneda(a.tara, 0)}${unidad(a.codigoUnidadTara)}` : undefined],
    ['Peso bruto:', a.pesoBruto !== undefined ? `${formatearMontoMoneda(a.pesoBruto, 2)}${unidad(a.codigoUnidadPesoBruto)}` : undefined],
    ['Peso neto:', a.pesoNeto !== undefined ? `${formatearMontoMoneda(a.pesoNeto, 2)}${unidad(a.codigoUnidadPesoNeto)}` : undefined],
    ['Flete:', a.montoFlete !== undefined ? `${formatearMontoMoneda(a.montoFlete)} ${e.moneda}` : undefined],
    ['Seguro:', a.montoSeguro !== undefined ? `${formatearMontoMoneda(a.montoSeguro)} ${e.moneda}` : undefined],
  ];
  return filas.filter((f): f is [string, string] => f[1] !== undefined && f[1] !== '');
}

const CODIGOS_REF: Record<number, string> = { 1: 'Anula documento', 2: 'Corrige texto', 3: 'Corrige montos' };

function lineaComuna(p: { comuna?: string; ciudad?: string }): string {
  return [p.comuna, p.ciudad && p.ciudad !== p.comuna ? p.ciudad : undefined].filter(Boolean).join(', ');
}

function anioResolucion(fecha: string): string {
  return /^(\d{4})/.exec(fecha)?.[1] ?? fecha;
}

// ---------- PDFKit ----------

type Doc = InstanceType<typeof PDFDocument>;

function crearDoc(size: [number, number], margen: number, titulo: string): { doc: Doc; terminar: () => Promise<Buffer> } {
  const doc = new PDFDocument({
    size,
    margin: margen,
    info: { Title: titulo, Creator: 'API SII - representación impresa', Producer: 'pdfkit' },
  });
  doc.page.margins.bottom = 0; // paginación manual: evita saltos automáticos de página al dibujar cerca del borde
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });
  return {
    doc,
    terminar: () => {
      doc.end();
      return terminado;
    },
  };
}

interface Timbre {
  png: Buffer;
  ancho: number;
  alto: number;
}

function tamanoTimbre(png: Buffer): Timbre {
  const { ancho, alto } = dimensionesPng(png);
  const factor = XDIM_PT / PX_POR_MODULO;
  return { png, ancho: ancho * factor, alto: alto * factor };
}

function leyendasTimbre(doc: Doc, x: number, y: number, ancho: number, d: DatosImpresion, o: OpcionesPdf, tam = 7.5): number {
  let yy = y;
  doc.fillColor('black').font('Helvetica-Bold').fontSize(tam).text('Timbre Electrónico SII', x, yy, { width: ancho, align: 'center', lineBreak: false });
  yy += tam + 2;
  doc.font('Helvetica').fontSize(tam).text(`Res. ${o.resolucion.numero} de ${anioResolucion(o.resolucion.fecha)}`, x, yy, { width: ancho, align: 'center', lineBreak: false });
  yy += tam + 2;
  doc.text('Verifique documento: www.sii.cl', x, yy, { width: ancho, align: 'center', lineBreak: false });
  yy += tam + 2;
  if (o.urlVerificacion) {
    doc.text(o.urlVerificacion, x, yy, { width: ancho, align: 'center', lineBreak: false });
    yy += tam + 2;
  }
  void d;
  return yy;
}

/** Nombre de la copia cedible a imprimir en la esquina inferior derecha. */
function leyendaCedible(tipo: TipoImpresion): string {
  return tipo === 52 ? 'CEDIBLE CON SU FACTURA' : 'CEDIBLE';
}

interface FilaTotal {
  etiqueta: string;
  /** Valor ya formateado. */
  texto: string;
  fuerte?: boolean;
}

function lineasTotalesExportacion(d: DatosImpresion): FilaTotal[] {
  const e = d.exportacion as NonNullable<DatosImpresion['exportacion']>;
  const filas: FilaTotal[] = [];
  for (const dr of d.descuentosRecargos) {
    const detalle = dr.tipoValor === '%' ? ` ${dr.valor}%` : '';
    filas.push({ etiqueta: `${dr.tipo === 'D' ? 'Descuento' : 'Recargo'}${detalle}`, texto: formatearMontoMoneda(dr.tipo === 'D' ? -dr.monto : dr.monto) });
  }
  filas.push({ etiqueta: 'Monto Exento', texto: formatearMontoMoneda(e.montoExento) });
  filas.push({ etiqueta: `Total ${e.moneda}`, texto: formatearMontoMoneda(e.montoTotal), fuerte: true });
  if (e.pesos) {
    if (e.pesos.tipoCambio !== undefined) filas.push({ etiqueta: 'Tipo de cambio', texto: formatearMontoMoneda(e.pesos.tipoCambio) });
    filas.push({ etiqueta: `Equiv. ${e.pesos.moneda}`, texto: `$ ${formatearMonto(e.pesos.montoTotal)}`, fuerte: true });
  }
  return filas;
}

function lineasTotales(d: DatosImpresion): FilaTotal[] {
  if (d.exportacion) return lineasTotalesExportacion(d);
  const t = d.totales;
  const filas: { etiqueta: string; valor: number; fuerte?: boolean }[] = [];
  for (const dr of d.descuentosRecargos) {
    const base = dr.tipo === 'D' ? 'Descuento' : 'Recargo';
    const detalle = dr.tipoValor === '%' ? ` ${dr.valor}%` : '';
    filas.push({ etiqueta: `${base}${detalle}${dr.exento ? ' (exento)' : ''}`, valor: dr.tipo === 'D' ? -dr.monto : dr.monto });
  }
  if (t.neto !== undefined && t.neto > 0) filas.push({ etiqueta: 'Monto Neto', valor: t.neto });
  if (t.exento !== undefined && t.exento > 0) filas.push({ etiqueta: 'Monto Exento', valor: t.exento });
  if (t.iva !== undefined && t.neto !== undefined && t.neto > 0) filas.push({ etiqueta: `IVA (${t.tasaIva ?? 19}%)`, valor: t.iva });
  for (const i of t.impuestosAdicionales) filas.push({ etiqueta: `Imp. adicional cód. ${i.codigo}${i.tasa ? ` (${i.tasa}%)` : ''}`, valor: i.monto });
  filas.push({ etiqueta: 'Monto Total', valor: t.total, fuerte: true });
  return filas.map((f) => ({ etiqueta: f.etiqueta, texto: `$ ${formatearMonto(f.valor)}`, fuerte: f.fuerte }));
}

// ---------- Carta ----------

const CARTA: [number, number] = [612, 792];
const M = 36;

function renderCarta(doc: Doc, d: DatosImpresion, o: OpcionesPdf, timbre: Timbre, cedible: boolean): void {
  const ancho = CARTA[0] - 2 * M;
  const bajo = CARTA[1] - M;
  const zonaInferior = 170;
  const yZonaInferior = bajo - zonaInferior;

  // --- cabecera: emisor a la izquierda, recuadro a la derecha ---
  const xCaja = M + 354;
  const wCaja = ancho - 354;
  let yIzq = M;
  if (o.logo) {
    doc.image(o.logo, M, yIzq, { fit: [110, 55] });
    yIzq += 60;
  }
  const wIzq = 340;
  doc.fillColor('black').font('Helvetica-Bold').fontSize(12).text(d.emisor.razonSocial, M, yIzq, { width: wIzq });
  yIzq = doc.y + 2;
  doc.font('Helvetica').fontSize(9);
  const lineasEmisor = [
    d.emisor.giro ? `Giro: ${d.emisor.giro}` : undefined,
    d.emisor.direccion ? `${d.emisor.direccion}${lineaComuna(d.emisor) ? ', ' + lineaComuna(d.emisor) : ''}` : lineaComuna(d.emisor),
    d.emisor.telefono ? `Fono: ${d.emisor.telefono}` : undefined,
    d.emisor.correo,
  ].filter((x): x is string => !!x);
  for (const l of lineasEmisor) {
    doc.text(l, M, yIzq, { width: wIzq });
    yIzq = doc.y + 1;
  }

  const rutTxt = `R.U.T.: ${d.emisor.rut}`;
  const folioTxt = `N° ${d.folio}`;
  doc.font('Helvetica-Bold').fontSize(11);
  const hNombre = doc.heightOfString(d.nombreDocumento, { width: wCaja - 12, align: 'center' });
  const hCaja = 10 + 14 + 8 + hNombre + 8 + 15 + 10;
  doc.lineWidth(2).strokeColor(ROJO).rect(xCaja, M, wCaja, hCaja).stroke();
  doc.fillColor(ROJO).fontSize(11);
  let yc = M + 10;
  doc.text(rutTxt, xCaja + 6, yc, { width: wCaja - 12, align: 'center' });
  yc += 14 + 8;
  doc.text(d.nombreDocumento, xCaja + 6, yc, { width: wCaja - 12, align: 'center' });
  yc += hNombre + 8;
  doc.fontSize(12).text(folioTxt, xCaja + 6, yc, { width: wCaja - 12, align: 'center' });
  let yDer = M + hCaja + 5;
  if (o.unidadSii) {
    doc.fillColor('black').font('Helvetica-Bold').fontSize(10).text(`S.I.I. - ${o.unidadSii}`, xCaja, yDer, { width: wCaja, align: 'center' });
    yDer = doc.y;
  }

  let y = Math.max(yIzq, yDer) + 12;

  // --- receptor ---
  const exp = d.exportacion;
  const filasRec: [string, string][] = [
    ['Señor(es):', d.receptor.razonSocial],
    ['R.U.T.:', d.receptor.rut],
    ['Giro:', d.receptor.giro ?? ''],
    ['Dirección:', d.receptor.direccion ?? ''],
    exp
      ? ['País:', conGlosa(exp.aduana.codigoPaisReceptor ?? exp.extranjero.nacionalidad, GLOSA_PAIS) ?? '']
      : ['Comuna:', lineaComuna(d.receptor)],
  ];
  const filasDer: [string, string][] = [['Fecha Emisión:', fechaLarga(d.fechaEmision)]];
  if (d.fechaVencimiento) filasDer.push(['Vencimiento:', fechaLarga(d.fechaVencimiento)]);
  if (d.formaPago !== undefined && FORMAS_PAGO[d.formaPago]) filasDer.push(['Forma de pago:', FORMAS_PAGO[d.formaPago]!]);
  if (exp) filasDer.push(['Moneda:', exp.moneda]);
  if (d.tipo === 52 && d.indTraslado !== undefined && TRASLADOS[d.indTraslado]) filasDer.push(['Tipo traslado:', TRASLADOS[d.indTraslado]!]);

  const wColIzq = 300;
  const wColDer = ancho - wColIzq - 12;
  const medir = (filas: [string, string][], w: number, wLab: number): number => {
    let h = 0;
    for (const [, v] of filas) {
      doc.font('Helvetica').fontSize(9);
      h += Math.max(11, doc.heightOfString(v, { width: w - wLab })) + 2;
    }
    return h;
  };
  const hRec = Math.max(medir(filasRec, wColIzq, 62), medir(filasDer, wColDer, 82)) + 10;
  doc.lineWidth(0.6).strokeColor(GRIS).rect(M, y, ancho, hRec).stroke();
  const pintar = (filas: [string, string][], x: number, w: number, wLab: number): void => {
    let yy = y + 5;
    for (const [k, v] of filas) {
      doc.fillColor('black').font('Helvetica-Bold').fontSize(9).text(k, x, yy, { width: wLab, lineBreak: false });
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(11, doc.heightOfString(v, { width: w - wLab }));
      doc.text(v, x + wLab, yy, { width: w - wLab });
      yy += h + 2;
    }
  };
  pintar(filasRec, M + 6, wColIzq, 62);
  pintar(filasDer, M + wColIzq + 6, wColDer, 82);
  y += hRec + 10;

  // --- datos del traslado (Res. Ex. SII 144/2026) ---
  const filasTr = exp ? filasExportacion(d) : filasTraslado(d);
  if (filasTr.length > 0) {
    const mitad = Math.ceil(filasTr.length / 2);
    const colA = filasTr.slice(0, mitad);
    const colB = filasTr.slice(mitad);
    const wCol = (ancho - 12) / 2;
    const wLabTr = exp ? 112 : 92;
    const hTr = Math.max(medir(colA, wCol, wLabTr), medir(colB, wCol, wLabTr)) + 22;
    doc.lineWidth(0.6).strokeColor(GRIS).rect(M, y, ancho, hTr).stroke();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9).text(exp ? 'Datos de la exportación' : 'Datos del traslado', M + 6, y + 4, { width: ancho - 12, lineBreak: false });
    const y0 = y;
    y += 14;
    pintar(colA, M + 6, wCol, wLabTr);
    pintar(colB, M + 6 + wCol, wCol, wLabTr);
    y = y0 + hTr + 10;
  }

  // --- detalle ---
  const cols = [
    { t: 'Ítem', w: 24, a: 'center' as const },
    { t: 'Código', w: 58, a: 'left' as const },
    { t: 'Descripción', w: 212, a: 'left' as const },
    { t: 'Cantidad', w: 44, a: 'right' as const },
    { t: 'Unid.', w: 34, a: 'center' as const },
    { t: 'P. Unit.', w: 56, a: 'right' as const },
    { t: 'Dscto.', w: 50, a: 'right' as const },
    { t: 'Valor', w: 60, a: 'right' as const },
  ];
  const pie = (): number => bajo - 4;
  const encabezadoTabla = (yy: number): number => {
    doc.fillColor('#E8E8E8').rect(M, yy, ancho, 16).fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5);
    let x = M;
    for (const c of cols) {
      doc.text(c.t, x + 2, yy + 4, { width: c.w - 4, align: c.a, lineBreak: false });
      x += c.w;
    }
    return yy + 18;
  };
  y = encabezadoTabla(y);
  for (const l of d.detalle) {
    const desc = l.descripcion ? `${l.nombre}\n${l.descripcion}` : l.nombre;
    doc.font('Helvetica').fontSize(8.5);
    const h = Math.max(12, doc.heightOfString(desc, { width: cols[2]!.w - 4 })) + 3;
    if (y + h > pie()) {
      doc.addPage();
      doc.page.margins.bottom = 0;
      y = encabezadoTabla(M);
    }
    const valores = exp
      ? [
          String(l.numero),
          l.codigo ?? '',
          desc,
          formatearMontoMoneda(l.cantidad, 6),
          l.unidad ?? '',
          formatearMontoMoneda(l.precioUnitario, 6),
          l.descuentoMonto ? formatearMontoMoneda(l.descuentoMonto) : '',
          formatearMontoMoneda(l.monto),
        ]
      : [
          String(l.numero),
          l.codigo ?? '',
          desc,
          formatearCantidad(l.cantidad),
          l.unidad ?? '',
          formatearPrecio(l.precioUnitario),
          l.descuentoMonto ? formatearMonto(l.descuentoMonto) : '',
          formatearMonto(l.monto) + (l.exento && d.tipo !== 34 && d.tipo !== 41 ? ' E' : ''),
        ];
    let x = M;
    doc.fillColor('black');
    cols.forEach((c, i) => {
      doc.text(valores[i]!, x + 2, y + 1, { width: c.w - 4, align: c.a, lineBreak: i === 2 });
      x += c.w;
    });
    y += h;
  }
  doc.lineWidth(0.5).strokeColor(GRIS).moveTo(M, y).lineTo(M + ancho, y).stroke();
  y += 8;
  if (!exp && d.detalle.some((l) => l.exento) && d.tipo !== 34 && d.tipo !== 41) {
    doc.font('Helvetica').fontSize(7).fillColor('black').text('E = ítem exento o no afecto a IVA', M, y, { width: ancho });
    y = doc.y + 6;
  }

  // --- referencias ---
  if (d.referencias.length > 0) {
    const colsRef = [
      { t: 'Tipo Documento', w: 170 },
      { t: 'Folio', w: 60 },
      { t: 'Fecha', w: 70 },
      { t: 'Razón Referencia', w: 240 },
    ];
    const alturaRefs = 18 + d.referencias.length * 13 + 6;
    if (y + alturaRefs > pie()) {
      doc.addPage();
      doc.page.margins.bottom = 0;
      y = M;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('black').text('Referencias a otros documentos', M, y, { width: ancho, align: 'center' });
    y += 13;
    doc.fillColor('#E8E8E8').rect(M, y, ancho, 14).fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5);
    let x = M;
    for (const c of colsRef) {
      doc.text(c.t, x + 2, y + 3, { width: c.w - 4, lineBreak: false });
      x += c.w;
    }
    y += 16;
    doc.font('Helvetica').fontSize(8.5);
    for (const r of d.referencias) {
      const razon = [r.codigo ? CODIGOS_REF[r.codigo] : undefined, r.razon].filter(Boolean).join(': ');
      const vals = [r.nombreTipoDocumento, r.folio, r.fecha ? fechaCorta(r.fecha) : '', razon];
      const h = Math.max(12, doc.heightOfString(razon, { width: colsRef[3]!.w - 4 })) + 1;
      x = M;
      colsRef.forEach((c, i) => {
        doc.text(vals[i]!, x + 2, y, { width: c.w - 4, lineBreak: i === 3 || i === 0 });
        x += c.w;
      });
      y += h;
    }
    y += 6;
  }

  // --- totales (derecha, sobre la zona inferior) ---
  const filas = lineasTotales(d);
  const hTot = filas.length * 15 + 8;
  if (y + hTot > yZonaInferior) {
    if (!cedible && hTot < zonaInferior - 12) {
      // Sin acuse de recibo la zona inferior derecha está libre: los totales caben junto al timbre.
      y = yZonaInferior + 6;
    } else {
      doc.addPage();
      doc.page.margins.bottom = 0;
      y = M;
    }
  }
  const xTot = M + ancho - 210;
  doc.lineWidth(0.6).strokeColor(GRIS).rect(xTot, y, 210, hTot).stroke();
  let yt = y + 5;
  for (const f of filas) {
    doc.fillColor('black').font(f.fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(f.fuerte ? 10 : 9);
    doc.text(f.etiqueta, xTot + 8, yt, { width: 110, lineBreak: false });
    doc.text(f.texto, xTot + 110, yt, { width: 92, align: 'right', lineBreak: false });
    yt += 15;
  }

  // --- zona inferior de la última página: timbre (>= 2 cm del borde izquierdo) y acuse de recibo ---
  const xTimbre = Math.max(2 * PT_POR_CM + 4, M + 18);
  const quiet = 18; // 0,25"
  const yImg = yZonaInferior + quiet;
  doc.image(timbre.png, xTimbre, yImg, { width: timbre.ancho, height: timbre.alto });
  leyendasTimbre(doc, xTimbre, yImg + timbre.alto + 5, timbre.ancho, d, o);

  if (cedible) {
    const xA = M + 300;
    const wA = ancho - 300;
    const yA = yZonaInferior + 6;
    doc.lineWidth(0.6).strokeColor('black').rect(xA, yA, wA, 120).stroke();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8).text('Acuse de Recibo', xA + 6, yA + 5, { width: wA - 12, lineBreak: false });
    doc.font('Helvetica').fontSize(8);
    const linea = (txt: string, x: number, yy: number, w: number): void => {
      doc.text(txt, x, yy, { width: w, lineBreak: false });
    };
    linea('Nombre: ____________________________________', xA + 6, yA + 20, wA - 12);
    linea('R.U.T.: ______________   Fecha: _____________', xA + 6, yA + 34, wA - 12);
    linea('Recinto: ______________   Firma: _____________', xA + 6, yA + 48, wA - 12);
    doc.fontSize(6.5).text(TEXTO_ACUSE_RECIBO, xA + 6, yA + 66, { width: wA - 12, align: 'justify' });
    doc.font('Helvetica-Bold').fontSize(10).text(leyendaCedible(d.tipo), xA, yA + 124, { width: wA, align: 'right', lineBreak: false });
  }
}

// ---------- Térmica 80 mm ----------

const ANCHO_TERMICA = 226.77; // 80 mm
const M_TERMICA = 14.17; // 0,5 cm

/** Dibuja el recibo y devuelve la coordenada Y final (para fijar el alto de la página). */
function renderTermica(doc: Doc, d: DatosImpresion, o: OpcionesPdf, timbre: Timbre): number {
  const x = M_TERMICA;
  const w = ANCHO_TERMICA - 2 * M_TERMICA;
  let y = M_TERMICA;
  const centro = (txt: string, fuente: string, tam: number, color = 'black'): void => {
    doc.fillColor(color).font(fuente).fontSize(tam).text(txt, x, y, { width: w, align: 'center' });
    y = doc.y;
  };

  if (o.logo) {
    doc.image(o.logo, x + (w - 100) / 2, y, { fit: [100, 45], align: 'center' });
    y += 50;
  }
  // recuadro tipo/folio
  doc.font('Helvetica-Bold').fontSize(10);
  const hNombre = doc.heightOfString(d.nombreDocumento, { width: w - 10, align: 'center' });
  const hCaja = 8 + 13 + 5 + hNombre + 5 + 14 + 8;
  doc.lineWidth(1.5).strokeColor(ROJO).rect(x, y, w, hCaja).stroke();
  let yc = y + 8;
  doc.fillColor(ROJO).fontSize(10).text(`R.U.T.: ${d.emisor.rut}`, x + 5, yc, { width: w - 10, align: 'center' });
  yc += 13 + 5;
  doc.text(d.nombreDocumento, x + 5, yc, { width: w - 10, align: 'center' });
  yc += hNombre + 5;
  doc.fontSize(11).text(`N° ${d.folio}`, x + 5, yc, { width: w - 10, align: 'center' });
  y += hCaja + 4;
  if (o.unidadSii) centro(`S.I.I. - ${o.unidadSii}`, 'Helvetica-Bold', 8.5);
  y += 6;

  centro(d.emisor.razonSocial, 'Helvetica-Bold', 9);
  if (d.emisor.giro) centro(d.emisor.giro, 'Helvetica', 7.5);
  const dir = [d.emisor.direccion, lineaComuna(d.emisor)].filter(Boolean).join(', ');
  if (dir) centro(dir, 'Helvetica', 7.5);
  if (d.emisor.telefono) centro(`Fono: ${d.emisor.telefono}`, 'Helvetica', 7.5);
  y += 4;
  const sep = (): void => {
    doc.lineWidth(0.5).strokeColor(GRIS).dash(1.5, { space: 1.5 }).moveTo(x, y).lineTo(x + w, y).stroke().undash();
    y += 4;
  };
  sep();

  const izq = (txt: string, negrita = false, tam = 8): void => {
    doc.fillColor('black').font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).text(txt, x, y, { width: w });
    y = doc.y;
  };
  izq(`Fecha emisión: ${fechaCorta(d.fechaEmision)}`);
  const filasTr = filasTraslado(d);
  if (filasTr.length > 0) {
    izq('Datos del traslado', true, 8);
    for (const [k, v] of filasTr) izq(`${k} ${v}`, false, 7.5);
  }
  const rutGenerico = ['66.666.666-6', '0', '0-0', ''].includes(d.receptor.rut);
  if (!rutGenerico) {
    izq(`Cliente: ${d.receptor.razonSocial}`);
    izq(`R.U.T.: ${d.receptor.rut}`);
    if (d.receptor.direccion) izq(`Dirección: ${d.receptor.direccion}`);
  }
  for (const r of d.referencias) {
    izq(`Ref.: ${r.nombreTipoDocumento} N° ${r.folio}${r.fecha ? ' del ' + fechaCorta(r.fecha) : ''}${r.razon ? ' - ' + r.razon : ''}`, false, 7.5);
  }
  y += 2;
  sep();

  // detalle
  doc.fillColor('black').font('Helvetica-Bold').fontSize(7.5).text('Descripción', x, y, { width: w - 70, lineBreak: false });
  doc.text('Valor', x + w - 70, y, { width: 70, align: 'right', lineBreak: false });
  y += 11;
  for (const l of d.detalle) {
    doc.font('Helvetica').fontSize(8).fillColor('black').text(l.nombre, x, y, { width: w - 60 });
    const yTxt = doc.y;
    doc.text(formatearMonto(l.monto) + (l.exento && d.tipo !== 41 ? ' E' : ''), x + w - 60, y, { width: 60, align: 'right', lineBreak: false });
    y = yTxt;
    const det = `${formatearCantidad(l.cantidad)}${l.unidad ? ' ' + l.unidad : ''} x $${formatearPrecio(l.precioUnitario)}${l.descuentoMonto ? `  Dscto. $${formatearMonto(l.descuentoMonto)}` : ''}`;
    doc.fontSize(7).fillColor('#444444').text(det, x + 6, y, { width: w - 6 });
    y = doc.y + 2;
  }
  sep();
  for (const f of lineasTotales(d)) {
    doc.fillColor('black').font(f.fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(f.fuerte ? 10 : 8.5);
    doc.text(f.etiqueta, x, y, { width: 100, lineBreak: false });
    doc.text(f.texto, x + 90, y, { width: w - 90, align: 'right', lineBreak: false });
    y += f.fuerte ? 14 : 12;
  }
  y += 6;

  // timbre centrado: ancho natural (>= 6,7 mils); la zona de silencio cae sobre los márgenes de la hoja
  const xImg = (ANCHO_TERMICA - timbre.ancho) / 2;
  doc.image(timbre.png, xImg, y, { width: timbre.ancho, height: timbre.alto });
  y += timbre.alto + 5;
  y = leyendasTimbre(doc, 0, y, ANCHO_TERMICA, d, o, 7);
  return y + M_TERMICA;
}

// ---------- API ----------

/**
 * Genera la representación impresa (PDF) de un DTE firmado: `carta` con recuadro, receptor, detalle, referencias,
 * totales, timbre PDF417 y acuse de recibo/cedible; o `termica80` (boletas) con los datos exigidos y la leyenda de
 * verificación. Devuelve los bytes del PDF.
 */
export async function generarPdf(xmlDte: string | Buffer, opciones: OpcionesPdf): Promise<Buffer> {
  const d = extraerDatosImpresion(xmlDte);
  // Los documentos de exportación solo tienen formato carta (zona de datos de Aduana y de moneda).
  const formato = d.exportacion ? 'carta' : (opciones.formato ?? (d.tipo === 39 || d.tipo === 41 ? 'termica80' : 'carta'));
  const timbre = tamanoTimbre(await generarPdf417(d.tedXml));
  const titulo = `${d.nombreDocumento} N° ${d.folio}`;

  if (formato === 'termica80') {
    const medida = crearDoc([ANCHO_TERMICA, 20000], M_TERMICA, titulo);
    const alto = renderTermica(medida.doc, d, opciones, timbre);
    await medida.terminar();
    const final = crearDoc([ANCHO_TERMICA, Math.ceil(alto)], M_TERMICA, titulo);
    renderTermica(final.doc, d, opciones, timbre);
    return final.terminar();
  }

  const cedible = !!opciones.cedible && admiteCedible(d.tipo, d.indTraslado);
  const { doc, terminar } = crearDoc(CARTA, M, titulo);
  renderCarta(doc, d, opciones, timbre, cedible);
  return terminar();
}
