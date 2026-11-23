import type { Caf } from '../caf/caf.js';
import { folioEnRango } from '../caf/caf.js';
import { ErrorValidacionDte } from '../documento/errores.js';
import {
  esExportacion,
  MAX_ACTECOS,
  MAX_DESCUENTOS_RECARGOS,
  MAX_LINEAS_DETALLE_DTE,
  MAX_REFERENCIAS,
  type DocumentoDte,
  type TotalesDte,
} from '../documento/tipos.js';
import { NS_SII, NS_XSI, numeroXml, rutDe, tag, validarFecha } from '../documento/xml-helpers.js';
import { firmarXml } from '../firma/firma.js';
import { generarTed } from '../ted/ted.js';
import { aIso88591, formatearRut, formatearTimestampSii, separarRut, validarDv } from '../xml/xml.util.js';
import {
  GLOSA_CLAUSULA,
  GLOSA_FORMA_PAGO,
  GLOSA_MODALIDAD,
  GLOSA_PAIS,
  GLOSA_PUERTO,
  GLOSA_TIPO_BULTO,
  GLOSA_VIA,
  MONEDAS_XSD,
} from './tablas/index.js';
import { calcularTotalesExportacion, escalar } from './totales.js';
import type { AduanaExportacion, ExportacionDte, TotalesExportacion } from './tipos.js';

/** RUT que identifica al receptor extranjero en los documentos de exportación (formato DTE v2.5, campo `RUTRecep`). */
export const RUT_RECEPTOR_EXPORTACION = '55555555-5';
/** Glosas de moneda que no pueden ser la moneda de la operación (el equivalente en pesos va en `OtraMoneda`). */
export const MONEDAS_PESO: readonly string[] = ['PESO', 'PESO CL'];
/** `IndServicio` de exportación: 3 servicios, 4 hotelería, 5 transporte terrestre internacional, 6 prestados y utilizados en el extranjero. */
export const IND_SERVICIO_EXPORTACION: readonly number[] = [3, 4, 5, 6];
/** Tipos de documento que una nota de exportación puede referenciar. */
export const TIPOS_REFERENCIABLES_EXPORTACION: readonly string[] = ['110', '111', '112'];
/** Forma de pago de exportación "pago anticipado a la fecha de embarque" (Anexo 51-22): exige `fechaCancelacion`. */
const FORMA_PAGO_ANTICIPO = 32;

export interface OpcionesConstruirExportacion {
  caf: Caf;
  certificado: { certificadoPem: string; clavePrivadaPem: string };
  fechaFirma?: Date;
  /**
   * Valida país, puerto, vía, cláusula, modalidad, forma de pago y tipo de bulto contra las tablas de Aduana
   * descargadas (`exportacion/tablas`). Por defecto `true`. Con `false` solo se valida el formato numérico.
   */
  validarTablasAduana?: boolean;
}

export interface ExportacionConstruida {
  xmlFirmado: string;
  xmlIso: Buffer;
  ted: string;
  idDocumento: string;
  /** Totales en pesos (columnas de `documentos`): `mntExe` y `mntTotal` son el equivalente en CLP; `montosLineas` en moneda de la operación. */
  totales: TotalesDte;
  totalesExportacion: TotalesExportacion;
}

function err(mensaje: string, campo: string): never {
  throw new ErrorValidacionDte(`${campo}: ${mensaje}`, campo);
}

function codigoEntero(v: number | undefined, campo: string, digitos: number): void {
  if (v === undefined) return;
  if (!Number.isInteger(v) || v <= 0 || String(v).length > digitos) {
    err(`debe ser un entero positivo de hasta ${digitos} dígitos (recibido ${String(v)})`, campo);
  }
}

function enTabla(v: number | undefined, campo: string, tabla: ReadonlyMap<number, string>, nombreTabla: string, activa: boolean): void {
  if (v === undefined || !activa) return;
  if (!tabla.has(v)) err(`el código ${v} no figura en la tabla ${nombreTabla} de Aduana (Anexo 51)`, campo);
}

function textoMax(v: string | undefined, campo: string, max: number): void {
  if (v !== undefined && Array.from(v.trim()).length > max) err(`admite como máximo ${max} caracteres`, campo);
}

function decimalMax(v: number | undefined, campo: string, dec: number, min?: number): void {
  if (v === undefined) return;
  escalar(v, dec, campo);
  if (min !== undefined && v < min) err(`debe ser mayor o igual a ${min}`, campo);
}

