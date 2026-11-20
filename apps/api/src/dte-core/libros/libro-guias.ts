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
  validarCaratulaComun,
} from './comun.js';

export interface CaratulaLibroGuias {
  rutEmisorLibro: string;
  rutEnvia: string;
  /** `AAAA-MM`. */
  periodoTributario: string;
  fechaResolucion: string;
  numeroResolucion: number;
  /** El XSD solo admite ESPECIAL. */
  tipoLibro: 'ESPECIAL';
  tipoEnvio: TipoEnvioLibro;
  nroSegmento?: number;
  /** Obligatorio: folio de la notificación del SII que pide el libro. */
  folioNotificacion: number;
}

/**
 * Tipo de operación de la guía (`TpoOper`): 1 constituye venta, 2 ventas por efectuar,
 * 3 consignaciones, 4 productos en demostración, 5 traslados internos, 6 otros traslados no venta,
 * 7 guía de devolución.
 */
export type TipoOperacionGuia = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface DetalleLibroGuias {
  folio: number;
  /**
   * 1 folio anulado antes de enviarse al SII (no requiere más datos), 2 anulada después de enviada,
   * 3 recibida parcialmente (informar `montoModificado`).
   */
  anulado?: 1 | 2 | 3;
  /** Solo en envíos AJUSTE: 1 agrega (por defecto), 2 elimina. */
  operacion?: 1 | 2;
  tipoOperacion?: TipoOperacionGuia;
  fechaDoc?: string;
  rutReceptor?: string;
  razonSocial?: string;
  montoNeto?: number;
  /** Tasa del IVA en %. */
  tasaIva?: number;
  iva?: number;
  montoTotal?: number;
  montoModificado?: number;
  /** Factura emitida por la guía de venta (tipo, folio, fecha). */
  tipoDocRef?: number;
  folioDocRef?: number;
  fechaDocRef?: string;
}

export interface OpcionesLibroGuias {
  caratula: CaratulaLibroGuias;
  detalle: DetalleLibroGuias[];
  /** Envío AJUSTE: todas las guías del período después del ajuste (para el ResumenPeriodo). */
  guiasPeriodo?: DetalleLibroGuias[];
  certificado: CertificadoFirma;
  fechaFirma?: Date;
  idEnvio?: string;
}

export interface TotalesGuias {
  /** Folios anulados antes del envío (`Anulado=1`). */
  foliosAnulados: number;
  /** Guías anuladas después del envío (`Anulado=2`). */
  guiasAnuladas: number;
  guiasVenta: number;
  montoGuiasVenta: number;
  montoModificado: number;
  /** Guías que no son venta, por tipo de operación (2 a 7). */
  traslados: Array<{ tipoOperacion: number; cantidad: number; monto: number }>;
}

export interface LibroGuiasConstruido {
  xml: string;
  xmlIso: Buffer;
  idEnvio: string;
  resumenPeriodo: TotalesGuias | null;
  resumenSegmento: TotalesGuias | null;
  cantidadDetalle: number;
  advertencias: string[];
}

interface FilaGuia {
  d: DetalleLibroGuias;
  signo: 1 | -1;
  neto: number;
  iva: number;
  total: number;
  modificado: number;
}

function validarGuia(d: DetalleLibroGuias, i: number, advertencias: string[]): FilaGuia {
  const ctx = `Guía ${i + 1} (folio ${d.folio})`;
  if (!Number.isInteger(d.folio) || d.folio <= 0 || d.folio > 9_999_999_999) {
    throw new ErrorValidacionDte(`${ctx}: folio inválido`);
  }
  if (d.anulado !== undefined && ![1, 2, 3].includes(d.anulado)) throw new ErrorValidacionDte(`${ctx}: anulado inválido`);
  if (d.tipoOperacion !== undefined && ![1, 2, 3, 4, 5, 6, 7].includes(d.tipoOperacion)) {
    throw new ErrorValidacionDte(`${ctx}: tipoOperacion inválido (1 a 7)`);
  }
  const signo: 1 | -1 = d.operacion === 2 ? -1 : 1;
  const n = (v: number | undefined, campo: string) => (v === undefined ? 0 : enteroNoNegativo(v, `${ctx}: ${campo}`));
  if (d.anulado === 1) return { d, signo, neto: 0, iva: 0, total: 0, modificado: 0 };

  if (d.fechaDoc !== undefined) fechaLibro(d.fechaDoc, `${ctx}: fechaDoc`);
  if (d.rutReceptor !== undefined) rutLibro(d.rutReceptor, `${ctx}: rutReceptor`);
  if (d.fechaDocRef !== undefined) fechaLibro(d.fechaDocRef, `${ctx}: fechaDocRef`);
  if (d.tasaIva !== undefined && (typeof d.tasaIva !== 'number' || d.tasaIva < 0 || d.tasaIva > 100)) {
    throw new ErrorValidacionDte(`${ctx}: tasaIva inválida`);
  }
  if (d.tipoOperacion === 1) {
    if (!d.rutReceptor) throw new ErrorValidacionDte(`${ctx}: la guía de venta requiere el RUT del receptor`);
    if (d.tipoDocRef === undefined || d.folioDocRef === undefined) {
      advertencias.push(`${ctx}: la guía de venta debería informar la factura asociada (tipo, folio y fecha)`);
    }
  }
  if (d.anulado === 3 && d.montoModificado === undefined) {
    throw new ErrorValidacionDte(`${ctx}: las guías recibidas parcialmente requieren montoModificado`);
  }
  if (d.anulado === undefined && d.tipoOperacion === undefined) {
    throw new ErrorValidacionDte(`${ctx}: falta tipoOperacion`);
  }
  const neto = n(d.montoNeto, 'montoNeto');
  const iva = n(d.iva, 'iva');
  const total = n(d.montoTotal, 'montoTotal');
  if (d.montoNeto !== undefined && d.montoTotal !== undefined && d.iva !== undefined && neto + iva > total) {
    throw new ErrorValidacionDte(`${ctx}: el monto total no puede ser menor que neto + IVA`);
  }
  return { d, signo, neto, iva, total, modificado: n(d.montoModificado, 'montoModificado') };
}

