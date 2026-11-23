import type { Config } from '../src/config.js';
import type { BaseInfo, DocumentoB1, LineaB1, SocioB1 } from '../src/tipos-b1.js';

export const RUT_EMPRESA = '76086428-5';

export const configB1: Config['b1'] = {
  codigosExentos: ['IVA_EXE', 'EXE'],
  gruposPagoContado: [-1],
  campoGiro: 'U_SII_Giro',
};

export function linea(n: number, extra: Partial<LineaB1> = {}): LineaB1 {
  return {
    LineNum: n,
    ItemCode: `ART${String(n + 1).padStart(3, '0')}`,
    ItemDescription: `Artículo de prueba ${n + 1}`,
    Quantity: 2,
    UnitPrice: 10000,
    PriceAfterVAT: 11900,
    DiscountPercent: 0,
    TaxCode: 'IVA',
    TaxPercentagePerRow: 19,
    MeasureUnit: 'UN',
    BaseType: -1,
    BaseEntry: null,
    ...extra,
  };
}

export function socio(extra: Record<string, unknown> = {}): SocioB1 {
  return {
    CardCode: 'C20000',
    CardName: 'Comercial Los Andes SpA',
    LicTradNum: '77.123.456-9',
    EmailAddress: 'compras@losandes.cl',
    Phone1: '+56 2 2345 6789',
    U_SII_Giro: 'Venta al por mayor de ferreteria',
    BPAddresses: [
      { AddressName: 'Casa matriz', AddressType: 'bo_BillTo', Street: 'Av. Providencia', StreetNo: '1234', City: 'Santiago', County: 'Providencia' },
      { AddressName: 'Bodega', AddressType: 'bo_ShipTo', Street: 'Camino Lo Boza', StreetNo: '99', City: 'Pudahuel', County: 'Pudahuel' },
    ],
    ...extra,
  };
}

function base(extra: Partial<DocumentoB1>): DocumentoB1 {
  return {
    DocEntry: 100,
    DocNum: 1500,
    DocDate: '2026-03-16',
    DocDueDate: '2026-04-15',
    CardCode: 'C20000',
    CardName: 'Comercial Los Andes SpA',
    Address: 'Av. Providencia 1234\r\nProvidencia\r\nSantiago',
    PayToCode: 'Casa matriz',
    PaymentGroupCode: 2,
    DiscountPercent: 0,
    AttachmentEntry: null,
    DocumentLines: [linea(0), linea(1, { Quantity: 1, UnitPrice: 5000 })],
    U_SII_Estado: 'PENDIENTE',
    ...extra,
  };
}

export const facturaAfecta = (): DocumentoB1 => base({});

export const facturaExenta = (): DocumentoB1 =>
  base({
    DocEntry: 101,
    DocumentLines: [
      linea(0, { TaxCode: 'IVA_EXE', TaxPercentagePerRow: 0 }),
      linea(1, { TaxCode: 'EXE', TaxPercentagePerRow: 0 }),
    ],
  });

export const facturaMixta = (): DocumentoB1 =>
  base({
    DocEntry: 102,
    DocumentLines: [linea(0), linea(1, { TaxCode: 'IVA_EXE', TaxPercentagePerRow: 0 })],
  });

export const facturaConDescuentoCabecera = (): DocumentoB1 =>
  base({
    DocEntry: 103,
    DiscountPercent: 10,
    PaymentGroupCode: -1,
    DocumentLines: [linea(0, { DiscountPercent: 5 }), linea(1, { TaxCode: 'IVA_EXE', TaxPercentagePerRow: 0 })],
  });

export const boleta = (): DocumentoB1 =>
  base({
    DocEntry: 104,
    CardCode: 'C99999',
    U_SII_TipoDTE: '39',
    DocumentLines: [linea(0, { Quantity: 1, UnitPrice: 8403.36, PriceAfterVAT: 10000 })],
  });

export const socioConsumidorFinal = (): SocioB1 => ({ CardCode: 'C99999', CardName: 'Cliente contado', LicTradNum: null });