function validarAduana(a: AduanaExportacion, doc: DocumentoDte, tablas: boolean): void {
  const tipo = doc.idDoc.tipoDte;
  const p = 'exportacion.aduana';
  const ind = doc.idDoc.indServicio;
  const bienes = ind === undefined;
  const sinClausula = ind !== undefined && [3, 4, 5].includes(ind);

  codigoEntero(a.codigoModalidadVenta, `${p}.codigoModalidadVenta`, 2);
  codigoEntero(a.codigoClausulaVenta, `${p}.codigoClausulaVenta`, 2);
  codigoEntero(a.codigoViaTransporte, `${p}.codigoViaTransporte`, 2);
  codigoEntero(a.codigoPuertoEmbarque, `${p}.codigoPuertoEmbarque`, 4);
  codigoEntero(a.codigoPuertoDesembarque, `${p}.codigoPuertoDesembarque`, 4);
  codigoEntero(a.codigoUnidadTara, `${p}.codigoUnidadTara`, 2);
  codigoEntero(a.codigoUnidadPesoBruto, `${p}.codigoUnidadPesoBruto`, 2);
  codigoEntero(a.codigoUnidadPesoNeto, `${p}.codigoUnidadPesoNeto`, 2);
  codigoEntero(a.codigoPaisReceptor, `${p}.codigoPaisReceptor`, 3);
  codigoEntero(a.codigoPaisDestino, `${p}.codigoPaisDestino`, 3);
  enTabla(a.codigoModalidadVenta, `${p}.codigoModalidadVenta`, GLOSA_MODALIDAD, 'Modalidad de Venta (51-26)', tablas);
  enTabla(a.codigoClausulaVenta, `${p}.codigoClausulaVenta`, GLOSA_CLAUSULA, 'Cláusulas de Compraventa (51-21)', tablas);
  enTabla(a.codigoViaTransporte, `${p}.codigoViaTransporte`, GLOSA_VIA, 'Vías de Transporte (51-13)', tablas);
  enTabla(a.codigoPuertoEmbarque, `${p}.codigoPuertoEmbarque`, GLOSA_PUERTO, 'Puertos (51-11)', tablas);
  enTabla(a.codigoPuertoDesembarque, `${p}.codigoPuertoDesembarque`, GLOSA_PUERTO, 'Puertos (51-11)', tablas);
  enTabla(a.codigoPaisReceptor, `${p}.codigoPaisReceptor`, GLOSA_PAIS, 'Países (51-9)', tablas);
  enTabla(a.codigoPaisDestino, `${p}.codigoPaisDestino`, GLOSA_PAIS, 'Países (51-9)', tablas);

  decimalMax(a.totalClausulaVenta, `${p}.totalClausulaVenta`, 2, 0.01);
  textoMax(a.nombreTransporte, `${p}.nombreTransporte`, 40);
  textoMax(a.nombreCompaniaTransporte, `${p}.nombreCompaniaTransporte`, 40);
  textoMax(a.idAdicionalTransporte, `${p}.idAdicionalTransporte`, 20);
  textoMax(a.booking, `${p}.booking`, 20);
  textoMax(a.operador, `${p}.operador`, 20);
  textoMax(a.idAdicionalPuertoEmbarque, `${p}.idAdicionalPuertoEmbarque`, 20);
  textoMax(a.idAdicionalPuertoDesembarque, `${p}.idAdicionalPuertoDesembarque`, 20);
  if (a.rutCompaniaTransporte !== undefined) {
    const m = separarRut(a.rutCompaniaTransporte);
    if (!m || !validarDv(m.numero, m.dv)) err(`RUT inválido (${a.rutCompaniaTransporte})`, `${p}.rutCompaniaTransporte`);
  }

  if (a.tara !== undefined) {
    if (!Number.isInteger(a.tara) || a.tara <= 0 || String(a.tara).length > 7) err('la tara es un entero positivo de hasta 7 dígitos', `${p}.tara`);
    if (a.codigoUnidadTara === undefined) err('falta la unidad de medida de la tara (código de Aduana)', `${p}.codigoUnidadTara`);
  }
  if (a.pesoBruto !== undefined) {
    decimalMax(a.pesoBruto, `${p}.pesoBruto`, 2, 0.01);
    if (a.pesoBruto >= 1e8) err('admite como máximo 10 dígitos (8 enteros y 2 decimales)', `${p}.pesoBruto`);
    if (a.codigoUnidadPesoBruto === undefined) err('falta la unidad de medida (código de Aduana)', `${p}.codigoUnidadPesoBruto`);
  }
  if (a.pesoNeto !== undefined) {
    decimalMax(a.pesoNeto, `${p}.pesoNeto`, 2, 0.01);
    if (a.pesoNeto >= 1e8) err('admite como máximo 10 dígitos (8 enteros y 2 decimales)', `${p}.pesoNeto`);
    if (a.codigoUnidadPesoNeto === undefined) err('falta la unidad de medida (código de Aduana)', `${p}.codigoUnidadPesoNeto`);
  }
  if (
    a.pesoBruto !== undefined &&
    a.pesoNeto !== undefined &&
    a.codigoUnidadPesoBruto === a.codigoUnidadPesoNeto &&
    a.pesoNeto > a.pesoBruto
  ) {
    err('el peso neto no puede superar al peso bruto', `${p}.pesoNeto`);
  }
  if (a.totalItems !== undefined) {
    if (!Number.isInteger(a.totalItems) || a.totalItems <= 0) err('debe ser un entero positivo', `${p}.totalItems`);
    if (a.totalItems !== doc.detalle.length) err(`debe coincidir con las líneas del detalle (${doc.detalle.length})`, `${p}.totalItems`);
  }
  if (a.totalBultos !== undefined && (!Number.isInteger(a.totalBultos) || a.totalBultos <= 0)) {
    err('debe ser un entero positivo', `${p}.totalBultos`);
  }

  const bultos = a.bultos ?? [];
  if (bultos.length > 10) err('admite como máximo 10 tipos de bulto', `${p}.bultos`);
  if (bultos.length > 0 && a.totalBultos === undefined) err('se informa solo junto con totalBultos', `${p}.bultos`);
  let suma = 0;
  bultos.forEach((b, i) => {
    const c = `${p}.bultos[${i}]`;
    codigoEntero(b.codigoTipo, `${c}.codigoTipo`, 3);
    enTabla(b.codigoTipo, `${c}.codigoTipo`, GLOSA_TIPO_BULTO, 'Tipo de Bulto (51-23)', tablas);
    const cant = b.cantidad;
    if (cant === undefined) err('falta la cantidad de bultos de este tipo', `${c}.cantidad`);
    if (!Number.isInteger(cant) || (cant as number) <= 0 || String(cant).length > 10) {
      err('debe ser un entero positivo de hasta 10 dígitos', `${c}.cantidad`);
    }
    suma += cant as number;
    textoMax(b.marcas, `${c}.marcas`, 255);
    textoMax(b.idContenedor, `${c}.idContenedor`, 25);
    textoMax(b.sello, `${c}.sello`, 20);
    textoMax(b.emisorSello, `${c}.emisorSello`, 70);
  });
  if (bultos.length > 0 && suma !== a.totalBultos) {
    err(`la suma de bultos por tipo (${suma}) debe ser igual a totalBultos (${String(a.totalBultos)})`, `${p}.totalBultos`);
  }
  decimalMax(a.montoFlete, `${p}.montoFlete`, 4, 0.0001);
  decimalMax(a.montoSeguro, `${p}.montoSeguro`, 4, 0.0001);

  // Obligatoriedad del formato DTE v2.5 (factura de exportación; en las notas todo es opcional).
  if (tipo === 110) {
    if (a.codigoPaisReceptor === undefined) err('es obligatorio en la factura de exportación (país del receptor, tabla de países de Aduana)', `${p}.codigoPaisReceptor`);
    if (!sinClausula) {
      if (a.codigoModalidadVenta === undefined) err('es obligatorio (modalidad de venta de Aduana), salvo en servicios con indServicio 3, 4 o 5', `${p}.codigoModalidadVenta`);
      if (a.codigoClausulaVenta === undefined) err('es obligatorio (cláusula de compraventa de Aduana), salvo en servicios con indServicio 3, 4 o 5', `${p}.codigoClausulaVenta`);
      if (a.totalClausulaVenta === undefined) err('es obligatorio (total de la cláusula de venta), salvo en servicios con indServicio 3, 4 o 5', `${p}.totalClausulaVenta`);
    }
    if (ind !== 4 && a.codigoViaTransporte === undefined) err('es obligatorio (vía de transporte), salvo en hotelería (indServicio 4)', `${p}.codigoViaTransporte`);
    if (bienes) {
      if (a.totalBultos === undefined) err('es obligatorio en la exportación de bienes (total de bultos)', `${p}.totalBultos`);
      if (a.codigoPaisDestino === undefined) err('es obligatorio en la exportación de bienes (país de destino)', `${p}.codigoPaisDestino`);
      // El formato v2.5 los declara opcionales, pero el Manual de Muestras Impresas los exige impresos cuando hay transporte de mercaderías.
      if (a.codigoPuertoEmbarque === undefined) err('es obligatorio en la exportación de bienes (Manual de Muestras Impresas)', `${p}.codigoPuertoEmbarque`);
      if (a.codigoPuertoDesembarque === undefined) err('es obligatorio en la exportación de bienes (Manual de Muestras Impresas)', `${p}.codigoPuertoDesembarque`);
    }
  }
}

