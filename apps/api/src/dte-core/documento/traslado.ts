import { calcularDv, formatearRut, separarRut } from '../xml/xml.util.js';
import { ErrorValidacionDte } from './errores.js';
import type { DocumentoDte } from './tipos.js';

/**
 * Datos de traslado exigidos por la Res. Ex. SII 144/2026 (vigente desde el 2026-11-01) a la guía de
 * despacho (52) y a la factura (33/34) que amparan el traslado de bienes corporales muebles.
 * Dominio puro: validación y normalización; el XML lo arma `construir-dte.ts`.
 */

/** `IndTraslado` del Anexo de la Res. 144: 1 a 9 están en el XSD de 2026-02-19; 10 a 12 no. */
export type IndTraslado = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

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

/** Valores de `IndTraslado` que el XSD oficial vigente (DTE_v10.xsd, 2026-02-19) todavía no enumera. */
export const IND_TRASLADO_PENDIENTE_XSD: readonly number[] = [10, 11, 12];
/** Guía de despacho tercerizada (GDT, resolutivo 5°). */
export const IND_TRASLADO_GDT = 10;
/** Traslado prolongado (resolutivo 7° N°2): 11 importa venta, 12 no venta. */
export const IND_TRASLADO_PROLONGADO: readonly number[] = [11, 12];
/** Traslados que son venta: el precio unitario es obligatorio (resolutivo 1° N°4). */
export const IND_TRASLADO_CON_PRECIO: readonly number[] = [1, 2, 3, 9, 11];
/** Traslados no venta: el precio puede omitirse indicando el motivo (Circular 103/1979, cap. V N°2 letra h). */
export const IND_TRASLADO_SIN_PRECIO: readonly number[] = [4, 5, 6, 7, 8, 12];

export type CategoriaTraslado = 'autogestionado' | 'tercerizado' | 'regimen_especial';
export const CATEGORIAS_TRASLADO: readonly CategoriaTraslado[] = ['autogestionado', 'tercerizado', 'regimen_especial'];

/** Campos de transporte que pueden informarse como "Diferido" o "Sin Dato" (resolutivo 4°). */
export type CampoTraslado =
  | 'transportista'
  | 'choferRut'
  | 'choferNombre'
  | 'patente'
  | 'patenteCarro'
  | 'fechaSalida';
export const CAMPOS_TRASLADO: readonly CampoTraslado[] = [
  'transportista',
  'choferRut',
  'choferNombre',
  'patente',
  'patenteCarro',
  'fechaSalida',
];
/** Campos que una guía autogestionada debe traer completos (`patenteCarro` solo si corresponde). */
const CAMPOS_OBLIGATORIOS: readonly CampoTraslado[] = ['transportista', 'choferRut', 'choferNombre', 'patente', 'fechaSalida'];

export const LITERAL_DIFERIDO = 'Diferido';
export const LITERAL_SIN_DATO = 'Sin Dato';

const ETIQUETA_CAMPO: Readonly<Record<CampoTraslado, string>> = {
  transportista: 'RUT transportista',
  choferRut: 'RUT chofer',
  choferNombre: 'Nombre chofer',
  patente: 'Patente',
  patenteCarro: 'Patente carro',
  fechaSalida: 'Fecha salida',
};

export interface DireccionTraslado {
  direccion: string;
  comuna: string;
}

