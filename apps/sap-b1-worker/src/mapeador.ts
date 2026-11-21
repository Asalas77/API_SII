import type { Config } from './config.js';
import { normalizarRut, RUT_GENERICO } from './rut.js';
import {
  type BaseInfo,
  type DocumentoB1,
  type EntidadB1,
  type LineaB1,
  type SocioB1,
  type TipoDte,
  TIPOS_DTE,
} from './tipos-b1.js';

/** Cuerpo de `POST /v1/empresas/{rut}/documentos` (ver `EmitirDocumentoDto` de la API). */
export interface CuerpoDocumento {
  idDoc: {
    tipoDte: TipoDte;
    fechaEmision: string;
    fechaVencimiento?: string;
    formaPago?: 1 | 2 | 3;
    indTraslado?: number;
  };
  receptor?: {
    rut: string;
    razonSocial: string;
    giro?: string;
    direccion?: string;
    comuna?: string;
    ciudad?: string;
    correo?: string;
    telefono?: string;
  };
  detalle: Array<{
    nombre: string;
    descripcion?: string;
    codigoItem?: string;
    cantidad: number;
    unidad?: string;
    precioUnitario: number;
    descuentoPorcentaje?: number;
    exento?: boolean;
  }>;
  descuentosRecargos?: Array<{
    tipo: 'D' | 'R';
    glosa?: string;
    tipoValor: '%' | '$';
    valor: number;
    exento?: boolean;
  }>;
  referencias?: Array<{
    tipoDocRef: string;
    folioRef: string | number;
    fechaRef?: string;
    codRef?: 1 | 2 | 3;
    razonRef?: string;
  }>;
  origen?: Record<string, unknown>;
}

export type ResultadoMapeo =
  | { ok: true; cuerpo: CuerpoDocumento; tipoDte: TipoDte; advertencias: string[] }
  | { ok: false; errores: string[] };

export interface ContextoMapeo {
  config: Config['b1'];
  /** Socio de negocios (`CardCode`) ya leído; `null` si no se pudo leer. */
  socio: SocioB1 | null;
  /** Documentos base ya leídos, por `claveBase(objType, docEntry)`. */
  bases: ReadonlyMap<string, BaseInfo>;
}

export const MAX_LINEAS_DTE = 60;
export const MAX_LINEAS_BOLETA = 1000;

const TIPOS_POR_ENTIDAD: Record<EntidadB1['objType'], readonly TipoDte[]> = {
  13: [33, 34, 39, 41, 56],
  14: [61],
  15: [52],
};
const TIPO_POR_OBJTYPE: Record<number, TipoDte> = { 13: 33, 14: 61, 15: 52 };

export const claveBase = (objType: number, docEntry: number): string => `${objType}:${docEntry}`;

const esBoleta = (t: TipoDte): boolean => t === 39 || t === 41;

const trunc = (v: string | null | undefined, max: number): string => (v ?? '').trim().slice(0, max);
const fecha = (v: string | null | undefined): string => (v ?? '').slice(0, 10);
const redondear = (n: number, dec: number): number => Math.round(n * 10 ** dec) / 10 ** dec;

/** Documentos base (BaseType/BaseEntry) que referencian las líneas, sin repetir y en orden. */
export function basesDe(doc: DocumentoB1): Array<{ objType: number; docEntry: number }> {
  const vistos = new Set<string>();
  const salida: Array<{ objType: number; docEntry: number }> = [];
  for (const l of doc.DocumentLines ?? []) {
    if (typeof l.BaseType === 'number' && l.BaseType > 0 && typeof l.BaseEntry === 'number') {
      const k = claveBase(l.BaseType, l.BaseEntry);
      if (!vistos.has(k)) {
        vistos.add(k);
        salida.push({ objType: l.BaseType, docEntry: l.BaseEntry });
      }
    }
  }
  return salida;
}

