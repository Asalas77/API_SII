import type { Caf } from '../caf/caf.js';
import { folioEnRango } from '../caf/caf.js';
import { firmarXml } from '../firma/firma.js';
import { generarTed } from '../ted/ted.js';
import {
  aIso88591,
  escaparXml,
  formatearRut,
  formatearTimestampSii,
  sanearLatin1,
  validarDv,
} from '../xml/xml.util.js';
import { ErrorValidacionDte } from './errores.js';
import { calcularTotales } from './totales.js';
import {
  esBoleta,
  esTipoExento,
  MAX_ACTECOS,
  MAX_DESCUENTOS_RECARGOS,
  MAX_LINEAS_DETALLE_BOLETA,
  MAX_LINEAS_DETALLE_DTE,
  MAX_REFERENCIAS,
  TIPOS_DTE,
  type DocumentoDte,
  type EmisorDte,
  type ReceptorDte,
  type TotalesDte,
} from './tipos.js';

export interface OpcionesConstruirDte {
  caf: Caf;
  certificado: { certificadoPem: string; clavePrivadaPem: string };
  /** Momento de firma/timbraje (`TmstFirma` y `TSTED`). Por defecto, ahora. */
  fechaFirma?: Date;
}

export interface DteConstruido {
  /** `<DTE>` firmado, sin declaración XML (string JS, para inspección e inserción en sobres). */
  xmlFirmado: string;
  /** Mismo XML con declaración ISO-8859-1, codificado en Latin-1 (lo que se envía). */
  xmlIso: Buffer;
  /** `<TED>` generado. */
  ted: string;
  /** Valor del atributo `ID` de `Documento` (`F{folio}T{tipo}`). */
  idDocumento: string;
  totales: TotalesDte;
}

export const NS_SII = 'http://www.sii.cl/SiiDte';
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const RUT_GENERICO = '66666666-6';

// ---------------------------------------------------------------------------------------------
// Helpers de serialización
// ---------------------------------------------------------------------------------------------

/** Trunca por code points y quita espacios en los extremos. */
function truncar(texto: string, max: number): string {
  return Array.from(texto.trim()).slice(0, max).join('');
}

/**
 * Elemento de texto: se sanea a Latin-1 (la firma se calcula sobre lo que se transmite),
 * se trunca a `max` caracteres (si se indica) y se escapa. Omite el elemento si el valor es vacío.
 */
function tag(nombre: string, valor: string | number | undefined | null, max?: number): string {
  if (valor === undefined || valor === null) return '';
  let v = typeof valor === 'number' ? String(valor) : sanearLatin1(valor);
  if (max !== undefined) v = truncar(v, max);
  if (v === '') return '';
  return `<${nombre}>${escaparXml(v)}</${nombre}>`;
}

/** Decimal sin notación científica ni ceros sobrantes (hasta `decimales`). */
export function numeroXml(n: number, decimales = 6): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(decimales).replace(/\.?0+$/, '');
}

function rutDe(rut: string | number, dv: string, ctx: string): string {
  const cuerpo = String(rut).replace(/\D/g, '');
  if (!cuerpo || !/^[\dkK]$/.test(dv)) throw new ErrorValidacionDte(`${ctx}: RUT inválido (${rut}-${dv})`);
  if (!validarDv(cuerpo, dv)) throw new ErrorValidacionDte(`${ctx}: dígito verificador incorrecto (${rut}-${dv})`);
  const r = formatearRut(cuerpo, dv);
  if (r.length > 10) throw new ErrorValidacionDte(`${ctx}: RUT demasiado largo (${r})`);
  return r;
}

function validarFecha(valor: string | undefined, ctx: string): void {
  if (valor === undefined) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) {
    throw new ErrorValidacionDte(`${ctx}: fecha inválida (${valor}), se espera yyyy-mm-dd`);
  }
}

// ---------------------------------------------------------------------------------------------
// Validación de negocio
// ---------------------------------------------------------------------------------------------