function totalizar(filas: FilaGuia[]): TotalesGuias {
  const t: TotalesGuias = {
    foliosAnulados: 0,
    guiasAnuladas: 0,
    guiasVenta: 0,
    montoGuiasVenta: 0,
    montoModificado: 0,
    traslados: [],
  };
  const trasl = new Map<number, { cantidad: number; monto: number }>();
  for (const f of filas) {
    const s = f.signo;
    if (f.d.anulado === 1) {
      t.foliosAnulados += s;
      continue;
    }
    if (f.d.anulado === 2) {
      t.guiasAnuladas += s;
      continue;
    }
    t.montoModificado += s * f.modificado;
    if (f.d.tipoOperacion === 1) {
      t.guiasVenta += s;
      t.montoGuiasVenta += s * f.total;
    } else if (f.d.tipoOperacion !== undefined) {
      const prev = trasl.get(f.d.tipoOperacion) ?? { cantidad: 0, monto: 0 };
      trasl.set(f.d.tipoOperacion, { cantidad: prev.cantidad + s, monto: prev.monto + s * f.total });
    }
  }
  t.traslados = [...trasl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tipoOperacion, v]) => ({ tipoOperacion, cantidad: v.cantidad, monto: v.monto }));
  return t;
}

function xmlResumen(t: TotalesGuias, nombre: 'ResumenSegmento' | 'ResumenPeriodo'): string {
  const periodo = nombre === 'ResumenPeriodo';
  const opc = (n: string, v: number) => (v === 0 ? '' : tag(n, enteroSigno(v)));
  const cantidad = (v: number) => enteroSigno(periodo ? Math.max(0, v) : v);
  return (
    `<${nombre}>` +
    opc('TotFolAnulado', t.foliosAnulados) +
    opc('TotGuiaAnulada', t.guiasAnuladas) +
    tag('TotGuiaVenta', cantidad(t.guiasVenta)) +
    tag('TotMntGuiaVta', enteroSigno(t.montoGuiasVenta)) +
    opc('TotMntModificado', t.montoModificado) +
    t.traslados
      .map(
        (x) =>
          '<TotTraslado>' +
          tag('TpoTraslado', x.tipoOperacion) +
          tag('CantGuia', cantidad(x.cantidad)) +
          (x.monto === 0 ? '' : tag('MntGuia', enteroSigno(x.monto))) +
          '</TotTraslado>',
      )
      .join('') +
    `</${nombre}>`
  );
}

function xmlDetalle(f: FilaGuia): string {
  const d = f.d;
  const cab =
    '<Detalle>' +
    tag('Folio', d.folio) +
    tagOpc('Anulado', d.anulado) +
    tagOpc('Operacion', d.operacion);
  if (d.anulado === 1) return `${cab}</Detalle>`;
  const m = (n: string, v: number | undefined, f2: number) => (v === undefined ? '' : tag(n, f2));
  return (
    cab +
    tagOpc('TpoOper', d.tipoOperacion) +
    tagOpc('FchDoc', d.fechaDoc) +
    (d.rutReceptor ? tag('RUTDoc', rutLibro(d.rutReceptor, 'rutReceptor')) : '') +
    (d.razonSocial ? tag('RznSoc', textoLibro(d.razonSocial, 50)) : '') +
    m('MntNeto', d.montoNeto, f.neto) +
    tagOpc('TasaImp', d.tasaIva) +
    m('IVA', d.iva, f.iva) +
    m('MntTotal', d.montoTotal, f.total) +
    m('MntModificado', d.montoModificado, f.modificado) +
    tagOpc('TpoDocRef', d.tipoDocRef) +
    tagOpc('FolioDocRef', d.folioDocRef) +
    tagOpc('FchDocRef', d.fechaDocRef) +
    '</Detalle>'
  );
}

