import Joi from 'joi';
import { fechaSchema, rutSchema } from '../comun/joi.js';
import {
  CAMPOS_TRASLADO,
  CATEGORIAS_TRASLADO,
  TIPOS_DTE,
  type CampoTraslado,
  type CategoriaTraslado,
  type ExportacionDte,
  type IndTraslado,
} from '../dte-core/index.js';

/**
 * Datos de traslado (Res. Ex. SII 144/2026) de una guía de despacho (52) o factura (33/34) que ampara traslado.
 * Ver `apps/api/src/dte-core/README.md` (sección Res. 144) para las reglas por categoría.
 */
export interface TrasladoDto {
  /** Alias de `idDoc.indTraslado` (1 a 12; 10-12 requieren `PERMITIR_INDTRASLADO_RES144=true`). */
  indTraslado?: IndTraslado;
  /** autogestionado | tercerizado | regimen_especial. Obligatoria salvo `retiroComprador`. */
  categoria?: CategoriaTraslado;
  /** Factura retirada por el comprador (resolutivo 15°): sin datos de transporte. */
  retiroComprador?: boolean;
  /** Origen efectivo; por defecto la dirección de la empresa emisora. */
  origen?: { direccion: string; comuna: string };
  destino?: { direccion: string; comuna: string; ciudad?: string };
  fechaSalida?: string;
  horaSalida?: string;
  fechaLlegada?: string;
  transportista?: { rut: string };
  chofer?: { rut?: string; nombre?: string };
  patente?: string;
  patenteCarro?: string;
  /** Campos que se informan como "Diferido" (transporte tercerizado: se completan después). */
  diferido?: CampoTraslado[];
  /** Campos que se informan como "Sin Dato". */
  sinDato?: CampoTraslado[];
  descripcionProlongado?: string;
  motivoSinPrecio?: string;
}

/** Cuerpo de `POST /v1/empresas/{rut}/documentos`: `DocumentoDte` de dte-core sin folio ni emisor. */
export interface EmitirDocumentoDto {
  idDoc: {
    tipoDte: 33 | 34 | 39 | 41 | 52 | 56 | 61 | 110 | 111 | 112;
    /** `yyyy-mm-dd`; por defecto hoy en America/Santiago. */
    fechaEmision?: string;
    fechaVencimiento?: string;
    formaPago?: 1 | 2 | 3;
    indTraslado?: IndTraslado;
    /** Boletas 1 a 4; facturas 1 a 3; exportación 3 a 6 (omitir para bienes). */
    indServicio?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Solo exportación: 1 por cuenta del comprador, 2 por cuenta del emisor a instalaciones del comprador, 3 a otras instalaciones. */
    tipoDespacho?: 1 | 2 | 3;
    medioPago?: 1 | 2 | 3 | 4 | 5;
    medioPagoDte?: 'CH' | 'LT' | 'EF' | 'PE' | 'TC' | 'CF' | 'OT';
    periodoDesde?: string;
    periodoHasta?: string;
  };
  /**
   * Obligatorio salvo en boletas (por defecto consumidor final 66666666-6). En exportación (110-112) el RUT es siempre
   * 55555555-5 (se puede omitir) y el identificador del receptor en su país va en `exportacion.extranjero.numId`.
   */
  receptor?: {
    rut?: string;
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
    /** Obligatoria salvo en la guía tercerizada (`indTraslado` 10). */
    cantidad?: number;
    unidad?: string;
    /** Puede omitirse (0) en guías y traslados no venta; ver `traslado.motivoSinPrecio`. */
    precioUnitario?: number;
    /** Peso del ítem; se informa en la descripción (el formato DTE no tiene campo por ítem). */
    peso?: { valor: number; unidad: string };
    volumen?: { valor: number; unidad: string };
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
    /** RUT del emisor del documento referido, solo si es tributario y de otro contribuyente (`RUTOtr`). */
    rutOtroContribuyente?: string;
    /** Por defecto, la fecha de emisión. */
    fechaRef?: string;
    codRef?: 1 | 2 | 3;
    razonRef?: string;
    indGlobal?: boolean;
  }>;
  impuestosAdicionales?: Array<{ codigo: number; tasa?: number; monto: number }>;
  traslado?: TrasladoDto;
  /**
   * Exportación (110, 111, 112): moneda, tipo de cambio, receptor extranjero y datos de Aduana (ver
   * `dte-core/README.md`, sección Exportación). Obligatorio en esos tipos y prohibido en los demás.
   */
  exportacion?: ExportacionDte;
  /** Metadato opcional para correlacionar con el ERP. */
  origen?: Record<string, unknown>;
}

const texto = (max: number) => Joi.string().trim().max(max);

const marcadoresSchema = Joi.array().items(Joi.string().valid(...CAMPOS_TRASLADO)).unique();
const pesoVolumenSchema = Joi.object({ valor: Joi.number().positive().required(), unidad: texto(10).required() });

export const trasladoSchema = Joi.object<TrasladoDto>({
  indTraslado: Joi.number().integer().min(1).max(12),
  categoria: Joi.string().valid(...CATEGORIAS_TRASLADO),
  retiroComprador: Joi.boolean(),
  origen: Joi.object({ direccion: texto(70).required(), comuna: texto(20).required() }),
  destino: Joi.object({ direccion: texto(70).required(), comuna: texto(20).required(), ciudad: texto(20) }),
  fechaSalida: fechaSchema,
  horaSalida: Joi.string().trim().pattern(/^\d{2}:\d{2}(:\d{2})?$/).messages({ 'string.pattern.base': 'debe tener formato HH:MM o HH:MM:SS' }),
  fechaLlegada: fechaSchema,
  transportista: Joi.object({ rut: rutSchema.required() }),
  chofer: Joi.object({ rut: rutSchema, nombre: texto(30) }),
  patente: texto(10),
  patenteCarro: texto(10),
  diferido: marcadoresSchema,
  sinDato: marcadoresSchema,
  descripcionProlongado: texto(400),
  motivoSinPrecio: texto(200),
});