/** Tipo de DTE: `U_SII_TipoDTE` si está, o el derivado del documento (OINV 33/34, ORIN 61, ODLN 52). */
export function resolverTipo(
  entidad: EntidadB1,
  doc: DocumentoB1,
  esExenta: (l: LineaB1) => boolean,
): { tipo: TipoDte } | { error: string } {
  const crudo = (doc.U_SII_TipoDTE ?? '').trim();
  if (crudo) {
    const n = Number(crudo);
    if (!TIPOS_DTE.includes(n as TipoDte)) {
      return { error: `U_SII_TipoDTE "${crudo}" no es un tipo válido (${TIPOS_DTE.join(', ')})` };
    }
    const tipo = n as TipoDte;
    if (!TIPOS_POR_ENTIDAD[entidad.objType].includes(tipo)) {
      return {
        error: `U_SII_TipoDTE ${tipo} no corresponde a ${entidad.entidad} (admite ${TIPOS_POR_ENTIDAD[entidad.objType].join(', ')})`,
      };
    }
    return { tipo };
  }
  const lineas = doc.DocumentLines ?? [];
  if (entidad.objType === 13 && lineas.length > 0 && lineas.every(esExenta)) return { tipo: 34 };
  return { tipo: TIPO_POR_OBJTYPE[entidad.objType] as TipoDte };
}

/**
 * Convierte un documento de B1 en el cuerpo de emisión de la API. Es una función pura: todo lo que
 * requiere E/S (socio, documentos base) llega ya leído en `ctx`. Acumula todos los errores de
 * validación para que el usuario los corrija de una vez.
 */
