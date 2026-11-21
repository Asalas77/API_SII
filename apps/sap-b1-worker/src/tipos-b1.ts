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

export type TipoDte = 33 | 34 | 39 | 41 | 52 | 56 | 61;
export const TIPOS_DTE: readonly TipoDte[] = [33, 34, 39, 41, 52, 56, 61];

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
  Comments?: string | null;
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
  U_SII_Transporte?: string | null;
  U_SII_CodRef?: string | null;
  U_SII_RazonRef?: string | null;
  U_SII_TipoDocRef?: string | null;
  U_SII_FolioRef?: string | null;
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
