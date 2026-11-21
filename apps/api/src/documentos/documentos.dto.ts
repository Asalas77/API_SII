import Joi from 'joi';
import { fechaSchema, rutSchema } from '../comun/joi.js';
import { TIPOS_DTE } from '../dte-core/index.js';

/** Cuerpo de `POST /v1/empresas/{rut}/documentos`: `DocumentoDte` de dte-core sin folio ni emisor. */
export interface EmitirDocumentoDto {
  idDoc: {
    tipoDte: 33 | 34 | 39 | 41 | 52 | 56 | 61;
    /** `yyyy-mm-dd`; por defecto hoy en America/Santiago. */
    fechaEmision?: string;
    fechaVencimiento?: string;
    formaPago?: 1 | 2 | 3;
    indTraslado?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    indServicio?: 1 | 2 | 3 | 4;
    medioPago?: 1 | 2 | 3 | 4 | 5;
    medioPagoDte?: 'CH' | 'LT' | 'EF' | 'PE' | 'TC' | 'CF' | 'OT';
    periodoDesde?: string;
    periodoHasta?: string;
  };
  /** Obligatorio salvo en boletas (por defecto consumidor final 66666666-6). */
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
    codigoItem?: string | { tipo: string; valor: string };
    cantidad: number;
    unidad?: string;
    precioUnitario: number;
    descuentoPorcentaje?: number;
    descuentoMonto?: number;
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
    /** Por defecto, la fecha de emisión. */
    fechaRef?: string;
    codRef?: 1 | 2 | 3;
    razonRef?: string;
    indGlobal?: boolean;
  }>;
  impuestosAdicionales?: Array<{ codigo: number; tasa?: number; monto: number }>;
  /** Metadato opcional para correlacionar con el ERP. */
  origen?: Record<string, unknown>;
}

const texto = (max: number) => Joi.string().trim().max(max);

export const emitirDocumentoSchema = Joi.object<EmitirDocumentoDto>({
  idDoc: Joi.object({
    tipoDte: Joi.number()
      .valid(...TIPOS_DTE)
      .required(),
    fechaEmision: fechaSchema,
    fechaVencimiento: fechaSchema,
    formaPago: Joi.number().valid(1, 2, 3),
    indTraslado: Joi.number().integer().min(1).max(9),
    indServicio: Joi.number().valid(1, 2, 3, 4),
    medioPago: Joi.number().valid(1, 2, 3, 4, 5),
    medioPagoDte: Joi.string().valid('CH', 'LT', 'EF', 'PE', 'TC', 'CF', 'OT'),
    periodoDesde: fechaSchema,
    periodoHasta: fechaSchema,
  }).required(),
  receptor: Joi.object({
    rut: rutSchema.required(),
    razonSocial: texto(100).required(),
    giro: texto(40),
    direccion: texto(70),
    comuna: texto(20),
    ciudad: texto(20),
    correo: texto(80).email(),
    telefono: texto(20),
  }),
  detalle: Joi.array()
    .items(
      Joi.object({
        nombre: texto(80).required(),
        descripcion: texto(1000),
        codigoItem: Joi.alternatives().try(
          texto(35),
          Joi.object({ tipo: texto(10).required(), valor: texto(35).required() }),
        ),
        cantidad: Joi.number().positive().required(),
        unidad: texto(4),
        precioUnitario: Joi.number().min(0).required(),
        descuentoPorcentaje: Joi.number().min(0).max(100),
        descuentoMonto: Joi.number().min(0),
        exento: Joi.boolean(),
      }),
    )
    .min(1)
    .max(1000)
    .required(),
  descuentosRecargos: Joi.array()
    .items(
      Joi.object({
        tipo: Joi.string().valid('D', 'R').required(),
        glosa: texto(45),
        tipoValor: Joi.string().valid('%', '$').required(),
        valor: Joi.number().min(0).required(),
        exento: Joi.boolean(),
      }),
    )
    .max(20),
  referencias: Joi.array()
    .items(
      Joi.object({
        tipoDocRef: texto(3).required(),
        folioRef: Joi.alternatives().try(texto(18), Joi.number().integer()).required(),
        fechaRef: fechaSchema,
        codRef: Joi.number().valid(1, 2, 3),
        razonRef: texto(90),
        indGlobal: Joi.boolean(),
      }),
    )
    .max(40),
  impuestosAdicionales: Joi.array().items(
    Joi.object({
      codigo: Joi.number().integer().required(),
      tasa: Joi.number().min(0),
      monto: Joi.number().integer().min(0).required(),
    }),
  ),
  origen: Joi.object().unknown(true),
});

export interface PdfQuery {
  formato?: 'carta' | 'termica80';
  cedible?: boolean;
}

export const pdfQuerySchema = Joi.object<PdfQuery>({
  formato: Joi.string().valid('carta', 'termica80'),
  cedible: Joi.boolean(),
});

/** Cuerpo opcional de `POST /v1/empresas/{rut}/documentos/consultar-estados`. */
export interface ConsultarEstadosDto {
  /** Documentos a consultar; por defecto, los `enviado` de la empresa. */
  documentoIds?: string[];
  /** Máximo de documentos cuando no se indican ids (por defecto 50, máximo 200). */
  limite?: number;
}

export const consultarEstadosSchema = Joi.object<ConsultarEstadosDto>({
  documentoIds: Joi.array().items(Joi.string().uuid()).min(1).max(200).unique(),
  limite: Joi.number().integer().min(1).max(200),
})
  .without('documentoIds', 'limite')
  .default({});
