/** Estados de `U_SII_Estado`. */
export const ESTADOS = [
  'PENDIENTE',
  'ENVIANDO',
  'EMITIDO',
  'ENVIADO',
  'ACEPTADO',
  'REPAROS',
  'RECHAZADO',
  'ERROR',
] as const;
export type EstadoSii = (typeof ESTADOS)[number];

export type TipoDte = 33 | 34 | 39 | 41 | 52 | 56 | 61 | 110 | 111 | 112;
export const TIPOS_DTE: readonly TipoDte[] = [33, 34, 39, 41, 52, 56, 61, 110, 111, 112];

/** Exportación: 110 factura (OINV), 111 nota de débito (OINV), 112 nota de crédito (ORIN). */
export const esExportacion = (t: number): boolean => t === 110 || t === 111 || t === 112;

/** Entidades de Service Layer que el worker procesa. */
export interface EntidadB1 {
  /** Nombre de la entidad en Service Layer. */
  entidad: 'Invoices' | 'CreditNotes' | 'DeliveryNotes';
  /** `ObjType` de B1 (13 factura, 14 nota de crédito, 15 entrega). */
  objType: 13 | 14 | 15;
  /** Tabla de la cabecera (para los UDFs). */
  tabla: 'OINV' | 'ORIN' | 'ODLN';
}

export const ENTIDADES: readonly EntidadB1[] = [
  { entidad: 'Invoices', objType: 13, tabla: 'OINV' },
  { entidad: 'CreditNotes', objType: 14, tabla: 'ORIN' },
  { entidad: 'DeliveryNotes', objType: 15, tabla: 'ODLN' },
];

export function entidadPorObjType(objType: number): EntidadB1 | undefined {
  return ENTIDADES.find((e) => e.objType === objType);
}

export interface LineaB1 {
  LineNum?: number;
  ItemCode?: string | null;
  ItemDescription?: string | null;
  FreeText?: string | null;
  Quantity?: number;
  /** Precio neto (antes de impuestos). */
  UnitPrice?: number | null;
  /** Precio con impuestos incluidos. */
  PriceAfterVAT?: number | null;
  DiscountPercent?: number | null;
  TaxCode?: string | null;
  TaxPercentagePerRow?: number | null;
  MeasureUnit?: string | null;
  UoMCode?: string | null;
  /** Moneda de la línea; en un documento en moneda extranjera debe ser la del documento. */
  Currency?: string | null;
  BaseType?: number | null;
  BaseEntry?: number | null;
  BaseLine?: number | null;
}

/** Cabecera de documento de marketing (Invoices, CreditNotes, DeliveryNotes) con los UDFs `U_SII_*`. */
export interface DocumentoB1 {
  DocEntry: number;
  DocNum?: number;
  DocDate: string;
  DocDueDate?: string | null;
  CardCode: string;
  CardName?: string | null;
  Address?: string | null;
  PayToCode?: string | null;
  PaymentGroupCode?: number | null;
  /** Descuento de cabecera (%). */
  DiscountPercent?: number | null;
  /** Moneda del documento (código de B1, p. ej. `USD`); en exportación es la moneda de la operación. */
  DocCurrency?: string | null;
  /** Tipo de cambio del documento (pesos por unidad de `DocCurrency`). */
  DocRate?: number | null;
  /** Total del documento en la moneda del documento (informativo: se contrasta con el calculado). */
  DocTotalFC?: number | null;
  Comments?: string | null;
  /** Dirección de entrega (texto libre) de la guía. */
  Address2?: string | null;
  /** Dirección de entrega estructurada (`ShipTo*`); en Chile `ShipToCounty` es la comuna (supuesto). */
  AddressExtension?: {
    ShipToStreet?: string | null;
    ShipToStreetNo?: string | null;
    ShipToCity?: string | null;
    ShipToCounty?: string | null;
  } | null;
  AttachmentEntry?: number | null;
  DocumentLines: LineaB1[];
  U_SII_TipoDTE?: string | null;
  U_SII_Estado?: string | null;
  U_SII_Folio?: number | null;
  U_SII_TrackId?: string | null;
  U_SII_Glosa?: string | null;
  U_SII_DocId?: string | null;
  U_SII_XmlUrl?: string | null;
  U_SII_PdfUrl?: string | null;
  U_SII_IdemKey?: string | null;
  U_SII_IndTraslado?: string | null;
  /** OBSOLETO (texto libre): se reemplaza por los UDF estructurados de traslado (Res. Ex. SII 144/2026). */
  U_SII_Transporte?: string | null;
  /** AUTOGESTIONADO | TERCERIZADO | REGIMEN_ESPECIAL. */
  U_SII_CatTraslado?: string | null;
  U_SII_DirOrigen?: string | null;
  U_SII_CmnaOrigen?: string | null;
  U_SII_RutTrans?: string | null;
  U_SII_RutChofer?: string | null;
  U_SII_NomChofer?: string | null;
  U_SII_Patente?: string | null;
  U_SII_PatenteCarro?: string | null;
  /** Fecha (`yyyy-mm-dd`, se toman los 10 primeros caracteres). */
  U_SII_FchSalida?: string | null;
  /** `HH:MM` o `HH:MM:SS`. */
  U_SII_HraSalida?: string | null;
  U_SII_FchLlegada?: string | null;
  U_SII_CodRef?: string | null;
  U_SII_RazonRef?: string | null;
  U_SII_TipoDocRef?: string | null;
  U_SII_FolioRef?: string | null;
  /** Exportación (110-112), códigos de las tablas de Aduana (Anexo 51 del Compendio de Normas Aduaneras). */
  U_SII_ModVenta?: string | null;
  U_SII_ClausulaVenta?: string | null;
  /** Total de la cláusula de venta en la moneda del documento (por defecto `DocTotalFC`). */
  U_SII_TotClausula?: string | null;
  U_SII_ViaTransp?: string | null;
  U_SII_PtoEmbarque?: string | null;
  U_SII_PtoDesemb?: string | null;
  U_SII_PaisReceptor?: string | null;
  U_SII_PaisDestino?: string | null;
  U_SII_TotBultos?: number | string | null;
  U_SII_TipoBulto?: string | null;
  U_SII_FormaPagoExp?: string | null;
  /** 3 a 6 si la exportación es de servicios; vacío para bienes. */
  U_SII_IndServicio?: string | null;
}

export interface DireccionSocioB1 {
  AddressName?: string | null;
  AddressType?: string | null;
  Street?: string | null;
  StreetNo?: string | null;
  City?: string | null;
  /** En la localización Chile se usa como comuna (supuesto: verificar con el partner). */
  County?: string | null;
}

export interface SocioB1 {
  CardCode: string;
  CardName?: string | null;
  /** RUT del socio. */
  LicTradNum?: string | null;
  EmailAddress?: string | null;
  Phone1?: string | null;
  BPAddresses?: DireccionSocioB1[];
  [campo: string]: unknown;
}

/** Datos del documento base necesarios para armar referencias. */
export interface BaseInfo {
  objType: number;
  docEntry: number;
  docDate: string;
  folio: number | null;
  tipoDte: number | null;
}