/**
 * Arma, firma y devuelve el Libro de Guías de Despacho (`LibroGuia`). Mismas reglas de envío que el
 * IECV: TOTAL (`ResumenPeriodo` + `Detalle`), PARCIAL (`ResumenSegmento` + `Detalle`), FINAL (solo
 * `ResumenPeriodo`, calculado con `detalle`) y AJUSTE (segmento con signo + período de `guiasPeriodo`).
 *
 * El XSD oficial (`LibroGuia_v10.xsd`) define su propia `Signature` en el namespace SiiDte; el
 * libro se firma con XMLDSig estándar (namespace `xmldsig#`), así que se valida con
 * `LibroGuia_v10_ds.xsd` (ver `resources/sii/xsd/libros/README.md`).
 */
export function construirLibroGuias(opciones: OpcionesLibroGuias): LibroGuiasConstruido {
  const { caratula: c } = opciones;
  validarCaratulaComun({ ...c, folioNotificacion: c.folioNotificacion });
  if (c.tipoLibro !== 'ESPECIAL') throw new ErrorValidacionDte('El libro de guías solo admite TipoLibro ESPECIAL');
  if (c.folioNotificacion === undefined) throw new ErrorValidacionDte('El libro de guías requiere FolioNotificacion');
  const rutEmisor = rutLibro(c.rutEmisorLibro, 'rutEmisorLibro');
  const rutEnvia = rutLibro(c.rutEnvia, 'rutEnvia');
  const periodo = periodoLibro(c.periodoTributario);
  const res = resolucionLibro(c.fechaResolucion, c.numeroResolucion);
  const advertencias: string[] = [];

  const filas = opciones.detalle.map((d, i) => validarGuia(d, i, advertencias));
  const vistos = new Set<string>();
  for (const f of filas) {
    const clave = `${f.d.folio}-${f.d.operacion ?? 1}`;
    if (vistos.has(clave)) throw new ErrorValidacionDte(`Guía repetida en el detalle: folio ${f.d.folio}`);
    vistos.add(clave);
    if (c.tipoEnvio !== 'AJUSTE' && f.d.operacion !== undefined) {
      throw new ErrorValidacionDte('El campo operación solo corresponde a envíos AJUSTE');
    }
  }

  let segmento: TotalesGuias | null = null;
  let totalPeriodo: TotalesGuias | null = null;
  switch (c.tipoEnvio) {
    case 'TOTAL':
    case 'FINAL':
      totalPeriodo = totalizar(filas);
      break;
    case 'PARCIAL':
      if (filas.length === 0) throw new ErrorValidacionDte('El envío PARCIAL debe incluir Detalle');
      segmento = totalizar(filas);
      break;
    case 'AJUSTE': {
      if (!opciones.guiasPeriodo) {
        throw new ErrorValidacionDte('El envío AJUSTE requiere guiasPeriodo: todas las guías del período después del ajuste');
      }
      if (filas.length === 0) throw new ErrorValidacionDte('El envío AJUSTE debe incluir Detalle');
      segmento = totalizar(filas);
      totalPeriodo = totalizar(opciones.guiasPeriodo.map((d, i) => validarGuia(d, i, advertencias)));
      break;
    }
  }
  const conDetalle = c.tipoEnvio !== 'FINAL' && filas.length > 0;

  const idEnvio = opciones.idEnvio ?? `LibroGuias_${periodo.replace('-', '')}_${c.tipoEnvio}${c.nroSegmento ? `_${c.nroSegmento}` : ''}`;
  if (!/^[A-Za-z_][\w.-]*$/.test(idEnvio)) throw new ErrorValidacionDte(`idEnvio inválido: ${idEnvio}`);

  const caratula =
    '<Caratula>' +
    tag('RutEmisorLibro', rutEmisor) +
    tag('RutEnvia', rutEnvia) +
    tag('PeriodoTributario', periodo) +
    tag('FchResol', res.fecha) +
    tag('NroResol', res.numero) +
    tag('TipoLibro', c.tipoLibro) +
    tag('TipoEnvio', c.tipoEnvio) +
    tagOpc('NroSegmento', c.nroSegmento) +
    tag('FolioNotificacion', c.folioNotificacion) +
    '</Caratula>';

  const sinFirma =
    `<LibroGuia xmlns="${NS_SII_LIBRO}" xmlns:xsi="${NS_XSI_LIBRO}" version="1.0">` +
    `<EnvioLibro ID="${idEnvio}">${caratula}` +
    (segmento ? xmlResumen(segmento, 'ResumenSegmento') : '') +
    (totalPeriodo ? xmlResumen(totalPeriodo, 'ResumenPeriodo') : '') +
    (conDetalle ? filas.map(xmlDetalle).join('') : '') +
    tag('TmstFirma', formatearTimestampSii(opciones.fechaFirma ?? new Date())) +
    '</EnvioLibro></LibroGuia>';

  const xml = firmarXml(sinFirma, { ...opciones.certificado, idReferencia: idEnvio });
  return {
    xml,
    xmlIso: aIso88591(xml),
    idEnvio,
    resumenPeriodo: totalPeriodo,
    resumenSegmento: segmento,
    cantidadDetalle: conDetalle ? filas.length : 0,
    advertencias,
  };
}