function validarExportacion(doc: DocumentoDte, caf: Caf, tablas: boolean): void {
  const { idDoc, emisor, receptor } = doc;
  const tipo = idDoc.tipoDte;
  if (!esExportacion(tipo)) throw new ErrorValidacionDte(`Tipo de documento de exportación no soportado: ${String(tipo)}`);
  if (!Number.isInteger(idDoc.folio) || idDoc.folio <= 0) throw new ErrorValidacionDte(`Folio inválido: ${idDoc.folio}`, 'idDoc.folio');
  validarFecha(idDoc.fechaEmision, 'fechaEmision');
  validarFecha(idDoc.fechaVencimiento, 'fechaVencimiento');
  validarFecha(idDoc.periodoDesde, 'periodoDesde');
  validarFecha(idDoc.periodoHasta, 'periodoHasta');
  if (caf.tipoDte !== tipo) throw new ErrorValidacionDte(`El CAF es de documentos tipo ${caf.tipoDte} y el documento es tipo ${tipo}`);
  if (!folioEnRango(caf, idDoc.folio)) {
    throw new ErrorValidacionDte(`El folio ${idDoc.folio} está fuera del rango del CAF (${caf.folioDesde}-${caf.folioHasta})`);
  }
  const rutEmisor = rutDe(emisor.rut, emisor.dv, 'Emisor');
  if (caf.rutEmisor.replace(/\./g, '').toUpperCase() !== rutEmisor) {
    throw new ErrorValidacionDte(`El CAF pertenece a ${caf.rutEmisor} y el emisor es ${rutEmisor}`);
  }
  if (!emisor.actecos || emisor.actecos.length === 0) {
    throw new ErrorValidacionDte('El emisor debe informar al menos un Acteco (código de actividad económica)');
  }
  if (emisor.actecos.length > MAX_ACTECOS) throw new ErrorValidacionDte(`Máximo ${MAX_ACTECOS} Acteco en el emisor`);
  if (!emisor.razonSocial.trim()) throw new ErrorValidacionDte('El emisor debe tener razón social');
  if (!emisor.giro.trim()) throw new ErrorValidacionDte('El emisor debe tener giro');

  const ex: ExportacionDte | undefined = doc.exportacion;
  if (!ex) return err('es obligatorio en los documentos de exportación (110, 111, 112)', 'exportacion');
  if (!ex.extranjero) return err('es obligatorio (receptor extranjero: nacionalidad y numId)', 'exportacion.extranjero');

  // Receptor extranjero
  const rutRecep = rutDe(receptor.rut, receptor.dv, 'Receptor');
  if (rutRecep !== RUT_RECEPTOR_EXPORTACION) {
    err(
      `el receptor de un documento de exportación lleva el RUT ${RUT_RECEPTOR_EXPORTACION} (recibido ${rutRecep}); el identificador del receptor en su país va en exportacion.extranjero.numId`,
      'receptor.rut',
    );
  }
  if (!receptor.razonSocial.trim()) err('el receptor debe tener razón social', 'receptor.razonSocial');
  if (tipo === 110 && !receptor.direccion?.trim()) {
    err('es obligatoria en la factura de exportación (dirección del receptor en el extranjero)', 'receptor.direccion');
  }
  textoMax(ex.extranjero.numId, 'exportacion.extranjero.numId', 20);
  textoMax(ex.extranjero.idAdicional, 'exportacion.extranjero.idAdicional', 20);
  textoMax(ex.idAdicionalEmisor, 'exportacion.idAdicionalEmisor', 20);
  const nac = String(ex.extranjero.nacionalidad ?? '').trim();
  if (!/^\d{1,3}$/.test(nac)) {
    err('la nacionalidad es obligatoria y se informa con el código de país de Aduana (hasta 3 dígitos)', 'exportacion.extranjero.nacionalidad');
  }
  enTabla(Number(nac), 'exportacion.extranjero.nacionalidad', GLOSA_PAIS, 'Países (51-9)', tablas);

  // Moneda y tipo de cambio
  if (typeof ex.moneda !== 'string' || ex.moneda.trim() === '') err('es obligatoria (glosa de moneda de Aduana, p. ej. "DOLAR USA")', 'exportacion.moneda');
  if (!MONEDAS_XSD.has(ex.moneda)) {
    err(`la moneda "${ex.moneda}" no es una glosa válida del XSD del SII (p. ej. "DOLAR USA", "EURO", "OTRAS MONEDAS")`, 'exportacion.moneda');
  }
  if (MONEDAS_PESO.includes(ex.moneda)) {
    err('la moneda de la operación debe ser distinta del peso chileno: el equivalente en pesos se calcula con el tipo de cambio', 'exportacion.moneda');
  }
  if (!(ex.tipoCambio >= 0.0001 && ex.tipoCambio <= 999_999.9999)) {
    err('el tipo de cambio debe estar entre 0,0001 y 999999,9999 pesos por unidad de moneda', 'exportacion.tipoCambio');
  }
  escalar(ex.tipoCambio, 4, 'exportacion.tipoCambio');

  // Formas de pago
  codigoEntero(ex.formaPagoExportacion, 'exportacion.formaPagoExportacion', 2);
  enTabla(ex.formaPagoExportacion, 'exportacion.formaPagoExportacion', GLOSA_FORMA_PAGO, 'Formas de Pago (51-22)', tablas);
  validarFecha(ex.fechaCancelacion, 'exportacion.fechaCancelacion');
  if (ex.formaPagoExportacion === FORMA_PAGO_ANTICIPO && !ex.fechaCancelacion) {
    err('es obligatoria cuando la forma de pago de exportación es anticipo (32)', 'exportacion.fechaCancelacion');
  }

  // Campos propios de otros tipos
  if (idDoc.indServicio !== undefined && !IND_SERVICIO_EXPORTACION.includes(idDoc.indServicio)) {
    err('en exportación admite 3 (servicios), 4 (hotelería), 5 (transporte terrestre internacional) o 6 (servicios prestados y utilizados en el extranjero); omítalo para bienes', 'idDoc.indServicio');
  }
  if (idDoc.indTraslado !== undefined) err('solo aplica a guías de despacho (52)', 'idDoc.indTraslado');
  if (idDoc.medioPago !== undefined) err('medioPago (numérico) solo aplica a boletas; use medioPagoDte', 'idDoc.medioPago');
  if (doc.traslado !== undefined) {
    err('los datos de traslado de la Res. Ex. SII 144/2026 no aplican a documentos de exportación; los datos de transporte van en exportacion.aduana', 'traslado');
  }
  if ((doc.impuestosAdicionales?.length ?? 0) > 0) {
    err('los documentos de exportación están exentos de IVA y no admiten impuestos adicionales', 'impuestosAdicionales');
  }
  if (doc.proveedorSoftware) err('solo aplica a boletas', 'proveedorSoftware');

  // Detalle y límites
  if (doc.detalle.length === 0) throw new ErrorValidacionDte('El documento debe tener al menos una línea de detalle', 'detalle');
  if (doc.detalle.length > MAX_LINEAS_DETALLE_DTE) {
    throw new ErrorValidacionDte(
      `El tipo ${tipo} admite como máximo ${MAX_LINEAS_DETALLE_DTE} líneas de detalle (recibidas ${doc.detalle.length})`,
      'detalle',
    );
  }
  doc.detalle.forEach((l, i) => {
    const c = `detalle[${i}]`;
    if (l.cantidad === undefined || !(l.cantidad > 0)) err('la cantidad es obligatoria y mayor que cero', `${c}.cantidad`);
    if (!(l.precioUnitario >= 0)) err('el precio unitario no puede ser negativo', `${c}.precioUnitario`);
    if (l.descuentoMonto !== undefined && !Number.isInteger(l.descuentoMonto)) {
      err('el descuento en monto de una línea de exportación es un entero (tipo MntImpType del XSD); use descuentoPorcentaje para decimales', `${c}.descuentoMonto`);
    }
    if (l.descuentoPorcentaje !== undefined && !(l.descuentoPorcentaje > 0 && l.descuentoPorcentaje <= 100)) {
      err('debe estar entre 0,01 y 100', `${c}.descuentoPorcentaje`);
    }
  });
  if ((doc.descuentosRecargos?.length ?? 0) > MAX_DESCUENTOS_RECARGOS) {
    throw new ErrorValidacionDte(`Máximo ${MAX_DESCUENTOS_RECARGOS} descuentos/recargos globales`);
  }
  (doc.descuentosRecargos ?? []).forEach((d, i) => {
    if (!(d.valor > 0)) err('debe ser mayor que cero (mínimo 0,01)', `descuentosRecargos[${i}].valor`);
  });
  if ((doc.referencias?.length ?? 0) > MAX_REFERENCIAS) throw new ErrorValidacionDte(`Máximo ${MAX_REFERENCIAS} referencias`);

  // Referencias
  const refs = doc.referencias ?? [];
  refs.forEach((r, i) => {
    const c = `referencias[${i}]`;
    if (!r.tipoDocRef.trim() || r.tipoDocRef.length > 3) err('tipoDocRef inválido', `${c}.tipoDocRef`);
    if (String(r.folioRef).length === 0 || String(r.folioRef).length > 18) err('folioRef inválido', `${c}.folioRef`);
    validarFecha(r.fechaRef, `${c}.fechaRef`);
    if (r.rutOtroContribuyente !== undefined) {
      const m = separarRut(r.rutOtroContribuyente);
      if (!m || !validarDv(m.numero, m.dv)) err(`RUT inválido (${r.rutOtroContribuyente})`, `${c}.rutOtroContribuyente`);
    }
  });
  if (refs.filter((r) => r.tipoDocRef === '807').length > 1) err('una factura de exportación referencia como máximo un DUS (807)', 'referencias');
  if (refs.filter((r) => r.tipoDocRef === '811').length > 1) err('una factura de exportación referencia como máximo una Carta de Porte (811)', 'referencias');
  if (tipo === 111 || tipo === 112) {
    const aExportacion = refs.filter((r) => TIPOS_REFERENCIABLES_EXPORTACION.includes(r.tipoDocRef));
    if (aExportacion.length === 0) {
      err(
        `la nota de ${tipo === 112 ? 'crédito' : 'débito'} de exportación (${tipo}) debe referenciar la factura de exportación (110) o la nota (111/112) que modifica`,
        'referencias',
      );
    }
    if (aExportacion.some((r) => r.codRef === undefined)) {
      err(`las referencias de la nota ${tipo} deben informar codRef (1 anula, 2 corrige texto, 3 corrige montos)`, 'referencias');
    }
  }

  if (ex.aduana) validarAduana(ex.aduana, doc, tablas);
  else if (tipo === 110) err('es obligatorio en la factura de exportación (datos de Aduana: país, vía, cláusula, puertos, bultos)', 'exportacion.aduana');
}

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