export function mapearDocumento(entidad: EntidadB1, doc: DocumentoB1, ctx: ContextoMapeo): ResultadoMapeo {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const exentos = new Set(ctx.config.codigosExentos);
  const esExenta = (l: LineaB1): boolean => exentos.has((l.TaxCode ?? '').trim());
  const lineasB1 = doc.DocumentLines ?? [];

  const t = resolverTipo(entidad, doc, esExenta);
  if ('error' in t) return { ok: false, errores: [t.error] };
  const tipo = t.tipo;
  const boleta = esBoleta(tipo);

  // Fechas
  const fechaEmision = fecha(doc.DocDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision)) errores.push(`DocDate inválida ("${doc.DocDate}")`);

  // Líneas
  if (lineasB1.length === 0) errores.push('El documento no tiene líneas');
  const max = boleta ? MAX_LINEAS_BOLETA : MAX_LINEAS_DTE;
  if (lineasB1.length > max) {
    errores.push(`El tipo ${tipo} admite como máximo ${max} líneas (el documento tiene ${lineasB1.length})`);
  }
  const hayAfecta = lineasB1.some((l) => !esExenta(l));
  const hayExenta = lineasB1.some(esExenta);
  if ((tipo === 33 || tipo === 39) && lineasB1.length > 0 && !hayAfecta) {
    errores.push(`El tipo ${tipo} requiere al menos un ítem afecto; para ventas exentas use ${tipo === 33 ? 34 : 41}`);
  }
  if ((tipo === 34 || tipo === 41) && hayAfecta) {
    errores.push(`El tipo ${tipo} solo admite ítems exentos (códigos de impuesto exentos: ${[...exentos].join(', ') || 'ninguno configurado'})`);
  }

  const detalle: CuerpoDocumento['detalle'] = [];
  for (const [i, l] of lineasB1.entries()) {
    const ref = `Línea ${(l.LineNum ?? i) + 1}`;
    const cantidad = Number(l.Quantity);
    if (!(cantidad > 0)) {
      errores.push(`${ref}: la cantidad debe ser mayor que 0`);
      continue;
    }
    const exenta = esExenta(l);
    let precio: number | null | undefined;
    if (boleta) {
      // Boletas: precios con IVA incluido.
      precio = l.PriceAfterVAT;
      if (precio === undefined || precio === null) {
        const neto = l.UnitPrice;
        precio = neto === undefined || neto === null ? neto : exenta ? neto : redondear(neto * (1 + (l.TaxPercentagePerRow ?? 0) / 100), 2);
      }
    } else {
      precio = l.UnitPrice;
    }
    if (precio === undefined || precio === null || !(precio >= 0)) {
      errores.push(`${ref}: sin precio unitario válido`);
      continue;
    }
    const texto = (l.ItemDescription ?? '').trim() || (l.ItemCode ?? '').trim();
    if (!texto) {
      errores.push(`${ref}: sin descripción ni código de artículo`);
      continue;
    }
    const d: CuerpoDocumento['detalle'][number] = {
      nombre: texto.slice(0, 80),
      cantidad,
      precioUnitario: precio,
    };
    const extra = texto.length > 80 ? texto : (l.FreeText ?? '').trim();
    if (extra) d.descripcion = extra.slice(0, 1000);
    const codigo = trunc(l.ItemCode, 35);
    if (codigo) d.codigoItem = codigo;
    const unidad = trunc(l.MeasureUnit ?? l.UoMCode, 4);
    if (unidad) d.unidad = unidad;
    const desc = l.DiscountPercent ?? 0;
    if (desc > 0) d.descuentoPorcentaje = Math.min(desc, 100);
    if (exenta || tipo === 34 || tipo === 41) d.exento = true;
    detalle.push(d);
  }

  // Receptor
  let receptor: CuerpoDocumento['receptor'];
  const socio = ctx.socio;
  const rutCrudo = (socio?.LicTradNum ?? '').trim();
  const rutNorm = normalizarRut(rutCrudo);
  if (!socio) {
    errores.push(`No se pudo leer el socio de negocios ${doc.CardCode}`);
  } else if (boleta && (!rutCrudo || rutNorm === RUT_GENERICO)) {
    receptor = undefined; // consumidor final: la API usa 66666666-6
  } else if (!rutCrudo) {
    errores.push(`El socio ${doc.CardCode} no tiene RUT (LicTradNum)`);
  } else if (!rutNorm) {
    errores.push(`RUT del receptor inválido (dígito verificador o formato): "${rutCrudo}"`);
  } else if (rutNorm === RUT_GENERICO && !boleta) {
    errores.push('El RUT genérico 66666666-6 solo es válido en boletas');
  } else {
    const razon = trunc(doc.CardName ?? socio.CardName, 100);
    if (!razon) errores.push(`El socio ${doc.CardCode} no tiene nombre (CardName)`);
    receptor = { rut: rutNorm, razonSocial: razon };
    const giroCrudo = socio[ctx.config.campoGiro];
    const giro = typeof giroCrudo === 'string' ? trunc(giroCrudo, 40) : '';
    if (giro) receptor.giro = giro;
    else if (!boleta) advertencias.push(`El socio ${doc.CardCode} no informa giro (${ctx.config.campoGiro})`);
    const dir = direccionDe(socio, doc);
    if (dir.direccion) receptor.direccion = dir.direccion;
    if (dir.comuna) receptor.comuna = dir.comuna;
    if (dir.ciudad) receptor.ciudad = dir.ciudad;
    const correo = trunc(socio.EmailAddress, 80);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) receptor.correo = correo;
    const tel = trunc(socio.Phone1, 20);
    if (tel) receptor.telefono = tel;
  }

  const idDoc: CuerpoDocumento['idDoc'] = { tipoDte: tipo, fechaEmision };

  // Forma de pago y vencimiento (no aplican a boletas ni a guías)
  if (!boleta && tipo !== 52) {
    const grupo = doc.PaymentGroupCode;
    idDoc.formaPago = grupo !== undefined && grupo !== null && ctx.config.gruposPagoContado.includes(grupo) ? 1 : 2;
    const venc = fecha(doc.DocDueDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(venc) && venc >= fechaEmision) idDoc.fechaVencimiento = venc;
  }

  // Guía de despacho
  if (tipo === 52) {
    const ind = Number((doc.U_SII_IndTraslado ?? '').trim());
    if (!Number.isInteger(ind) || ind < 1 || ind > 9) {
      errores.push('Guía de despacho: U_SII_IndTraslado es obligatorio (1 a 9)');
    } else {
      idDoc.indTraslado = ind;
    }
  }

  // Descuento de cabecera: afecto y exento por separado si el documento es mixto.
  const descGlobal = doc.DiscountPercent ?? 0;
  let descuentosRecargos: CuerpoDocumento['descuentosRecargos'];
  if (descGlobal > 0) {
    const valor = Math.min(descGlobal, 100);
    descuentosRecargos = [];
    if (hayAfecta && tipo !== 34 && tipo !== 41) {
      descuentosRecargos.push({ tipo: 'D', glosa: 'Descuento', tipoValor: '%', valor });
    }
    if (hayExenta || tipo === 34 || tipo === 41) {
      descuentosRecargos.push({ tipo: 'D', glosa: 'Descuento', tipoValor: '%', valor, exento: true });
    }
  }

  // Referencias (notas de crédito y débito)
  let referencias: CuerpoDocumento['referencias'];
  if (tipo === 61 || tipo === 56) {
    const r = referenciasDe(doc, ctx.bases, errores);
    referencias = r;
  }

  const origen: Record<string, unknown> = {
    sistema: 'SAP_B1',
    objType: entidad.objType,
    docEntry: doc.DocEntry,
    ...(doc.DocNum !== undefined ? { docNum: doc.DocNum } : {}),
  };
  const transporte = trunc(doc.U_SII_Transporte, 254);
  if (tipo === 52 && transporte) origen['transporte'] = transporte;

  if (errores.length > 0) return { ok: false, errores };

  const cuerpo: CuerpoDocumento = { idDoc, detalle, origen };
  if (receptor) cuerpo.receptor = receptor;
  if (descuentosRecargos?.length) cuerpo.descuentosRecargos = descuentosRecargos;
  if (referencias?.length) cuerpo.referencias = referencias;
  return { ok: true, cuerpo, tipoDte: tipo, advertencias };
}

