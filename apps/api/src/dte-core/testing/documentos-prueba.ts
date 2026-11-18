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