function xmlIdDocExportacion(doc: DocumentoDte, ex: ExportacionDte): string {
  const d = doc.idDoc;
  return (
    '<IdDoc>' +
    tag('TipoDTE', d.tipoDte) +
    tag('Folio', d.folio) +
    tag('FchEmis', d.fechaEmision) +
    tag('TipoDespacho', d.tipoDespacho) +
    tag('IndServicio', d.indServicio) +
    tag('FmaPago', d.formaPago) +
    tag('FmaPagExp', ex.formaPagoExportacion) +
    tag('FchCancel', ex.fechaCancelacion) +
    tag('PeriodoDesde', d.periodoDesde) +
    tag('PeriodoHasta', d.periodoHasta) +
    tag('MedioPago', d.medioPagoDte) +
    tag('FchVenc', d.fechaVencimiento) +
    '</IdDoc>'
  );
}

function xmlEmisorExportacion(doc: DocumentoDte, ex: ExportacionDte): string {
  const e = doc.emisor;
  return (
    '<Emisor>' +
    tag('RUTEmisor', formatearRut(String(e.rut).replace(/\D/g, ''), e.dv)) +
    tag('RznSoc', e.razonSocial, 100) +
    tag('GiroEmis', e.giro, 80) +
    tag('Telefono', e.telefono, 20) +
    tag('CorreoEmisor', e.correo, 80) +
    (e.actecos ?? []).map((a) => tag('Acteco', a)).join('') +
    tag('CdgSIISucur', e.codigoSucursalSii) +
    tag('DirOrigen', e.direccion, 70) +
    tag('CmnaOrigen', e.comuna, 20) +
    tag('CiudadOrigen', e.ciudad, 20) +
    tag('IdAdicEmisor', ex.idAdicionalEmisor, 20) +
    '</Emisor>'
  );
}