function direccionDe(socio: SocioB1, doc: DocumentoB1): { direccion: string; comuna: string; ciudad: string } {
  const dirs = socio.BPAddresses ?? [];
  const facturacion = dirs.filter((d) => (d.AddressType ?? 'bo_BillTo') === 'bo_BillTo');
  const elegida =
    (doc.PayToCode ? facturacion.find((d) => d.AddressName === doc.PayToCode) : undefined) ?? facturacion[0] ?? dirs[0];
  if (elegida) {
    const calle = [elegida.Street, elegida.StreetNo].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
    return { direccion: calle.slice(0, 70), comuna: trunc(elegida.County, 20), ciudad: trunc(elegida.City, 20) };
  }
  return { direccion: trunc(doc.Address?.split(/\r?\n/)[0], 70), comuna: '', ciudad: '' };
}

function referenciasDe(
  doc: DocumentoB1,
  bases: ReadonlyMap<string, BaseInfo>,
  errores: string[],
): CuerpoDocumento['referencias'] {
  const crudo = (doc.U_SII_CodRef ?? '').trim();
  let codRef: 1 | 2 | 3 = 3;
  if (crudo) {
    if (crudo === '1' || crudo === '2' || crudo === '3') codRef = Number(crudo) as 1 | 2 | 3;
    else errores.push(`U_SII_CodRef "${crudo}" inválido (1 anula, 2 corrige texto, 3 corrige montos)`);
  }
  const razonRef = trunc(doc.U_SII_RazonRef, 90);
  const refs: NonNullable<CuerpoDocumento['referencias']> = [];
  const erroresAntes = errores.length;

  for (const b of basesDe(doc)) {
    const info = bases.get(claveBase(b.objType, b.docEntry));
    if (!info) {
      errores.push(`No se pudo leer el documento base (ObjType ${b.objType}, DocEntry ${b.docEntry})`);
      continue;
    }
    if (info.folio === null || info.folio === undefined) {
      errores.push(
        `El documento base (ObjType ${b.objType}, DocEntry ${b.docEntry}) no tiene folio (U_SII_Folio): debe emitirse antes de la nota`,
      );
      continue;
    }
    const tipoRef = info.tipoDte ?? TIPO_POR_OBJTYPE[b.objType];
    if (tipoRef === undefined) {
      errores.push(`El documento base de ObjType ${b.objType} no tiene un tipo DTE conocido`);
      continue;
    }
    refs.push({
      tipoDocRef: String(tipoRef),
      folioRef: info.folio,
      fechaRef: fecha(info.docDate),
      codRef,
      ...(razonRef ? { razonRef } : {}),
    });
  }

  if (refs.length === 0 && errores.length === erroresAntes) {
    // Sin líneas copiadas desde otro documento: referencia manual por UDFs.
    const tipoDocRef = trunc(doc.U_SII_TipoDocRef, 3);
    const folioRef = trunc(doc.U_SII_FolioRef, 18);
    if (tipoDocRef && folioRef) {
      refs.push({ tipoDocRef, folioRef, codRef, ...(razonRef ? { razonRef } : {}) });
    } else {
      errores.push(
        'La nota debe referenciar el documento que modifica: cree la nota copiando desde el documento base o complete U_SII_TipoDocRef y U_SII_FolioRef',
      );
    }
  }
  return refs;
}