export interface TrasladoDte {
  /** Obligatoria salvo `retiroComprador`. */
  categoria?: CategoriaTraslado;
  /**
   * El comprador retira los bienes en el establecimiento del vendedor (resolutivo 15°): solo factura
   * (33/34), y NO admite datos de transporte.
   */
  retiroComprador?: boolean;
  /** Origen efectivo; por defecto la dirección del emisor (`Emisor/DirOrigen`, `CmnaOrigen`). */
  origen?: DireccionTraslado;
  destino?: DireccionTraslado & { ciudad?: string };
  /** `yyyy-mm-dd`: fecha efectiva de inicio del traslado. */
  fechaSalida?: string;
  /** `HH:MM` o `HH:MM:SS`; opcional (resolutivo 7° N°4). */
  horaSalida?: string;
  /** `yyyy-mm-dd`; obligatoria en traslados prolongados (11/12). */
  fechaLlegada?: string;
  /** RUT de la empresa de transporte (`RUTTrans`). */
  transportista?: { rut: string };
  chofer?: { rut?: string; nombre?: string };
  patente?: string;
  /** Carro, remolque o semirremolque (si corresponde). */
  patenteCarro?: string;
  /** Campos que se informan como "Diferido" (se completarán después). */
  diferido?: CampoTraslado[];
  /** Campos que se informan como "Sin Dato". */
  sinDato?: CampoTraslado[];
  /** Obligatoria en 11/12: por qué el traslado dura más de un día (distancia, carga especial...). */
  descripcionProlongado?: string;
  /** Traslados no venta sin precio unitario: motivo (Circular 103/1979). */
  motivoSinPrecio?: string;
}

export type EstadoCampoTraslado = 'dato' | 'diferido' | 'sinDato' | 'omitido';

/** Traslado validado y normalizado (patentes en mayúscula sin separadores, RUT sin puntos, hora `HH:MM:SS`). */
export interface TrasladoNormalizado {
  categoria?: CategoriaTraslado;
  retiroComprador: boolean;
  indTraslado?: number;
  origen?: DireccionTraslado;
  destino?: DireccionTraslado & { ciudad?: string };
  fechaSalida?: string;
  horaSalida?: string;
  fechaLlegada?: string;
  transportistaRut?: string;
  choferRut?: string;
  choferNombre?: string;
  patente?: string;
  patenteCarro?: string;
  estados: Record<CampoTraslado, EstadoCampoTraslado>;
  /** true si algún campo quedó como "Diferido" o "Sin Dato": falta complementar con una guía posterior, GDT o ATT. */
  pendiente: boolean;
  descripcionProlongado?: string;
  motivoSinPrecio?: string;
  /** Texto que se agrega al `DscItem` de la primera línea (valores diferidos, traslado prolongado, motivo sin precio). */
  nota?: string;
}

export interface OpcionesTraslado {
  /** Acepta `IndTraslado` 10-12 (el XSD oficial aún no los enumera). Por defecto `false`. */
  permitirIndTrasladoRes144?: boolean;
  /**
   * Exige el bloque `traslado` en toda guía de despacho (52): la Res. 144/2026, vigente desde el 2026-11-01, obliga a
   * informar los datos de transporte. Por defecto `false` (el núcleo no impone política; la fija `EXIGIR_TRASLADO_GUIAS`).
   */
  exigirTrasladoGuias?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------------------------

/**
 * Patente chilena normalizada (mayúsculas, sin espacios, puntos ni guiones). Patrones admitidos (SUPUESTO: el
 * formato técnico del SII solo exige texto de hasta 8 caracteres): `AB1234` (antiguo), `BCDF12` (vigente desde 2007),
 * `ABC12`/`ABC123` (motos, remolques) y `AB123`.
 */
export const PATRON_PATENTE = /^(?:[A-Z]{2}\d{4}|[A-Z]{4}\d{2}|[A-Z]{3}\d{2,3}|[A-Z]{2}\d{3})$/;

export function normalizarPatente(valor: string): string {
  return valor.replace(/[\s.-]/g, '').toUpperCase();
}

/** Tipos de documento tributario (códigos SII) que pueden referenciarse con `RUTOtr`. */
export const TIPOS_DOC_TRIBUTARIOS: readonly string[] = [
  '29', '30', '32', '33', '34', '35', '38', '39', '40', '41', '43', '45', '46', '48', '50', '52', '55', '56', '60', '61',
  '101', '102', '103', '104', '105', '106', '108', '109', '110', '111', '112',
];

function error(mensaje: string, campo: string): never {
  throw new ErrorValidacionDte(`${campo}: ${mensaje}`, campo);
}

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function fecha(valor: string, campo: string): string {
  const m = PATRON_FECHA.exec(valor);
  const d = m ? new Date(`${valor}T00:00:00Z`) : undefined;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) {
    error(`fecha inválida (${valor}), se espera yyyy-mm-dd`, campo);
  }
  if (valor < '2003-04-01' || valor > '2050-12-31') error(`fecha fuera de rango (${valor}); el SII admite 2003-04-01 a 2050-12-31`, campo);
  return valor;
}

