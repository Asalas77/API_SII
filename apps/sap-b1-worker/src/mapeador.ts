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
  traslado?: CuerpoTraslado;
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

/** Bloque `traslado` de la API (Res. Ex. SII 144/2026; ver `TrasladoDto`). */
export interface CuerpoTraslado {
  categoria: 'autogestionado' | 'tercerizado' | 'regimen_especial';
  origen?: { direccion: string; comuna: string };
  destino?: { direccion: string; comuna: string; ciudad?: string };
  fechaSalida?: string;
  horaSalida?: string;
  fechaLlegada?: string;
  transportista?: { rut: string };
  chofer?: { rut?: string; nombre?: string };
  patente?: string;
  patenteCarro?: string;
  diferido?: CampoTraslado[];
  sinDato?: CampoTraslado[];
  descripcionProlongado?: string;
  motivoSinPrecio?: string;
}

export type CampoTraslado = 'transportista' | 'choferRut' | 'choferNombre' | 'patente' | 'patenteCarro' | 'fechaSalida';

export const DESCRIPCION_IND_TRASLADO: Readonly<Record<number, string>> = {
  1: 'Operación constituye venta',
  2: 'Ventas por efectuar',
  3: 'Consignaciones',
  4: 'Entrega gratuita',
  5: 'Traslados internos',
  6: 'Otros traslados no venta',
  7: 'Devolución de mercaderías',
  8: 'Traslado para exportación (no venta)',
  9: 'Venta de exportación',
  10: 'Traslado tercerizado',
  11: 'Traslado prolongado, importa venta',
  12: 'Traslado prolongado, no venta',
};

const CATEGORIAS: Record<string, CuerpoTraslado['categoria']> = {
  AUTOGESTIONADO: 'autogestionado',
  TERCERIZADO: 'tercerizado',
  REGIMEN_ESPECIAL: 'regimen_especial',
};

/** Tipos de traslado cuyo precio puede omitirse (no venta). */
const IND_SIN_PRECIO = [4, 5, 6, 7, 8, 12];

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
  let traslado: CuerpoTraslado | undefined;

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
    if (!Number.isInteger(ind) || ind < 1 || ind > 12) {
      errores.push('Guía de despacho: U_SII_IndTraslado es obligatorio (1 a 12)');
    } else if (ind === 10) {
      errores.push(
        'U_SII_IndTraslado 10 (guía de despacho tercerizada, GDT) no se emite desde B1: exige referenciar el documento original y el XSD oficial del SII aún no la enumera',
      );
    } else {
      idDoc.indTraslado = ind;
      const t = mapearTraslado(doc, ind, detalle.some((d) => !(d.precioUnitario > 0)), errores, advertencias);
      if (t) traslado = t;
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
  // OBSOLETO: U_SII_Transporte (texto libre) se conserva solo como metadato; los datos viajan en `traslado`.
  const transporte = trunc(doc.U_SII_Transporte, 254);
  if (tipo === 52 && transporte) origen['transporte'] = transporte;

  if (errores.length > 0) return { ok: false, errores };

  const cuerpo: CuerpoDocumento = { idDoc, detalle, origen };
  if (traslado) cuerpo.traslado = traslado;
  if (receptor) cuerpo.receptor = receptor;
  if (descuentosRecargos?.length) cuerpo.descuentosRecargos = descuentosRecargos;
  if (referencias?.length) cuerpo.referencias = referencias;
  return { ok: true, cuerpo, tipoDte: tipo, advertencias };
}

/** Valor de un UDF de texto: vacío, "DIFERIDO" o "SIN DATO" (cualquier caso) o el dato. */
function valorUdf(v: string | null | undefined): { dato?: string; marca?: 'diferido' | 'sinDato' } {
  const t = (v ?? '').trim();
  if (!t) return {};
  if (/^diferido$/i.test(t)) return { marca: 'diferido' };
  if (/^sin\s*dato$/i.test(t)) return { marca: 'sinDato' };
  return { dato: t };
}

/**
 * Arma el bloque `traslado` de la guía desde los UDF estructurados de `ODLN` (Res. Ex. SII 144/2026). Sin
 * `U_SII_CatTraslado` no hay bloque (la guía se emite como antes, con advertencia). En `TERCERIZADO` los campos
 * de transporte vacíos se informan como diferidos; "DIFERIDO"/"SIN DATO" escritos en el UDF los fuerzan.
 * El destino sale de la dirección de entrega del documento. La API repite las validaciones de fondo.
 */