function xmlReceptorExportacion(doc: DocumentoDte, ex: ExportacionDte): string {
  const r = doc.receptor;
  const ext = ex.extranjero;
  const extranjero =
    tag('NumId', ext.numId, 20) + tag('Nacionalidad', String(ext.nacionalidad).trim(), 3) + tag('IdAdicRecep', ext.idAdicional, 20);
  return (
    '<Receptor>' +
    tag('RUTRecep', RUT_RECEPTOR_EXPORTACION) +
    tag('RznSocRecep', r.razonSocial, 100) +
    (extranjero ? `<Extranjero>${extranjero}</Extranjero>` : '') +
    tag('GiroRecep', r.giro, 40) +
    tag('Contacto', r.telefono, 80) +
    tag('CorreoRecep', r.correo, 80) +
    tag('DirRecep', r.direccion, 70) +
    tag('CmnaRecep', r.comuna, 20) +
    tag('CiudadRecep', r.ciudad, 20) +
    '</Receptor>'
  );
}

function xmlAduana(a: AduanaExportacion): string {
  const bultos = (a.bultos ?? [])
    .map(
      (b) =>
        '<TipoBultos>' +
        tag('CodTpoBultos', b.codigoTipo) +
        tag('CantBultos', b.cantidad) +
        tag('Marcas', b.marcas, 255) +
        tag('IdContainer', b.idContenedor, 25) +
        tag('Sello', b.sello, 20) +
        tag('EmisorSello', b.emisorSello, 70) +
        '</TipoBultos>',
    )
    .join('');
  const n = (v: number | undefined, dec: number) => (v === undefined ? undefined : numeroXml(v, dec));
  const cuerpo =
    tag('CodModVenta', a.codigoModalidadVenta) +
    tag('CodClauVenta', a.codigoClausulaVenta) +
    tag('TotClauVenta', n(a.totalClausulaVenta, 2)) +
    tag('CodViaTransp', a.codigoViaTransporte) +
    tag('NombreTransp', a.nombreTransporte, 40) +
    tag('RUTCiaTransp', a.rutCompaniaTransporte === undefined ? undefined : a.rutCompaniaTransporte.replace(/\./g, '').toUpperCase()) +
    tag('NomCiaTransp', a.nombreCompaniaTransporte, 40) +
    tag('IdAdicTransp', a.idAdicionalTransporte, 20) +
    tag('Booking', a.booking, 20) +
    tag('Operador', a.operador, 20) +
    tag('CodPtoEmbarque', a.codigoPuertoEmbarque) +
    tag('IdAdicPtoEmb', a.idAdicionalPuertoEmbarque, 20) +
    tag('CodPtoDesemb', a.codigoPuertoDesembarque) +
    tag('IdAdicPtoDesemb', a.idAdicionalPuertoDesembarque, 20) +
    tag('Tara', a.tara) +
    tag('CodUnidMedTara', a.codigoUnidadTara) +
    tag('PesoBruto', n(a.pesoBruto, 2)) +
    tag('CodUnidPesoBruto', a.codigoUnidadPesoBruto) +
    tag('PesoNeto', n(a.pesoNeto, 2)) +
    tag('CodUnidPesoNeto', a.codigoUnidadPesoNeto) +
    tag('TotItems', a.totalItems) +
    tag('TotBultos', a.totalBultos) +
    bultos +
    tag('MntFlete', n(a.montoFlete, 4)) +
    tag('MntSeguro', n(a.montoSeguro, 4)) +
    tag('CodPaisRecep', a.codigoPaisReceptor) +
    tag('CodPaisDestin', a.codigoPaisDestino);
  return cuerpo ? `<Transporte><Aduana>${cuerpo}</Aduana></Transporte>` : '';
}