function hora(valor: string, campo: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(valor);
  if (!m) error(`hora inválida (${valor}), se espera HH:MM o HH:MM:SS`, campo);
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

/** RUT con DV correcto; para chofer/transportista el cuerpo va entre 100.000 y 99 millones (formato DTE v2.5). */
function rut(valor: string, campo: string, rangoFormato: boolean): string {
  const r = separarRut(valor);
  if (!r || calcularDv(r.numero) !== r.dv) error(`RUT inválido (${valor}); formato 12345678-5 con dígito verificador correcto`, campo);
  const cuerpo = Number(r.numero);
  if (rangoFormato && (cuerpo < 100_000 || cuerpo > 99_999_999)) {
    error(`el cuerpo del RUT debe estar entre 100.000 y 99 millones (${valor})`, campo);
  }
  return formatearRut(r.numero, r.dv);
}

function texto(valor: string | undefined): string | undefined {
  const t = valor?.trim();
  return t ? t : undefined;
}

function direccion(d: DireccionTraslado | undefined, campo: string, obligatoria: boolean): DireccionTraslado | undefined {
  const dir = texto(d?.direccion);
  const comuna = texto(d?.comuna);
  if (!dir && !comuna) {
    if (obligatoria) error('es obligatorio (dirección y comuna)', campo);
    return undefined;
  }
  if (!dir) error('falta la dirección', `${campo}.direccion`);
  if (!comuna && obligatoria) error('falta la comuna', `${campo}.comuna`);
  if (dir.length > 70) error(`la dirección admite hasta 70 caracteres (${dir.length})`, `${campo}.direccion`);
  if (comuna && comuna.length > 20) error(`la comuna admite hasta 20 caracteres (${comuna.length})`, `${campo}.comuna`);
  return { direccion: dir, comuna: comuna ?? '' };
}

// ---------------------------------------------------------------------------------------------
// Validación y normalización
// ---------------------------------------------------------------------------------------------

/** Verifica que `IndTraslado` sea un valor admitido y que 10-12 estén habilitados (aún no están en el XSD oficial). */
export function validarIndTraslado(doc: DocumentoDte, opciones: OpcionesTraslado = {}): void {
  const ind = doc.idDoc.indTraslado;
  if (ind === undefined) return;
  if (!Number.isInteger(ind) || ind < 1 || ind > 12) error(`valor inválido (${String(ind)}); admitidos 1 a 12`, 'idDoc.indTraslado');
  if (IND_TRASLADO_PENDIENTE_XSD.includes(ind) && !opciones.permitirIndTrasladoRes144) {
    error(
      `IndTraslado ${ind} (${DESCRIPCION_IND_TRASLADO[ind]}) es de la Res. Ex. SII 144/2026 y todavía no figura en el XSD oficial ` +
        'del SII (DTE_v10.xsd de 2026-02-19 solo admite 1 a 9; tampoco hay manual publicado del ATT). Está deshabilitado: ' +
        'use un valor de 1 a 9 o habilítelo con PERMITIR_INDTRASLADO_RES144=true cuando el SII publique el XSD',
      'idDoc.indTraslado',
    );
  }
}

function esReferenciaTributaria(tipo: string): boolean {
  return TIPOS_DOC_TRIBUTARIOS.includes(tipo.trim());
}

/**
 * Valida (reglas de la Res. 144 por categoría y `IndTraslado`) y normaliza `doc.traslado`.
 * Devuelve `undefined` si el documento no trae el bloque `traslado`.
 *
 * @throws ErrorValidacionDte con el campo exacto en el mensaje (`traslado.chofer.rut: ...`).
 */
export function normalizarTraslado(doc: DocumentoDte, opciones: OpcionesTraslado = {}): TrasladoNormalizado | undefined {
  validarIndTraslado(doc, opciones);
  const t = doc.traslado;
  const tipo = doc.idDoc.tipoDte;
  const ind = doc.idDoc.indTraslado;
  const esGdt = ind === IND_TRASLADO_GDT;
  if (!t) {
    if (ind !== undefined && IND_TRASLADO_PENDIENTE_XSD.includes(ind)) {
      error(`IndTraslado ${ind} exige el bloque traslado (Res. 144 resolutivos 5° y 7°)`, 'traslado');
    }
    if (tipo === 52 && opciones.exigirTrasladoGuias) {
      error(
        'la guía de despacho debe informar los datos de transporte en el bloque traslado (Res. Ex. SII 144/2026, vigente desde el 1-nov-2026): ' +
          'falta categoria (autogestionado, tercerizado o regimen_especial) y, según ella, transportista, chofer, patente, fecha de salida y destino',
        'traslado',
      );
    }
    return undefined;
  }
  if (tipo === 39 || tipo === 41) error('no aplica a boletas (Res. 144 resolutivo 14°)', 'traslado');
  if (tipo !== 33 && tipo !== 34 && tipo !== 52) error(`solo aplica a facturas (33/34) y guías de despacho (52), no al tipo ${tipo}`, 'traslado');

  const marcadores = (lista: CampoTraslado[] | undefined, campo: string): Set<CampoTraslado> => {
    const s = new Set<CampoTraslado>();
    for (const c of lista ?? []) {
      if (!CAMPOS_TRASLADO.includes(c)) error(`campo desconocido (${String(c)}); admitidos: ${CAMPOS_TRASLADO.join(', ')}`, campo);
      s.add(c);
    }
    return s;
  };
  const dif = marcadores(t.diferido, 'traslado.diferido');
  const sin = marcadores(t.sinDato, 'traslado.sinDato');
  for (const c of dif) if (sin.has(c)) error(`${c} no puede ser a la vez Diferido y Sin Dato`, 'traslado.sinDato');

  // Retiro por el comprador (resolutivo 15°): la factura basta, sin datos de transporte.
  if (t.retiroComprador === true) {
    if (tipo === 52) {
      error('la guía no admite retiroComprador: si el comprador emite su propia guía debe cumplir el resolutivo 1° (use categoria)', 'traslado.retiroComprador');
    }
    const otros = (
      ['destino', 'fechaSalida', 'horaSalida', 'fechaLlegada', 'transportista', 'chofer', 'patente', 'patenteCarro'] as const
    ).find((k) => t[k] !== undefined);
    if (otros || dif.size > 0 || sin.size > 0) {
      error(`con retiroComprador no se informan datos de transporte (Res. 144 resolutivo 15°)${otros ? `; quite ${otros}` : ''}`, `traslado.${otros ?? 'diferido'}`);
    }
    const estados = Object.fromEntries(CAMPOS_TRASLADO.map((c) => [c, 'omitido'])) as Record<CampoTraslado, EstadoCampoTraslado>;
    return { retiroComprador: true, estados, pendiente: false };
  }

  if (!t.categoria) error(`es obligatoria (${CATEGORIAS_TRASLADO.join(' | ')})`, 'traslado.categoria');
  if (!CATEGORIAS_TRASLADO.includes(t.categoria)) error(`valor inválido (${String(t.categoria)}); admitidas: ${CATEGORIAS_TRASLADO.join(', ')}`, 'traslado.categoria');
  const categoria = t.categoria;

  if (tipo === 52 && ind === undefined) {
    error('es obligatorio al informar traslado: el tipo de traslado debe indicarse en forma clara (Res. 144 resolutivo 3°)', 'idDoc.indTraslado');
  }
  if (esGdt && categoria !== 'tercerizado') {
    error('la guía de despacho tercerizada (IndTraslado 10) debe ser categoria tercerizado', 'traslado.categoria');
  }

  // --- valores presentes ---
  const origen = direccion(t.origen ?? { direccion: doc.emisor.direccion, comuna: doc.emisor.comuna }, 'traslado.origen', true);
  const dest = direccion(t.destino, 'traslado.destino', categoria !== 'regimen_especial');
  const ciudadDest = texto(t.destino?.ciudad);
  if (ciudadDest && ciudadDest.length > 20) error(`la ciudad admite hasta 20 caracteres (${ciudadDest.length})`, 'traslado.destino.ciudad');

  const fechaSalida = texto(t.fechaSalida) ? fecha(t.fechaSalida!.trim(), 'traslado.fechaSalida') : undefined;
  const horaSalida = texto(t.horaSalida) ? hora(t.horaSalida!.trim(), 'traslado.horaSalida') : undefined;
  const fechaLlegada = texto(t.fechaLlegada) ? fecha(t.fechaLlegada!.trim(), 'traslado.fechaLlegada') : undefined;
  const rutTrans = texto(t.transportista?.rut) ? rut(t.transportista!.rut.trim(), 'traslado.transportista.rut', true) : undefined;
  const rutChofer = texto(t.chofer?.rut) ? rut(t.chofer!.rut!.trim(), 'traslado.chofer.rut', true) : undefined;
  const nombreChofer = texto(t.chofer?.nombre);
  if (nombreChofer && nombreChofer.length > 30) {
    error(`el nombre admite hasta 30 caracteres (${nombreChofer.length}); el formato DTE no admite más (abrevie el segundo apellido)`, 'traslado.chofer.nombre');
  }
  const patente = texto(t.patente);
  const patenteCarro = texto(t.patenteCarro);
  const patenteN = patente ? normalizarPatente(patente) : undefined;
  const carroN = patenteCarro ? normalizarPatente(patenteCarro) : undefined;
  if (patenteN && !PATRON_PATENTE.test(patenteN)) error(`patente inválida (${patente}); formatos AB1234, BCDF12, ABC12, ABC123, AB123`, 'traslado.patente');
  if (carroN && !PATRON_PATENTE.test(carroN)) error(`patente de carro inválida (${patenteCarro}); formatos AB1234, BCDF12, ABC12, ABC123, AB123`, 'traslado.patenteCarro');

  const presente: Record<CampoTraslado, boolean> = {
    transportista: rutTrans !== undefined,
    choferRut: rutChofer !== undefined,
    choferNombre: nombreChofer !== undefined,
    patente: patenteN !== undefined,
    patenteCarro: carroN !== undefined,
    fechaSalida: fechaSalida !== undefined,
  };
  const nombreCampo: Record<CampoTraslado, string> = {
    transportista: 'traslado.transportista.rut',
    choferRut: 'traslado.chofer.rut',
    choferNombre: 'traslado.chofer.nombre',
    patente: 'traslado.patente',
    patenteCarro: 'traslado.patenteCarro',
    fechaSalida: 'traslado.fechaSalida',
  };
  const estados = {} as Record<CampoTraslado, EstadoCampoTraslado>;
  for (const c of CAMPOS_TRASLADO) {
    const marca = dif.has(c) ? 'diferido' : sin.has(c) ? 'sinDato' : undefined;
    if (marca && presente[c]) {
      error(`se informó un valor y también se marcó como ${marca === 'diferido' ? 'Diferido' : 'Sin Dato'}; deje solo uno`, nombreCampo[c]);
    }
    estados[c] = marca ?? (presente[c] ? 'dato' : 'omitido');
  }
  if (horaSalida && !fechaSalida) error('la hora de salida requiere fecha de salida', 'traslado.horaSalida');

  // El nombre sin RUT no cabe en el XSD (`Chofer` exige `RUTChofer`).
  if (estados.choferRut === 'omitido' && estados.choferNombre === 'dato') {
    error('informe también el RUT del chofer (o márquelo diferido/sinDato): el formato DTE exige RUT para el nombre', 'traslado.chofer.rut');
  }
  if (estados.choferRut === 'dato' && estados.choferNombre === 'omitido') {
    error('informe el nombre del chofer (o márquelo diferido/sinDato): debe indicarse junto al RUT', 'traslado.chofer.nombre');
  }

  // --- reglas por categoría ---
  const hayMarcas = dif.size > 0 || sin.size > 0;
  if (categoria === 'autogestionado') {
    if (hayMarcas) {
      const c = [...dif, ...sin][0]!;
      error('la categoría autogestionado exige todos los datos; para datos que se desconocen use categoria tercerizado', nombreCampo[c]);
    }
    for (const c of CAMPOS_OBLIGATORIOS) {
      if (estados[c] !== 'dato') error('es obligatorio en el transporte autogestionado (Res. 144 resolutivo 1°)', nombreCampo[c]);
    }
  } else if (categoria === 'tercerizado') {
    for (const c of CAMPOS_OBLIGATORIOS) {
      if (estados[c] === 'omitido') {
        error('en el transporte tercerizado debe informarse el dato o marcarse como diferido/sinDato (Res. 144 resolutivo 4°)', nombreCampo[c]);
      }
    }
  } else if (!origen?.direccion) {
    // Régimen especial (resolutivo 11°): como mínimo fecha de emisión, tipo de traslado, dirección de origen y descripción.
    error('el régimen especial exige al menos la dirección de origen', 'traslado.origen');
  }

  // --- reglas por IndTraslado ---
  if (ind !== undefined && IND_TRASLADO_PROLONGADO.includes(ind)) {
    if (!fechaLlegada) error('la fecha estimada de llegada es obligatoria en el traslado prolongado (Res. 144 resolutivo 7° N°2)', 'traslado.fechaLlegada');
    if (!texto(t.descripcionProlongado)) {
      error('describa en el detalle por qué el traslado es prolongado (distancia, carga especial u otro factor)', 'traslado.descripcionProlongado');
    }
  }
  const desde = fechaSalida ?? doc.idDoc.fechaEmision;
  if (fechaLlegada && fechaLlegada < desde) error(`no puede ser anterior a la fecha de ${fechaSalida ? 'salida' : 'emisión'} (${desde})`, 'traslado.fechaLlegada');

  if (esGdt) {
    const refs = doc.referencias ?? [];
    if (!refs.some((r) => esReferenciaTributaria(r.tipoDocRef))) {
      error(
        'la GDT debe referenciar el documento original (tipo, folio, fecha y, si es de otro contribuyente, rutOtroContribuyente)',
        'referencias',
      );
    }
  }

  // --- precios (solo guías) ---
  let motivoSinPrecio = texto(t.motivoSinPrecio);
  if (motivoSinPrecio && motivoSinPrecio.length > 200) error('el motivo admite hasta 200 caracteres', 'traslado.motivoSinPrecio');
  if (tipo === 52 && ind !== undefined && !esGdt) {
    if (IND_TRASLADO_CON_PRECIO.includes(ind)) {
      doc.detalle.forEach((l, i) => {
        if (!(l.precioUnitario > 0)) {
          error(`el traslado "${DESCRIPCION_IND_TRASLADO[ind]}" es venta: informe el precio unitario (Res. 144 resolutivo 1° N°4)`, `detalle[${i}].precioUnitario`);
        }
      });
      motivoSinPrecio = undefined;
    } else if (doc.detalle.some((l) => !(l.precioUnitario > 0)) && !motivoSinPrecio) {
      error('el traslado no es venta y no informa precio unitario: indique el motivo (p. ej. reparación, traslado entre bodegas)', 'traslado.motivoSinPrecio');
    }
  } else {
    motivoSinPrecio = undefined;
  }

  const pendiente = hayMarcas;
  const norm: TrasladoNormalizado = {
    categoria,
    retiroComprador: false,
    ...(ind !== undefined ? { indTraslado: ind } : {}),
    ...(origen ? { origen } : {}),
    ...(dest ? { destino: { ...dest, ...(ciudadDest ? { ciudad: ciudadDest } : {}) } } : {}),
    ...(fechaSalida ? { fechaSalida } : {}),
    ...(horaSalida ? { horaSalida } : {}),
    ...(fechaLlegada ? { fechaLlegada } : {}),
    ...(rutTrans ? { transportistaRut: rutTrans } : {}),
    ...(rutChofer ? { choferRut: rutChofer } : {}),
    ...(nombreChofer ? { choferNombre: nombreChofer } : {}),
    ...(patenteN ? { patente: patenteN } : {}),
    ...(carroN ? { patenteCarro: carroN } : {}),
    estados,
    pendiente,
    ...(texto(t.descripcionProlongado) ? { descripcionProlongado: texto(t.descripcionProlongado)! } : {}),
    ...(motivoSinPrecio ? { motivoSinPrecio } : {}),
  };
  const nota = notaTraslado(norm);
  return nota ? { ...norm, nota } : norm;
}

// ---------------------------------------------------------------------------------------------
// Nota en el detalle (el formato de DTE no tiene campo para estos textos)
// ---------------------------------------------------------------------------------------------

const PREFIJO_PENDIENTE = 'Datos de traslado pendientes (Res. Ex. SII 144/2026): ';
const PREFIJO_PROLONGADO = 'Traslado prolongado: ';
const PREFIJO_SIN_PRECIO = 'Sin precio unitario: ';

function textoEstado(e: EstadoCampoTraslado): string {
  return e === 'diferido' ? 'DIFERIDO' : 'SIN DATO';
}

/**
 * Texto que se agrega al `DscItem` de la primera línea, porque el formato DTE no tiene campo para: los datos
 * diferidos que no caben en su tipo (RUT, fecha), la descripción del traslado prolongado y el motivo de la
 * ausencia de precio. Formato estable: `extraerMarcadoresNota` lo vuelve a leer para el PDF.
 */
export function notaTraslado(n: TrasladoNormalizado): string | undefined {
  const partes: string[] = [];
  const marcados = CAMPOS_TRASLADO.filter((c) => n.estados[c] === 'diferido' || n.estados[c] === 'sinDato');
  if (marcados.length > 0) {
    let s = PREFIJO_PENDIENTE + marcados.map((c) => `${ETIQUETA_CAMPO[c]}: ${textoEstado(n.estados[c])}`).join('; ') + '.';
    if (n.estados.choferRut !== 'dato' && n.choferNombre) s += ` Chofer: ${n.choferNombre}.`;
    partes.push(s);
  }
  if (n.descripcionProlongado) {
    partes.push(`${PREFIJO_PROLONGADO}${n.descripcionProlongado}${n.fechaLlegada ? `. Fecha estimada de llegada: ${n.fechaLlegada}` : ''}.`);
  }
  if (n.motivoSinPrecio) partes.push(`${PREFIJO_SIN_PRECIO}${n.motivoSinPrecio}.`);
  return partes.length > 0 ? partes.join(' ') : undefined;
}

/** Lee de un `DscItem` los campos marcados Diferido/Sin Dato por `notaTraslado`. */
export function extraerMarcadoresNota(dscItem: string | undefined): Partial<Record<CampoTraslado, 'Diferido' | 'Sin Dato'>> {
  const salida: Partial<Record<CampoTraslado, 'Diferido' | 'Sin Dato'>> = {};
  const i = dscItem?.indexOf(PREFIJO_PENDIENTE) ?? -1;
  if (!dscItem || i < 0) return salida;
  const inicio = i + PREFIJO_PENDIENTE.length;
  const fin = dscItem.indexOf('.', inicio);
  const tramo = dscItem.slice(inicio, fin < 0 ? undefined : fin);
  for (const c of CAMPOS_TRASLADO) {
    const m = new RegExp(`${ETIQUETA_CAMPO[c]}: (DIFERIDO|SIN DATO)`).exec(tramo);
    if (m) salida[c] = m[1] === 'DIFERIDO' ? 'Diferido' : 'Sin Dato';
  }
  return salida;
}

/** Texto literal del XML para un campo de texto marcado (`Diferido` / `Sin Dato`). */
export function literalMarcador(e: EstadoCampoTraslado): string | undefined {
  return e === 'diferido' ? LITERAL_DIFERIDO : e === 'sinDato' ? LITERAL_SIN_DATO : undefined;
}