function mapearTraslado(
  doc: DocumentoB1,
  ind: number,
  hayLineaSinPrecio: boolean,
  errores: string[],
  advertencias: string[],
): CuerpoTraslado | undefined {
  const crudo = (doc.U_SII_CatTraslado ?? '').trim().toUpperCase();
  if (!crudo) {
    advertencias.push(
      'Guía sin U_SII_CatTraslado: se emite sin datos de traslado (Res. Ex. SII 144/2026 los exige desde el 2026-11-01)' +
        ((doc.U_SII_Transporte ?? '').trim() ? '; U_SII_Transporte está obsoleto y no reemplaza a los UDF estructurados' : ''),
    );
    return undefined;
  }
  const categoria = CATEGORIAS[crudo];
  if (!categoria) {
    errores.push(`U_SII_CatTraslado "${crudo}" inválido (${Object.keys(CATEGORIAS).join(', ')})`);
    return undefined;
  }
  const erroresAntes = errores.length;
  const t: CuerpoTraslado = { categoria };
  const diferido: CampoTraslado[] = [];
  const sinDato: CampoTraslado[] = [];
  const aplicar = (campo: CampoTraslado, v: { dato?: string; marca?: 'diferido' | 'sinDato' }, udf: string): string | undefined => {
    if (v.marca === 'diferido') diferido.push(campo);
    else if (v.marca === 'sinDato') sinDato.push(campo);
    else if (v.dato === undefined) {
      if (categoria === 'tercerizado') diferido.push(campo);
      else if (categoria === 'autogestionado' && campo !== 'patenteCarro') errores.push(`${udf} es obligatorio en el transporte autogestionado`);
    }
    return v.dato;
  };
  const rutUdf = (v: string | undefined, udf: string): string | undefined => {
    if (v === undefined) return undefined;
    const n = normalizarRut(v);
    if (!n) errores.push(`${udf} inválido (dígito verificador o formato): "${v}"`);
    return n ?? undefined;
  };

  // Origen (opcional: por defecto la API usa la dirección de la empresa).
  const dirOrigen = trunc(doc.U_SII_DirOrigen, 70);
  const cmnaOrigen = trunc(doc.U_SII_CmnaOrigen, 20);
  if (dirOrigen || cmnaOrigen) {
    if (dirOrigen && cmnaOrigen) t.origen = { direccion: dirOrigen, comuna: cmnaOrigen };
    else errores.push('U_SII_DirOrigen y U_SII_CmnaOrigen se informan juntos');
  }

  // Destino: dirección de entrega del documento.
  const ext = doc.AddressExtension ?? undefined;
  const calle = [ext?.ShipToStreet, ext?.ShipToStreetNo].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  const direccion = (calle || trunc(doc.Address2?.split(/\r?\n/)[0], 70)).slice(0, 70);
  const comuna = trunc(ext?.ShipToCounty, 20);
  const ciudad = trunc(ext?.ShipToCity, 20);
  if (direccion && comuna) t.destino = { direccion, comuna, ...(ciudad ? { ciudad } : {}) };
  else if (categoria !== 'regimen_especial') {
    errores.push('La guía no tiene dirección de entrega completa (calle y comuna: AddressExtension.ShipToStreet y ShipToCounty) para el destino del traslado');
  }

  const rutTrans = rutUdf(aplicar('transportista', valorUdf(doc.U_SII_RutTrans), 'U_SII_RutTrans'), 'U_SII_RutTrans');
  if (rutTrans) t.transportista = { rut: rutTrans };
  const rutChofer = rutUdf(aplicar('choferRut', valorUdf(doc.U_SII_RutChofer), 'U_SII_RutChofer'), 'U_SII_RutChofer');
  const nombre = aplicar('choferNombre', valorUdf(doc.U_SII_NomChofer), 'U_SII_NomChofer');
  if (nombre && nombre.length > 30) errores.push(`U_SII_NomChofer admite hasta 30 caracteres (tiene ${nombre.length})`);
  if (rutChofer || nombre) t.chofer = { ...(rutChofer ? { rut: rutChofer } : {}), ...(nombre ? { nombre } : {}) };
  const patente = aplicar('patente', valorUdf(doc.U_SII_Patente), 'U_SII_Patente');
  if (patente) t.patente = patente;
  const carro = aplicar('patenteCarro', valorUdf(doc.U_SII_PatenteCarro), 'U_SII_PatenteCarro');
  if (carro) t.patenteCarro = carro;

  const fchSalida = fecha(doc.U_SII_FchSalida);
  if (fchSalida) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fchSalida)) t.fechaSalida = fchSalida;
    else errores.push(`U_SII_FchSalida inválida ("${doc.U_SII_FchSalida}")`);
  } else if (categoria === 'tercerizado') diferido.push('fechaSalida');
  else if (categoria === 'autogestionado') errores.push('U_SII_FchSalida es obligatorio en el transporte autogestionado');
  const hora = trunc(doc.U_SII_HraSalida, 8);
  if (hora) {
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) t.horaSalida = hora;
    else errores.push(`U_SII_HraSalida inválida ("${hora}"), se espera HH:MM o HH:MM:SS`);
  }
  const fchLlegada = fecha(doc.U_SII_FchLlegada);
  if (fchLlegada) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fchLlegada)) t.fechaLlegada = fchLlegada;
    else errores.push(`U_SII_FchLlegada inválida ("${doc.U_SII_FchLlegada}")`);
  }

  // Traslado prolongado: fecha de llegada y descripción (se toma de Comments).
  if (ind === 11 || ind === 12) {
    if (!t.fechaLlegada) errores.push('El traslado prolongado (11/12) requiere U_SII_FchLlegada (fecha estimada de llegada)');
    const desc = trunc(doc.Comments, 400);
    if (!desc) errores.push('El traslado prolongado (11/12) requiere describir el motivo en Comments (distancia, carga especial, etc.)');
    else t.descripcionProlongado = desc;
  }
  // Traslado no venta sin precio: motivo (Comments o, a falta, la descripción del tipo de traslado).
  if (IND_SIN_PRECIO.includes(ind) && hayLineaSinPrecio) {
    t.motivoSinPrecio = trunc(doc.Comments, 200) || DESCRIPCION_IND_TRASLADO[ind];
  }

  if (diferido.length > 0) t.diferido = diferido;
  if (sinDato.length > 0) t.sinDato = sinDato;
  return errores.length > erroresAntes ? undefined : t;
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
