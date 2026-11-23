import Joi from 'joi';
import { fechaSchema, rutSchema } from '../comun/joi.js';

export interface GenerarLibroBaseDto {
  /** `AAAA-MM` (en libros ESPECIAL de varios períodos, el primero). */
  periodo: string;
  /** Por defecto MENSUAL (en certificación: ESPECIAL con `folioNotificacion`). */
  tipoLibro?: 'MENSUAL' | 'ESPECIAL' | 'RECTIFICA';
  /** Por defecto TOTAL. */
  tipoEnvio?: 'TOTAL' | 'PARCIAL' | 'FINAL' | 'AJUSTE';
  nroSegmento?: number;
  folioNotificacion?: number;
  codAutRec?: string;
  /** true: además de generar y guardar, sube el libro al SII. */
  enviar?: boolean;
}

export interface GenerarLibroVentasDto extends GenerarLibroBaseDto {
  /** Informa además las boletas 39/41 del período como resumen. Por defecto solo en libros MENSUAL. */
  incluirBoletas?: boolean;
  /** Restringe el libro a estos documentos (deben ser del período y de los tipos 33, 34, 56, 61, 110, 111, 112 o boletas). */
  documentoIds?: string[];
}

export interface GenerarLibroGuiasDto extends Omit<GenerarLibroBaseDto, 'tipoLibro' | 'codAutRec'> {
  tipoLibro?: 'ESPECIAL';
  folioNotificacion: number;
  documentoIds?: string[];
}

/** Documento recibido (compra), tal como lo informa el cliente. Montos en pesos enteros. */
export interface DocumentoCompraDto {
  tipoDoc: number;
  folio: number;
  operacion?: 1 | 2;
  anulado?: boolean;
  /** `AAAA-MM-DD`. */
  fechaDoc?: string;
  rutProveedor?: string;
  razonSocial?: string;
  tipoImpuesto?: 1 | 2;
  tasaIva?: number;
  numeroInterno?: string;
  codigoSucursal?: number;
  notaDeFacturaDeCompra?: boolean;
  facturaDeCompra?: boolean;
  tipoDocRef?: number;
  folioDocRef?: number;
  montoExento?: number;
  montoNeto?: number;
  /** IVA recuperable. Si se omite se calcula (neto x tasa). Informe 0 cuando todo el IVA es uso común o no recuperable. */
  montoIva?: number;
  montoNetoActivoFijo?: number;
  ivaActivoFijo?: number;
  ivaUsoComun?: number;
  ivaNoRecuperable?: Array<{ codigo: 1 | 2 | 3 | 4 | 9; monto: number }>;
  otrosImpuestos?: Array<{ codigo: number; tasa: number; monto: number }>;
  impuestoSinCredito?: number;
  ivaRetenidoTotal?: number;
  ivaRetenidoParcial?: number;
  ivaNoRetenido?: number;
  /** Se calcula si se omite; si se informa debe cuadrar. */
  montoTotal?: number;
}

export interface GenerarLibroComprasDto extends GenerarLibroBaseDto {
  /** Documentos recibidos informados por el cliente. Obligatorio salvo con `desdeRecibidos: true`. */
  documentos?: DocumentoCompraDto[];
  /**
   * true: el detalle sale de los DTE recibidos (`dte_recibidos`) aceptados (con o sin reparos) cuya fecha de
   * emisión cae en `periodo`. No admite `documentos` ni `documentosPeriodo`.
   */
  desdeRecibidos?: boolean;
  /** Envío AJUSTE: todos los documentos del período después del ajuste. */
  documentosPeriodo?: DocumentoCompraDto[];
  /** Factor de proporcionalidad del IVA de uso común (0,001 a 99,999). */
  factorProporcionalidad?: number;
}

export interface FiltroLibrosQuery {
  periodo?: string;
}

const periodoSchema = Joi.string()
  .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
  .messages({ 'string.pattern.base': 'debe tener formato AAAA-MM' });
const monto = Joi.number().integer().min(0).max(999_999_999_999_999);