function validarDocumento(doc: DocumentoDte, caf: Caf): void {
  const { idDoc, emisor, receptor } = doc;
  const tipo = idDoc.tipoDte;
  if (!TIPOS_DTE.includes(tipo)) throw new ErrorValidacionDte(`Tipo de documento no soportado: ${String(tipo)}`);
  if (!Number.isInteger(idDoc.folio) || idDoc.folio <= 0) {
    throw new ErrorValidacionDte(`Folio inválido: ${idDoc.folio}`);
  }
  validarFecha(idDoc.fechaEmision, 'fechaEmision');
  validarFecha(idDoc.fechaVencimiento, 'fechaVencimiento');
  validarFecha(idDoc.periodoDesde, 'periodoDesde');
  validarFecha(idDoc.periodoHasta, 'periodoHasta');

  // CAF
  if (caf.tipoDte !== tipo) {
    throw new ErrorValidacionDte(`El CAF es de documentos tipo ${caf.tipoDte} y el documento es tipo ${tipo}`);
  }
  if (!folioEnRango(caf, idDoc.folio)) {
    throw new ErrorValidacionDte(
      `El folio ${idDoc.folio} está fuera del rango del CAF (${caf.folioDesde}-${caf.folioHasta})`,
    );
  }
  const rutEmisor = rutDe(emisor.rut, emisor.dv, 'Emisor');
  if (caf.rutEmisor.replace(/\./g, '').toUpperCase() !== rutEmisor) {
    throw new ErrorValidacionDte(`El CAF pertenece a ${caf.rutEmisor} y el emisor es ${rutEmisor}`);
  }

  // Emisor / receptor
  const boleta = esBoleta(tipo);
  if (boleta) {
    if (emisor.actecos && emisor.actecos.length > 0) {
      throw new ErrorValidacionDte('Las boletas (39/41) no admiten Acteco en el emisor');
    }
  } else {
    if (!emisor.actecos || emisor.actecos.length === 0) {
      throw new ErrorValidacionDte('El emisor debe informar al menos un Acteco (código de actividad económica)');
    }
    if (emisor.actecos.length > MAX_ACTECOS) {
      throw new ErrorValidacionDte(`Máximo ${MAX_ACTECOS} Acteco en el emisor`);
    }
    for (const a of emisor.actecos) {
      if (!Number.isInteger(a) || a <= 0 || a > 999999) throw new ErrorValidacionDte(`Acteco inválido: ${a}`);
    }
  }
  if (!emisor.razonSocial.trim()) throw new ErrorValidacionDte('El emisor debe tener razón social');
  if (!emisor.giro.trim()) throw new ErrorValidacionDte('El emisor debe tener giro');
  const rutReceptor = rutDe(receptor.rut, receptor.dv, 'Receptor');
  if (!receptor.razonSocial.trim() && !(boleta && rutReceptor === RUT_GENERICO)) {
    throw new ErrorValidacionDte('El receptor debe tener razón social');
  }
  if (!boleta && rutReceptor === RUT_GENERICO) {
    throw new ErrorValidacionDte('El RUT genérico 66666666-6 solo es válido en boletas');
  }

  // Detalle y límites
  const max = boleta ? MAX_LINEAS_DETALLE_BOLETA : MAX_LINEAS_DETALLE_DTE;
  if (doc.detalle.length === 0) throw new ErrorValidacionDte('El documento debe tener al menos una línea de detalle');
  if (doc.detalle.length > max) {
    throw new ErrorValidacionDte(
      `El tipo ${tipo} admite como máximo ${max} líneas de detalle (recibidas ${doc.detalle.length})`,
    );
  }
  if ((doc.descuentosRecargos?.length ?? 0) > MAX_DESCUENTOS_RECARGOS) {
    throw new ErrorValidacionDte(`Máximo ${MAX_DESCUENTOS_RECARGOS} descuentos/recargos globales`);
  }
  if ((doc.referencias?.length ?? 0) > MAX_REFERENCIAS) {
    throw new ErrorValidacionDte(`Máximo ${MAX_REFERENCIAS} referencias`);
  }
  if (boleta && (doc.impuestosAdicionales?.length ?? 0) > 0) {
    throw new ErrorValidacionDte('Las boletas no admiten impuestos adicionales');
  }

  // Campos exclusivos por tipo
  if (idDoc.indTraslado !== undefined && tipo !== 52) {
    throw new ErrorValidacionDte('indTraslado solo aplica a guías de despacho (52)');
  }
  if (!boleta && idDoc.medioPago !== undefined) {
    throw new ErrorValidacionDte('medioPago (numérico) solo aplica a boletas; use medioPagoDte');
  }
  if (boleta && (idDoc.medioPagoDte !== undefined || idDoc.formaPago !== undefined)) {
    throw new ErrorValidacionDte('Las boletas no admiten formaPago ni medioPagoDte; use medioPago');
  }
  if (!boleta && idDoc.indServicio !== undefined && idDoc.indServicio > 3) {
    throw new ErrorValidacionDte('indServicio 4 solo aplica a boletas');
  }

  // Ventas afectas sin base afecta: el SII exige 34/41 para documentos totalmente exentos.
  if ((tipo === 33 || tipo === 39) && doc.detalle.every((l) => l.exento === true)) {
    throw new ErrorValidacionDte(
      `El tipo ${tipo} requiere al menos un ítem afecto; para ventas exentas use ${tipo === 33 ? 34 : 41}`,
    );
  }

  // Referencias
  for (const [i, r] of (doc.referencias ?? []).entries()) {
    const ctx = `Referencia ${i + 1}`;
    if (!r.tipoDocRef.trim() || r.tipoDocRef.length > 3) throw new ErrorValidacionDte(`${ctx}: tipoDocRef inválido`);
    if (String(r.folioRef).length === 0 || String(r.folioRef).length > 18) {
      throw new ErrorValidacionDte(`${ctx}: folioRef inválido`);
    }
    validarFecha(r.fechaRef, `${ctx}: fechaRef`);
  }
  if (tipo === 56 || tipo === 61) {
    const reales = (doc.referencias ?? []).filter((r) => r.tipoDocRef !== 'SET');
    if (reales.length === 0) {
      throw new ErrorValidacionDte(
        `La nota de ${tipo === 61 ? 'crédito' : 'débito'} (${tipo}) debe referenciar el documento que modifica`,
      );
    }
    if (reales.some((r) => r.codRef === undefined)) {
      throw new ErrorValidacionDte(`Las referencias de la nota ${tipo} deben informar codRef (1, 2 o 3)`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Armado del XML
// ---------------------------------------------------------------------------------------------

function xmlIdDoc(doc: DocumentoDte): string {
  const d = doc.idDoc;
  if (esBoleta(d.tipoDte)) {
    // Orden de EnvioBOLETA_v11.xsd: IndServicio es obligatorio; FchVenc va antes que MedioPago.
    return (
      '<IdDoc>' +
      tag('TipoDTE', d.tipoDte) +
      tag('Folio', d.folio) +
      tag('FchEmis', d.fechaEmision) +
      tag('IndServicio', d.indServicio ?? 3) +
      tag('PeriodoDesde', d.periodoDesde) +
      tag('PeriodoHasta', d.periodoHasta) +
      tag('FchVenc', d.fechaVencimiento) +
      tag('MedioPago', d.medioPago) +
      '</IdDoc>'
    );
  }
  return (
    '<IdDoc>' +
    tag('TipoDTE', d.tipoDte) +
    tag('Folio', d.folio) +
    tag('FchEmis', d.fechaEmision) +
    tag('IndTraslado', d.indTraslado) +
    tag('IndServicio', d.indServicio) +
    tag('FmaPago', d.formaPago) +
    tag('PeriodoDesde', d.periodoDesde) +
    tag('PeriodoHasta', d.periodoHasta) +
    tag('MedioPago', d.medioPagoDte) +
    tag('FchVenc', d.fechaVencimiento) +
    '</IdDoc>'
  );
}

function xmlEmisor(e: EmisorDte, boleta: boolean): string {
  const rut = tag('RUTEmisor', formatearRut(String(e.rut).replace(/\D/g, ''), e.dv));
  const sucursal = tag('CdgSIISucur', e.codigoSucursalSii);
  const origen = tag('DirOrigen', e.direccion, 70) + tag('CmnaOrigen', e.comuna, 20) + tag('CiudadOrigen', e.ciudad, 20);
  if (boleta) {
    return `<Emisor>${rut}${tag('RznSocEmisor', e.razonSocial, 100)}${tag('GiroEmisor', e.giro, 80)}${sucursal}${origen}</Emisor>`;
  }
  const actecos = (e.actecos ?? []).map((a) => tag('Acteco', a)).join('');
  return (
    `<Emisor>${rut}${tag('RznSoc', e.razonSocial, 100)}${tag('GiroEmis', e.giro, 80)}` +
    `${tag('Telefono', e.telefono, 20)}${tag('CorreoEmisor', e.correo, 80)}${actecos}${sucursal}${origen}</Emisor>`
  );
}

function xmlReceptor(r: ReceptorDte, boleta: boolean): string {
  const rut = tag('RUTRecep', formatearRut(String(r.rut).replace(/\D/g, ''), r.dv));
  const ubicacion = tag('DirRecep', r.direccion, 70) + tag('CmnaRecep', r.comuna, 20) + tag('CiudadRecep', r.ciudad, 20);
  if (boleta) {
    return (
      `<Receptor>${rut}${tag('RznSocRecep', r.razonSocial, 100)}${tag('CorreoRecep', r.correo, 80)}` +
      `${tag('TelefonoRecep', r.telefono, 20)}${ubicacion}</Receptor>`
    );
  }
  return (
    `<Receptor>${rut}${tag('RznSocRecep', r.razonSocial, 100)}${tag('GiroRecep', r.giro, 40)}` +
    `${tag('Contacto', r.telefono, 80)}${tag('CorreoRecep', r.correo, 80)}${ubicacion}</Receptor>`
  );
}

function xmlTotales(doc: DocumentoDte, tot: TotalesDte): string {
  const boleta = esBoleta(doc.idDoc.tipoDte);
  let s = '<Totales>';
  if (tot.mntNeto > 0) s += tag('MntNeto', tot.mntNeto);
  if (tot.mntExe > 0) s += tag('MntExe', tot.mntExe);
  if (!boleta && tot.mntNeto > 0) s += tag('TasaIVA', numeroXml(tot.tasaIva, 2));
  if (tot.mntNeto > 0) s += tag('IVA', tot.iva);
  if (!boleta) {
    for (const imp of doc.impuestosAdicionales ?? []) {
      s +=
        '<ImptoReten>' +
        tag('TipoImp', imp.codigo) +
        tag('TasaImp', imp.tasa === undefined ? undefined : numeroXml(imp.tasa, 2)) +
        tag('MontoImp', imp.monto) +
        '</ImptoReten>';
    }
  }
  return s + tag('MntTotal', tot.mntTotal) + '</Totales>';
}

function xmlDetalle(doc: DocumentoDte, tot: TotalesDte): string {
  const todoExento = esTipoExento(doc.idDoc.tipoDte);
  return doc.detalle
    .map((l, i) => {
      const cod =
        l.codigoItem === undefined
          ? undefined
          : typeof l.codigoItem === 'string'
            ? { tipo: 'INT1', valor: l.codigoItem }
            : l.codigoItem;
      const exento = todoExento || l.exento === true;
      return (
        '<Detalle>' +
        tag('NroLinDet', i + 1) +
        (cod ? `<CdgItem>${tag('TpoCodigo', cod.tipo, 10)}${tag('VlrCodigo', cod.valor, 35)}</CdgItem>` : '') +
        (exento ? '<IndExe>1</IndExe>' : '') +
        tag('NmbItem', l.nombre, 80) +
        tag('DscItem', l.descripcion, 1000) +
        tag('QtyItem', numeroXml(l.cantidad)) +
        tag('UnmdItem', l.unidad, 4) +
        (l.precioUnitario > 0 ? tag('PrcItem', numeroXml(l.precioUnitario)) : '') +
        tag('DescuentoPct', l.descuentoPorcentaje === undefined ? undefined : numeroXml(l.descuentoPorcentaje, 2)) +
        tag('DescuentoMonto', l.descuentoMonto) +
        tag('MontoItem', tot.montosLineas[i]) +
        '</Detalle>'
      );
    })
    .join('');
}

function xmlDescuentosRecargos(doc: DocumentoDte, tot: TotalesDte): string {
  const exentoTipo = esTipoExento(doc.idDoc.tipoDte);
  return (doc.descuentosRecargos ?? [])
    .map((dr, i) => {
      const valor = dr.tipoValor === '%' ? numeroXml(dr.valor, 2) : String(tot.montosGlobales[i]);
      return (
        '<DscRcgGlobal>' +
        tag('NroLinDR', i + 1) +
        tag('TpoMov', dr.tipo) +
        tag('GlosaDR', dr.glosa, 45) +
        tag('TpoValor', dr.tipoValor) +
        tag('ValorDR', valor) +
        (exentoTipo || dr.exento ? '<IndExeDR>1</IndExeDR>' : '') +
        '</DscRcgGlobal>'
      );
    })
    .join('');
}

function xmlReferencias(doc: DocumentoDte): string {
  const boleta = esBoleta(doc.idDoc.tipoDte);
  return (doc.referencias ?? [])
    .map(
      (r, i) =>
        '<Referencia>' +
        tag('NroLinRef', i + 1) +
        tag('TpoDocRef', r.tipoDocRef, 3) +
        (!boleta && r.indGlobal ? '<IndGlobal>1</IndGlobal>' : '') +
        tag('FolioRef', String(r.folioRef), 18) +
        (boleta ? '' : tag('FchRef', r.fechaRef)) +
        tag('CodRef', r.codRef) +
        tag('RazonRef', r.razonRef, 90) +
        '</Referencia>',
    )
    .join('');
}

/**
 * Construye, timbra y firma un DTE (`<DTE>` con `Documento`, TED y `Signature`).
 *
 * Orden de los elementos según `DTE_v10.xsd` (33, 34, 52, 56, 61) y `EnvioBOLETA_v11.xsd` (39, 41):
 * `Encabezado(IdDoc, Emisor, Receptor, Totales)`, `Detalle*`, `DscRcgGlobal*`, `Referencia*`, `TED`, `TmstFirma`.
 * En boletas cambian los nombres del emisor (`RznSocEmisor`, `GiroEmisor`), no hay `Acteco` y
 * `IndServicio` es obligatorio.
 *
 * El `<DTE>` declara `xmlns:xsi` además del namespace SII para que su canonización (y por tanto la
 * firma) sea la misma dentro de un sobre `EnvioDTE`/`EnvioBOLETA`, que declara ambos prefijos.
 *
 * @throws ErrorValidacionDte ante datos de negocio inválidos.
 */
export function construirDte(doc: DocumentoDte, opciones: OpcionesConstruirDte): DteConstruido {
  const { caf, certificado } = opciones;
  validarDocumento(doc, caf);
  const totales = calcularTotales(doc);
  const tipo = doc.idDoc.tipoDte;
  const boleta = esBoleta(tipo);
  const ts = formatearTimestampSii(opciones.fechaFirma ?? new Date());
  const idDocumento = `F${doc.idDoc.folio}T${tipo}`;

  const rutEmisor = formatearRut(String(doc.emisor.rut).replace(/\D/g, ''), doc.emisor.dv);
  const rutReceptor = formatearRut(String(doc.receptor.rut).replace(/\D/g, ''), doc.receptor.dv);

  const ted = generarTed(
    {
      rutEmisor,
      tipoDte: tipo,
      folio: doc.idDoc.folio,
      fechaEmision: doc.idDoc.fechaEmision,
      rutReceptor,
      razonSocialReceptor: doc.receptor.razonSocial,
      monto: totales.mntTotal,
      itemPrimero: doc.detalle[0].nombre,
      timestamp: ts,
    },
    caf,
  );

  const xml =
    `<DTE version="1.0" xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}">` +
    `<Documento ID="${idDocumento}">` +
    '<Encabezado>' +
    xmlIdDoc(doc) +
    xmlEmisor(doc.emisor, boleta) +
    xmlReceptor(doc.receptor, boleta) +
    xmlTotales(doc, totales) +
    '</Encabezado>' +
    xmlDetalle(doc, totales) +
    xmlDescuentosRecargos(doc, totales) +
    xmlReferencias(doc) +
    ted +
    `<TmstFirma>${ts}</TmstFirma>` +
    '</Documento></DTE>';

  const xmlFirmado = firmarXml(xml, { ...certificado, idReferencia: idDocumento });
  return { xmlFirmado, xmlIso: aIso88591(xmlFirmado), ted, idDocumento, totales };
}