function xmlTotalesExportacion(t: TotalesExportacion): string {
  return (
    '<Totales>' +
    tag('TpoMoneda', t.moneda) +
    tag('MntExe', numeroXml(t.montoExento, 4)) +
    tag('MntTotal', numeroXml(t.montoTotal, 4)) +
    '</Totales>' +
    '<OtraMoneda>' +
    tag('TpoMoneda', 'PESO CL') +
    tag('TpoCambio', numeroXml(t.tipoCambio, 4)) +
    tag('MntExeOtrMnda', t.montoExentoPesos) +
    tag('MntTotOtrMnda', t.montoTotalPesos) +
    '</OtraMoneda>'
  );
}

function xmlDetalleExportacion(doc: DocumentoDte, t: TotalesExportacion): string {
  return doc.detalle
    .map((l, i) => {
      const cod = l.codigoItem === undefined ? undefined : typeof l.codigoItem === 'string' ? { tipo: 'INT1', valor: l.codigoItem } : l.codigoItem;
      return (
        '<Detalle>' +
        tag('NroLinDet', i + 1) +
        (cod ? `<CdgItem>${tag('TpoCodigo', cod.tipo, 10)}${tag('VlrCodigo', cod.valor, 35)}</CdgItem>` : '') +
        '<IndExe>1</IndExe>' +
        tag('NmbItem', l.nombre, 80) +
        tag('DscItem', l.descripcion, 1000) +
        tag('QtyItem', numeroXml(l.cantidad as number, 6)) +
        tag('UnmdItem', l.unidad, 4) +
        (l.precioUnitario > 0 ? tag('PrcItem', numeroXml(l.precioUnitario, 6)) : '') +
        tag('DescuentoPct', l.descuentoPorcentaje === undefined ? undefined : numeroXml(l.descuentoPorcentaje, 2)) +
        tag('DescuentoMonto', l.descuentoMonto) +
        tag('MontoItem', numeroXml(t.montosLineas[i] as number, 4)) +
        '</Detalle>'
      );
    })
    .join('');
}