const base = {
  periodo: periodoSchema.required(),
  tipoEnvio: Joi.string().valid('TOTAL', 'PARCIAL', 'FINAL', 'AJUSTE'),
  nroSegmento: Joi.number().integer().min(1).max(999_999),
  enviar: Joi.boolean(),
};

const folioNotificacion = Joi.number().integer().min(1).max(9_999_999_999);

const idsSchema = Joi.array().items(Joi.string().uuid()).min(1).max(5000).unique();

export const generarLibroVentasSchema = Joi.object<GenerarLibroVentasDto>({
  ...base,
  tipoLibro: Joi.string().valid('MENSUAL', 'ESPECIAL', 'RECTIFICA'),
  folioNotificacion,
  codAutRec: Joi.string().trim().max(10),
  incluirBoletas: Joi.boolean(),
  documentoIds: idsSchema,
});

export const generarLibroGuiasSchema = Joi.object<GenerarLibroGuiasDto>({
  ...base,
  tipoLibro: Joi.string().valid('ESPECIAL'),
  folioNotificacion: folioNotificacion.required(),
  documentoIds: idsSchema,
});

export const documentoCompraSchema = Joi.object<DocumentoCompraDto>({
  tipoDoc: Joi.number().integer().min(1).max(999).required(),
  folio: Joi.number().integer().min(1).max(9_999_999_999).required(),
  operacion: Joi.number().valid(1, 2),
  anulado: Joi.boolean(),
  fechaDoc: fechaSchema,
  rutProveedor: rutSchema,
  razonSocial: Joi.string().trim().max(100),
  tipoImpuesto: Joi.number().valid(1, 2),
  tasaIva: Joi.number().min(0).max(100),
  numeroInterno: Joi.string().trim().max(10),
  codigoSucursal: Joi.number().integer().min(1).max(999_999_999),
  notaDeFacturaDeCompra: Joi.boolean(),
  facturaDeCompra: Joi.boolean(),
  tipoDocRef: Joi.number().integer().min(1).max(999),
  folioDocRef: Joi.number().integer().min(1).max(9_999_999_999),
  montoExento: monto,
  montoNeto: monto,
  montoIva: monto,
  montoNetoActivoFijo: monto,
  ivaActivoFijo: monto,
  ivaUsoComun: monto,
  ivaNoRecuperable: Joi.array()
    .items(Joi.object({ codigo: Joi.number().valid(1, 2, 3, 4, 9).required(), monto: monto.required() }))
    .max(5),
  otrosImpuestos: Joi.array()
    .items(
      Joi.object({
        codigo: Joi.number().integer().min(1).max(999).required(),
        tasa: Joi.number().min(0).max(999.99).required(),
        monto: monto.required(),
      }),
    )
    .max(20),
  impuestoSinCredito: monto,
  ivaRetenidoTotal: monto,
  ivaRetenidoParcial: monto,
  ivaNoRetenido: monto,
  montoTotal: monto,
});

export const generarLibroComprasSchema = Joi.object<GenerarLibroComprasDto>({
  ...base,
  tipoLibro: Joi.string().valid('MENSUAL', 'ESPECIAL', 'RECTIFICA'),
  folioNotificacion,
  codAutRec: Joi.string().trim().max(10),
  documentos: Joi.array().items(documentoCompraSchema).max(50_000),
  desdeRecibidos: Joi.boolean(),
  documentosPeriodo: Joi.array().items(documentoCompraSchema).max(50_000),
  factorProporcionalidad: Joi.number().min(0.001).max(99.999),
}).custom((v: GenerarLibroComprasDto, helpers) => {
  if (v.desdeRecibidos) {
    if (v.documentos !== undefined || v.documentosPeriodo !== undefined) {
      return helpers.message({ custom: 'con desdeRecibidos no se informan documentos ni documentosPeriodo' });
    }
  } else if (v.documentos === undefined) {
    return helpers.message({ custom: 'documentos es obligatorio (o use desdeRecibidos: true)' });
  }
  return v;
});

export const filtroLibrosSchema = Joi.object<FiltroLibrosQuery>({ periodo: periodoSchema });
