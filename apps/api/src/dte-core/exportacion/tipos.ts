/**
 * Datos de un documento de exportación (110 factura, 111 nota de débito, 112 nota de crédito).
 * Los montos del documento (`detalle`, descuentos) están en la moneda de la operación (`moneda`); el equivalente en
 * pesos chilenos (`OtraMoneda`) se calcula con `tipoCambio`. Los códigos de Aduana (país, puerto, vía, cláusula,
 * modalidad, forma de pago, tipo de bulto) vienen de las tablas del Anexo 51 del Compendio de Normas Aduaneras
 * (`exportacion/tablas`).
 */
export interface BultoExportacion {
  /** Código de tipo de bulto (Anexo 51-23), hasta 3 dígitos. */
  codigoTipo?: number;
  cantidad?: number;
  marcas?: string;
  idContenedor?: string;
  sello?: string;
  emisorSello?: string;
}

export interface AduanaExportacion {
  /** Modalidad de venta (Anexo 51-26): 1 a firme, 2 bajo condición, 3 consignación libre, 4 consignación con mínimo a firme, 9 sin pago. */
  codigoModalidadVenta?: number;
  /** Cláusula de compraventa (Anexo 51-21): 1 CIF, 2 CFR, 3 EXW, 4 FAS, 5 FOB, 6 sin cláusula, 7 FCA, 8 otra, 9 DDP. */
  codigoClausulaVenta?: number;
  /** Valor total de la exportación según la cláusula (hasta 2 decimales, > 0), en la moneda de la operación. */
  totalClausulaVenta?: number;
  /** Vía de transporte (Anexo 51-13). */
  codigoViaTransporte?: number;
  nombreTransporte?: string;
  /** RUT (con DV) de la compañía transportista; si es extranjera, el de su agencia en Chile. */
  rutCompaniaTransporte?: string;
  nombreCompaniaTransporte?: string;
  idAdicionalTransporte?: string;
  booking?: string;
  operador?: string;
  /** Puerto de embarque / desembarque (Anexo 51-11). */
  codigoPuertoEmbarque?: number;
  idAdicionalPuertoEmbarque?: string;
  codigoPuertoDesembarque?: number;
  idAdicionalPuertoDesembarque?: string;
  tara?: number;
  codigoUnidadTara?: number;
  pesoBruto?: number;
  codigoUnidadPesoBruto?: number;
  pesoNeto?: number;
  codigoUnidadPesoNeto?: number;
  totalItems?: number;
  totalBultos?: number;
  bultos?: BultoExportacion[];
  /** Flete y seguro en la moneda de la operación (> 0, hasta 4 decimales). */
  montoFlete?: number;
  montoSeguro?: number;
  /** País del receptor y país de destino de la mercadería (Anexo 51-9). */
  codigoPaisReceptor?: number;
  codigoPaisDestino?: number;
}

export interface ReceptorExtranjeroExportacion {
  /** Identificador tributario del receptor en su país (hasta 20 caracteres). */
  numId?: string;
  /** Nacionalidad: código de país de Aduana (Anexo 51-9). */
  nacionalidad: number | string;
  /** Identificador adicional de uso libre (hasta 20). */
  idAdicional?: string;
}

export interface ExportacionDte {
  /** Glosa de moneda de Aduana tal como la enumera el XSD (`DOLAR USA`, `EURO`, ...). No puede ser `PESO` ni `PESO CL`. */
  moneda: string;
  /** Pesos chilenos por unidad de moneda (tipo de cambio del Banco Central a la fecha de emisión), hasta 4 decimales, 0,0001 a 999999,9999. */
  tipoCambio: number;
  /** `FmaPagExp`: forma de pago de exportación (Anexo 51-22); 32 = anticipo exige `fechaCancelacion`. */
  formaPagoExportacion?: number;
  fechaCancelacion?: string;
  extranjero: ReceptorExtranjeroExportacion;
  aduana?: AduanaExportacion;
  /** Identificador adicional del emisor (uso libre, hasta 20). */
  idAdicionalEmisor?: string;
}

/** Totales de un documento de exportación (moneda de la operación y equivalente en pesos). */
export interface TotalesExportacion {
  moneda: string;
  tipoCambio: number;
  /** `MontoItem` de cada línea, en la moneda de la operación (hasta 4 decimales). */
  montosLineas: number[];
  /** Monto de cada descuento/recargo global, en la moneda de la operación (positivo). */
  montosGlobales: number[];
  /** `MntExe`: igual a `MntTotal` (todo es exento). */
  montoExento: number;
  montoTotal: number;
  /** Equivalente en pesos (enteros): `MntExeOtrMnda` y `MntTotOtrMnda`. */
  montoExentoPesos: number;
  montoTotalPesos: number;
}