function xmlGlobalesExportacion(doc: DocumentoDte): string {
  return (doc.descuentosRecargos ?? [])
    .map(
      (dr, i) =>
        '<DscRcgGlobal>' +
        tag('NroLinDR', i + 1) +
        tag('TpoMov', dr.tipo) +
        tag('GlosaDR', dr.glosa, 45) +
        tag('TpoValor', dr.tipoValor) +
        tag('ValorDR', numeroXml(dr.valor, 2)) +
        '<IndExeDR>1</IndExeDR>' +
        '</DscRcgGlobal>',
    )
    .join('');
}

function xmlReferenciasExportacion(doc: DocumentoDte): string {
  return (doc.referencias ?? [])
    .map(
      (r, i) =>
        '<Referencia>' +
        tag('NroLinRef', i + 1) +
        tag('TpoDocRef', r.tipoDocRef, 3) +
        (r.indGlobal ? '<IndGlobal>1</IndGlobal>' : '') +
        tag('FolioRef', String(r.folioRef), 18) +
        tag('RUTOtr', r.rutOtroContribuyente?.replace(/\./g, '').toUpperCase()) +
        tag('FchRef', r.fechaRef) +
        tag('CodRef', r.codRef) +
        tag('RazonRef', r.razonRef, 90) +
        '</Referencia>',
    )
    .join('');
}

