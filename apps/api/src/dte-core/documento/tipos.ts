/** Tipos de documento soportados por los constructores. */
export type TipoDte = 33 | 34 | 39 | 41 | 52 | 56 | 61;

export const TIPOS_DTE: readonly TipoDte[] = [33, 34, 39, 41, 52, 56, 61];

/** Boletas (39 afecta, 41 exenta): usan `EnvioBOLETA_v11.xsd`, precios con IVA incluido. */
export function esBoleta(tipo: TipoDte): boolean {
  return tipo === 39 || tipo === 41;
}

/** Documentos íntegramente exentos (34 y 41): sin IVA. */
export function esTipoExento(tipo: TipoDte): boolean {
  return tipo === 34 || tipo === 41;
}

/** Tasa de IVA vigente en Chile (%). */
export const TASA_IVA = 19;

/** Límites del XSD oficial (`maxOccurs`). */
export const MAX_LINEAS_DETALLE_DTE = 60;
export const MAX_LINEAS_DETALLE_BOLETA = 1000;
export const MAX_DESCUENTOS_RECARGOS = 20;
export const MAX_REFERENCIAS = 40;
export const MAX_ACTECOS = 4;

export interface IdDocDte {
  tipoDte: TipoDte;
  folio: number;
  /** `yyyy-mm-dd`. */
  fechaEmision: string;
  /** `yyyy-mm-dd`. */
  fechaVencimiento?: string;
  /** 1 contado, 2 crédito, 3 sin costo (entrega gratuita). No aplica a boletas. */
  formaPago?: 1 | 2 | 3;
  /** Solo guías (52): 1 operación constituye venta ... 9 otros traslados. */
  indTraslado?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * Boletas: 1 servicios periódicos, 2 servicios periódicos domiciliarios, 3 ventas y servicios
   * (por defecto), 4 espectáculos por cuenta de terceros. En facturas el XSD admite 1 a 3.
   */
  indServicio?: 1 | 2 | 3 | 4;
  /** Boletas: 1 efectivo, 2 pago electrónico, 3 transferencia, 4 cheque, 5 otro. */
  medioPago?: 1 | 2 | 3 | 4 | 5;
  /** Facturas/notas/guías: CH, LT, EF, PE, TC, CF, OT. */
  medioPagoDte?: 'CH' | 'LT' | 'EF' | 'PE' | 'TC' | 'CF' | 'OT';
  /** Servicios periódicos (`yyyy-mm-dd`). */
  periodoDesde?: string;
  periodoHasta?: string;
}

export interface EmisorDte {
  /** Cuerpo numérico del RUT (sin DV). */
  rut: string | number;
  dv: string;
  razonSocial: string;
  giro: string;
  /** Códigos de actividad económica (1 a 4). Obligatorio en facturas/notas/guías; PROHIBIDO en boletas. */
  actecos?: number[];
  direccion: string;
  comuna: string;
  ciudad: string;
  codigoSucursalSii?: number;
  correo?: string;
  telefono?: string;
}

export interface ReceptorDte {
  rut: string | number;
  dv: string;
  razonSocial: string;
  giro?: string;
  direccion?: string;
  comuna?: string;
  ciudad?: string;
  correo?: string;
  telefono?: string;
}

export interface DetalleDte {
  nombre: string;
  descripcion?: string;
  /** Código del ítem; un string se informa como tipo `INT1`. */
  codigoItem?: string | { tipo: string; valor: string };
  cantidad: number;
  unidad?: string;
  /** Neto en facturas/notas/guías; con IVA incluido en boletas. */
  precioUnitario: number;
  descuentoPorcentaje?: number;
  descuentoMonto?: number;
  /** Ítem exento o no afecto (`IndExe=1`). En tipos 34 y 41 todos los ítems son exentos. */
  exento?: boolean;
}

export interface DescuentoRecargoGlobal {
  /** D descuento, R recargo. */
  tipo: 'D' | 'R';
  glosa?: string;
  /** `%` porcentaje o `$` monto. */
  tipoValor: '%' | '$';
  valor: number;
  /** true si aplica a los ítems exentos (`IndExeDR=1`); por defecto aplica a los afectos. */
  exento?: boolean;
}

export interface ReferenciaDte {
  /** Tipo de documento referenciado (`33`, `61`, `801`, `SET`, ...). Máx. 3 caracteres. */
  tipoDocRef: string;
  folioRef: string | number;
  /** `yyyy-mm-dd`. No se informa en boletas (el XSD de boleta no tiene `FchRef`). */
  fechaRef: string;
  /** 1 anula documento, 2 corrige texto, 3 corrige montos. */
  codRef?: 1 | 2 | 3;
  razonRef?: string;
  /** Referencia global (`IndGlobal=1`), solo facturas/notas/guías. */
  indGlobal?: boolean;
}

export interface ImpuestoAdicionalDte {
  /** Código de impuesto adicional (tabla del SII). */
  codigo: number;
  /** Tasa en %, opcional. */
  tasa?: number;
  /** Monto entero en CLP; se suma al total. */
  monto: number;
}

export interface DocumentoDte {
  idDoc: IdDocDte;
  emisor: EmisorDte;
  receptor: ReceptorDte;
  detalle: DetalleDte[];
  descuentosRecargos?: DescuentoRecargoGlobal[];
  referencias?: ReferenciaDte[];
  impuestosAdicionales?: ImpuestoAdicionalDte[];
}

export interface TotalesDte {
  /** Neto afecto; 0 si no hay base afecta (no se informa). */
  mntNeto: number;
  /** Exento; 0 si no hay (no se informa). */
  mntExe: number;
  /** 19 si hay base afecta, 0 si no. */
  tasaIva: number;
  iva: number;
  /** Impuestos adicionales sumados al total (facturas). */
  mntImpAdicionales: number;
  mntTotal: number;
  /** `MontoItem` de cada línea de detalle, en orden. */
  montosLineas: number[];
  /** Monto resultante (siempre positivo) de cada descuento/recargo global, en orden. */
  montosGlobales: number[];
}