export function notaCredito(extra: Partial<DocumentoB1> = {}): DocumentoB1 {
  return base({
    DocEntry: 200,
    U_SII_CodRef: '1',
    U_SII_RazonRef: 'Anula factura por error de precio',
    DocumentLines: [linea(0, { BaseType: 13, BaseEntry: 100, BaseLine: 0 })],
    ...extra,
  });
}

export const baseConFolio = (): BaseInfo => ({ objType: 13, docEntry: 100, docDate: '2026-03-10', folio: 4521, tipoDte: 33 });
export const baseSinFolio = (): BaseInfo => ({ objType: 13, docEntry: 100, docDate: '2026-03-10', folio: null, tipoDte: null });

export const guia = (extra: Partial<DocumentoB1> = {}): DocumentoB1 =>
  base({
    DocEntry: 300,
    U_SII_IndTraslado: '1',
    U_SII_Transporte: 'Patente ABCD-12; chofer Juan Perez; destino Bodega Pudahuel',
    DocumentLines: [linea(0, { Quantity: 5 })],
    ...extra,
  });

/** Guía con los datos de transporte mínimos de una categoría autogestionada (Res. Ex. SII 144/2026). */
export const guiaConTraslado = (extra: Partial<DocumentoB1> = {}): DocumentoB1 =>
  guia({
    U_SII_CatTraslado: 'AUTOGESTIONADO',
    U_SII_RutTrans: '76.543.210-3',
    U_SII_RutChofer: '11.222.333-9',
    U_SII_NomChofer: 'Juan Pérez Soto',
    U_SII_Patente: 'BCDF12',
    U_SII_FchSalida: '2026-11-23T00:00:00',
    AddressExtension: { ShipToStreet: 'Los Leones', ShipToStreetNo: '99', ShipToCounty: 'Ñuñoa', ShipToCity: 'Santiago' },
    ...extra,
  });

/** Socio extranjero: `LicTradNum` es su identificador tributario en el país de origen. */
export const socioExtranjero = (extra: Record<string, unknown> = {}): SocioB1 => ({
  CardCode: 'C30000',
  CardName: 'ACME IMPORT INC',
  LicTradNum: 'US-12-3456789',
  EmailAddress: 'buyer@acme.example.com',
  BPAddresses: [{ AddressName: 'HQ', AddressType: 'bo_BillTo', Street: '350 Fifth Avenue', City: 'New York', County: '' }],
  ...extra,
});

/** Factura de exportación en USD (bienes) con los UDF de Aduana completos. */
export const facturaExportacion = (extra: Partial<DocumentoB1> = {}): DocumentoB1 =>
  base({
    DocEntry: 400,
    CardCode: 'C30000',
    CardName: 'ACME IMPORT INC',
    PayToCode: 'HQ',
    U_SII_TipoDTE: '110',
    DocCurrency: 'USD',
    DocRate: 925.4567,
    DocTotalFC: 7192.83,
    DocumentLines: [
      linea(0, { Quantity: 100, UnitPrice: 45.5, PriceAfterVAT: null, TaxCode: 'EXE', TaxPercentagePerRow: 0, Currency: 'USD', MeasureUnit: 'CJ' }),
      linea(1, { Quantity: 50.5, UnitPrice: 52.3333, PriceAfterVAT: null, TaxCode: 'EXE', TaxPercentagePerRow: 0, Currency: 'USD', MeasureUnit: 'CJ' }),
    ],
    U_SII_ModVenta: '1',
    U_SII_ClausulaVenta: '5',
    U_SII_ViaTransp: '1',
    U_SII_PtoEmbarque: '905',
    U_SII_PtoDesemb: '134',
    U_SII_PaisReceptor: '225',
    U_SII_PaisDestino: '225',
    U_SII_TotBultos: 151,
    U_SII_TipoBulto: '10',
    U_SII_FormaPagoExp: '11',
    ...extra,
  });

export const baseExportacionConFolio = (): BaseInfo => ({ objType: 13, docEntry: 400, docDate: '2026-03-10', folio: 12, tipoDte: 110 });