/**
 * Construye, timbra y firma un documento de exportación (110, 111 o 112): `<DTE><Exportaciones ID=...>` con
 * `Encabezado` (IdDoc, Emisor, Receptor extranjero, Transporte/Aduana, Totales en la moneda de la operación y
 * `OtraMoneda` en pesos), `Detalle`, `DscRcgGlobal`, `Referencia`, `TED` y `TmstFirma`.
 *
 * El TED lleva `MNT` en pesos chilenos enteros (el Instructivo de Emisión define `MNT` como "Monto Total del DTE en
 * pesos chilenos, en notación decimal entera"); el XSD admite hasta 4 decimales, de modo que si el SII exigiera la
 * moneda de la operación habría que pasar `t.montoTotal` en el campo `monto` del TED.
 */
export function construirDteExportacion(doc: DocumentoDte, opciones: OpcionesConstruirExportacion): ExportacionConstruida {
  const { caf, certificado } = opciones;
  validarExportacion(doc, caf, opciones.validarTablasAduana ?? true);
  const ex = doc.exportacion as ExportacionDte;
  const t = calcularTotalesExportacion(doc);
  const tipo = doc.idDoc.tipoDte;
  const ts = formatearTimestampSii(opciones.fechaFirma ?? new Date());
  const idDocumento = `F${doc.idDoc.folio}T${tipo}`;
  const rutEmisor = formatearRut(String(doc.emisor.rut).replace(/\D/g, ''), doc.emisor.dv);

  const ted = generarTed(
    {
      rutEmisor,
      tipoDte: tipo,
      folio: doc.idDoc.folio,
      fechaEmision: doc.idDoc.fechaEmision,
      rutReceptor: RUT_RECEPTOR_EXPORTACION,
      razonSocialReceptor: doc.receptor.razonSocial,
      monto: t.montoTotalPesos,
      itemPrimero: (doc.detalle[0] as { nombre: string }).nombre,
      timestamp: ts,
    },
    caf,
  );

  const xml =
    `<DTE version="1.0" xmlns="${NS_SII}" xmlns:xsi="${NS_XSI}">` +
    `<Exportaciones ID="${idDocumento}">` +
    '<Encabezado>' +
    xmlIdDocExportacion(doc, ex) +
    xmlEmisorExportacion(doc, ex) +
    xmlReceptorExportacion(doc, ex) +
    (ex.aduana ? xmlAduana(ex.aduana) : '') +
    xmlTotalesExportacion(t) +
    '</Encabezado>' +
    xmlDetalleExportacion(doc, t) +
    xmlGlobalesExportacion(doc) +
    xmlReferenciasExportacion(doc) +
    ted +
    `<TmstFirma>${ts}</TmstFirma>` +
    '</Exportaciones></DTE>';

  const xmlFirmado = firmarXml(xml, { ...certificado, idReferencia: idDocumento });
  const totales: TotalesDte = {
    mntNeto: 0,
    mntExe: t.montoExentoPesos,
    tasaIva: 0,
    iva: 0,
    mntImpAdicionales: 0,
    mntTotal: t.montoTotalPesos,
    montosLineas: t.montosLineas,
    montosGlobales: t.montosGlobales,
  };
  return { xmlFirmado, xmlIso: aIso88591(xmlFirmado), ted, idDocumento, totales, totalesExportacion: t };
}
