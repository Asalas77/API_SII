/**
 * UTILIDADES DE PRUEBA - NO USAR EN PRODUCCION.
 * Datos ficticios para probar los constructores de documentos (emisor, receptor, CAF por tipo).
 */
import { parsearCaf, type Caf } from '../caf/caf.js';
import type { DocumentoDte, TipoDte } from '../documento/tipos.js';
import { generarCafPrueba } from './testing.js';

export const RUT_EMISOR_PRUEBA = '76086428-5';

/** CAF de prueba (par RSA real, FRMA aleatorio) para el emisor de prueba. */
export function cafDePrueba(tipoDte: TipoDte, folioDesde = 1, folioHasta = 100): Caf {
  return parsearCaf(generarCafPrueba({ tipoDte, folioDesde, folioHasta, rutEmisor: RUT_EMISOR_PRUEBA }));
}

/** Documento mínimo y válido para el tipo indicado (una línea de $1.000). */
export function documentoDePrueba(tipoDte: TipoDte, folio = 1): DocumentoDte {
  const boleta = tipoDte === 39 || tipoDte === 41;
  const exento = tipoDte === 34 || tipoDte === 41;
  return {
    idDoc: { tipoDte, folio, fechaEmision: '2026-02-01' },
    emisor: {
      rut: '76086428',
      dv: '5',
      razonSocial: 'EMPRESA DE PRUEBA SPA',
      giro: 'Servicios informáticos',
      ...(boleta ? {} : { actecos: [620200] }),
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      ciudad: 'Santiago',
    },
    receptor: boleta
      ? { rut: '66666666', dv: '6', razonSocial: 'Consumidor final' }
      : {
          rut: '12345678',
          dv: '5',
          razonSocial: 'CLIENTE DE PRUEBA LTDA',
          giro: 'Comercio',
          direccion: 'Calle Falsa 123',
          comuna: 'Santiago',
          ciudad: 'Santiago',
        },
    detalle: [
      {
        nombre: tipoDte === 52 ? 'Traslado de mercadería' : 'Servicio de prueba',
        cantidad: 1,
        precioUnitario: 1000,
        ...(exento ? { exento: true } : {}),
      },
    ],
  };
}

/**
 * Documento de exportación mínimo y válido (110, 111 o 112) en dólares: 2 líneas, receptor extranjero
 * 55555555-5 (Estados Unidos, 225), vía marítima, cláusula FOB, Valparaíso (905) -> New York (134), ambos de la tabla de puertos de Aduana.
 * Las notas (111/112) referencian la factura 110 folio 1.
 */
export function documentoExportacionDePrueba(tipoDte: 110 | 111 | 112 = 110, folio = 1): DocumentoDte {
  const base = documentoDePrueba(33, folio);
  return {
    idDoc: { tipoDte, folio, fechaEmision: '2026-02-01', formaPago: 2, fechaVencimiento: '2026-03-03' },
    emisor: base.emisor,
    receptor: {
      rut: '55555555',
      dv: '5',
      razonSocial: 'ACME IMPORT INC',
      giro: 'Importaciones',
      direccion: '350 Fifth Avenue, New York',
    },
    detalle: [
      { nombre: 'Vino Cabernet Sauvignon caja 6 botellas', cantidad: 100, precioUnitario: 45.5, unidad: 'CJ' },
      { nombre: 'Vino Carmenere caja 6 botellas', cantidad: 50.5, precioUnitario: 52.3333, unidad: 'CJ' },
    ],
    referencias:
      tipoDte === 110
        ? [{ tipoDocRef: '807', folioRef: '2026-123456-7', fechaRef: '2026-02-01', razonRef: 'DUS' }]
        : [{ tipoDocRef: '110', folioRef: 1, fechaRef: '2026-02-01', codRef: tipoDte === 112 ? 3 : 3, razonRef: 'Ajuste de precio' }],
    exportacion: {
      moneda: 'DOLAR USA',
      tipoCambio: 925.4567,
      formaPagoExportacion: 11,
      extranjero: { numId: 'US-12-3456789', nacionalidad: 225 },
      aduana: {
        codigoModalidadVenta: 1,
        codigoClausulaVenta: 5,
        totalClausulaVenta: 7192.83,
        codigoViaTransporte: 1,
        nombreTransporte: 'MN MAERSK LIMA',
        nombreCompaniaTransporte: 'MAERSK LINE',
        booking: 'BKG123456',
        codigoPuertoEmbarque: 905,
        codigoPuertoDesembarque: 134,
        tara: 2200,
        codigoUnidadTara: 6,
        pesoBruto: 1830.5,
        codigoUnidadPesoBruto: 6,
        pesoNeto: 1500.25,
        codigoUnidadPesoNeto: 6,
        totalItems: 2,
        totalBultos: 151,
        bultos: [{ codigoTipo: 10, cantidad: 151, marcas: 'ACME NY' }],
        montoFlete: 450,
        montoSeguro: 35.5,
        codigoPaisReceptor: 225,
        codigoPaisDestino: 225,
      },
    },
  };
}
