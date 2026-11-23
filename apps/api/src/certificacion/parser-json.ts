import Joi from 'joi';
import { exportacionSchema } from '../documentos/documentos.dto.js';
import { type CasoSet, ErrorSetPruebas, type SetPruebas } from './tipos.js';

/**
 * Formato JSON equivalente del set de pruebas (alternativa fiable al texto del SII):
 *
 * ```json
 * {
 *   "numeroAtencion": "4321",
 *   "casos": [
 *     { "id": "4321-1", "tipoDte": 33,
 *       "items": [{ "nombre": "Cajón AFECTO", "cantidad": 224, "precioUnitario": 4617, "descuentoPorcentaje": 10 }],
 *       "descuentoGlobalPorcentaje": 5 },
 *     { "id": "4321-2", "tipoDte": 61,
 *       "items": [{ "nombre": "Cajón AFECTO", "cantidad": 224, "precioUnitario": 4617 }],
 *       "referencias": [{ "caso": "4321-1", "codRef": 1, "razonRef": "ANULA FACTURA" }] }
 *   ]
 * }
 * ```
 *
 * Set de exportación (110/111/112): agregue `exportacion` (mismo bloque que la API de emisión: `moneda`, `tipoCambio`,
 * `extranjero`, `aduana`, ...), `receptorExtranjero` y, si es un servicio, `indServicio` (3 a 6). Los precios de
 * `items` van en la moneda de la operación y las notas referencian el caso de la factura con `referencias[].caso`:
 *
 * ```json
 * { "id": "4321-9", "tipoDte": 110,
 *   "receptorExtranjero": { "razonSocial": "ACME IMPORT INC", "direccion": "350 Fifth Avenue, New York" },
 *   "exportacion": { "moneda": "DOLAR USA", "tipoCambio": 925.45, "extranjero": { "nacionalidad": 225 },
 *                    "aduana": { "codigoModalidadVenta": 1, "codigoClausulaVenta": 5, "totalClausulaVenta": 4550,
 *                                "codigoViaTransporte": 1, "codigoPuertoEmbarque": 905, "codigoPuertoDesembarque": 134,
 *                                "totalBultos": 100, "codigoPaisReceptor": 225, "codigoPaisDestino": 225 } },
 *   "items": [{ "nombre": "Vino Cabernet Sauvignon", "cantidad": 100, "precioUnitario": 45.5 }] }
 * ```
 */
const esquema = Joi.object({
  numeroAtencion: Joi.alternatives().try(Joi.string(), Joi.number()),
  casos: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .pattern(/^\d+-\d+$/)
          .required(),
        tipoDte: Joi.number().valid(33, 34, 39, 41, 52, 56, 61, 110, 111, 112).required(),
        items: Joi.array()
          .items(
            Joi.object({
              nombre: Joi.string().required(),
              cantidad: Joi.number().positive().required(),
              precioUnitario: Joi.number().min(0).required(),
              descuentoPorcentaje: Joi.number().min(0).max(100),
              descuentoMonto: Joi.number().min(0),
              unidad: Joi.string(),
              exento: Joi.boolean(),
            }),
          )
          .default([]),
        descuentoGlobalPorcentaje: Joi.number().min(0).max(100),
        referencias: Joi.array()
          .items(
            Joi.object({
              caso: Joi.string().pattern(/^\d+-\d+$/),
              tipoDocRef: Joi.string().max(3),
              folioRef: Joi.alternatives().try(Joi.string(), Joi.number()),
              codRef: Joi.number().valid(1, 2, 3),
              razonRef: Joi.string().max(90),
            }),
          )
          .default([]),
        indTraslado: Joi.number().integer().min(1).max(9),
        exportacion: exportacionSchema,
        receptorExtranjero: Joi.object({ razonSocial: Joi.string().required(), direccion: Joi.string().required(), giro: Joi.string() }),
        indServicio: Joi.number().valid(3, 4, 5, 6),
      }),
    )
    .min(1)
    .required(),
});

export function parsearSetJson(texto: string): SetPruebas {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch (e) {
    throw new ErrorSetPruebas(`JSON inválido: ${(e as Error).message}`);
  }
  const { value, error } = esquema.validate(crudo, { abortEarly: false });
  if (error) throw new ErrorSetPruebas(`Set JSON inválido: ${error.message}`);
  const v = value as {
    numeroAtencion?: string | number;
    casos: Array<Omit<CasoSet, 'numero' | 'notas'>>;
  };
  return {
    numeroAtencion: v.numeroAtencion === undefined ? undefined : String(v.numeroAtencion),
    advertencias: [],
    casos: v.casos.map((c) => ({
      ...c,
      numero: Number(c.id.split('-')[1]),
      notas: [],
    })),
  };
}