const codigo = (digitos: number) => Joi.number().integer().min(1).max(10 ** digitos - 1);

const bultoSchema = Joi.object({
  codigoTipo: codigo(3),
  cantidad: Joi.number().integer().min(1).max(9_999_999_999),
  marcas: texto(255),
  idContenedor: texto(25),
  sello: texto(20),
  emisorSello: texto(70),
});

const aduanaSchema = Joi.object({
  codigoModalidadVenta: codigo(2),
  codigoClausulaVenta: codigo(2),
  totalClausulaVenta: Joi.number().positive(),
  codigoViaTransporte: codigo(2),
  nombreTransporte: texto(40),
  rutCompaniaTransporte: rutSchema,
  nombreCompaniaTransporte: texto(40),
  idAdicionalTransporte: texto(20),
  booking: texto(20),
  operador: texto(20),
  codigoPuertoEmbarque: codigo(4),
  idAdicionalPuertoEmbarque: texto(20),
  codigoPuertoDesembarque: codigo(4),
  idAdicionalPuertoDesembarque: texto(20),
  tara: Joi.number().integer().min(1),
  codigoUnidadTara: codigo(2),
  pesoBruto: Joi.number().positive(),
  codigoUnidadPesoBruto: codigo(2),
  pesoNeto: Joi.number().positive(),
  codigoUnidadPesoNeto: codigo(2),
  totalItems: Joi.number().integer().min(1),
  totalBultos: Joi.number().integer().min(1),
  bultos: Joi.array().items(bultoSchema).max(10),
  montoFlete: Joi.number().positive(),
  montoSeguro: Joi.number().positive(),
  codigoPaisReceptor: codigo(3),
  codigoPaisDestino: codigo(3),
});

/** Bloque `exportacion` (110-112); las reglas de negocio y de tablas de Aduana las valida dte-core. */
export const exportacionSchema = Joi.object<ExportacionDte>({
  moneda: texto(15).required(),
  tipoCambio: Joi.number().positive().required(),
  formaPagoExportacion: codigo(2),
  fechaCancelacion: fechaSchema,
  extranjero: Joi.object({
    numId: texto(20),
    nacionalidad: Joi.alternatives()
      .try(Joi.number().integer().min(1).max(999), Joi.string().trim().pattern(/^\d{1,3}$/))
      .required(),
    idAdicional: texto(20),
  }).required(),
  aduana: aduanaSchema,
  idAdicionalEmisor: texto(20),
});

export const emitirDocumentoSchema = Joi.object<EmitirDocumentoDto>({
  idDoc: Joi.object({
    tipoDte: Joi.number()
      .valid(...TIPOS_DTE)
      .required(),
    fechaEmision: fechaSchema,
    fechaVencimiento: fechaSchema,
    formaPago: Joi.number().valid(1, 2, 3),
    indTraslado: Joi.number().integer().min(1).max(12),
    indServicio: Joi.number().valid(1, 2, 3, 4, 5, 6),
    tipoDespacho: Joi.number().valid(1, 2, 3),
    medioPago: Joi.number().valid(1, 2, 3, 4, 5),
    medioPagoDte: Joi.string().valid('CH', 'LT', 'EF', 'PE', 'TC', 'CF', 'OT'),
    periodoDesde: fechaSchema,
    periodoHasta: fechaSchema,
  }).required(),
  receptor: Joi.object({
    rut: rutSchema,
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
        cantidad: Joi.number().positive(),
        unidad: texto(4),
        precioUnitario: Joi.number().min(0),
        peso: pesoVolumenSchema,
        volumen: pesoVolumenSchema,
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
        rutOtroContribuyente: rutSchema,
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
  traslado: trasladoSchema,
  exportacion: exportacionSchema,
  origen: Joi.object().unknown(true),
});

/** Cuerpo de `POST /v1/documentos/{id}/complementar-traslado`. */
export interface ComplementarTrasladoDto {
  /**
   * `guia_posterior` (por defecto): nueva guía 52 con el mismo `IndTraslado` y los datos actualizados que referencia
   * a la original (resolutivo 4°). `gdt`: guía de despacho tercerizada (`IndTraslado` 10, resolutivos 5° y 6°);
   * si `PERMITIR_INDTRASLADO_RES144` no la habilita, se emite como guía posterior y se informa en `advertencia`.
   */
  modalidad?: 'guia_posterior' | 'gdt';
  /** Datos nuevos o corregidos; lo no informado se conserva de la original. Los campos que se informan salen de `diferido`/`sinDato`. */
  traslado: Omit<TrasladoDto, 'indTraslado' | 'retiroComprador'>;
  /** `yyyy-mm-dd`; por defecto hoy. */
  fechaEmision?: string;
}

export const complementarTrasladoSchema = Joi.object<ComplementarTrasladoDto>({
  modalidad: Joi.string().valid('guia_posterior', 'gdt'),
  traslado: trasladoSchema.fork(['indTraslado', 'retiroComprador'], (c) => c.forbidden()).required(),
  fechaEmision: fechaSchema,
});

/** Query de `GET /v1/empresas/{rut}/documentos`. */
export interface ListarDocumentosQuery {
  trasladoPendiente?: boolean;
  tipo?: number;
  limite?: number;
}

export const listarDocumentosSchema = Joi.object<ListarDocumentosQuery>({
  trasladoPendiente: Joi.boolean(),
  tipo: Joi.number().valid(...TIPOS_DTE),
  limite: Joi.number().integer().min(1).max(200),
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
