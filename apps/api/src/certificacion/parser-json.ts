import Joi from 'joi';
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
 */
const esquema = Joi.object({
  numeroAtencion: Joi.alternatives().try(Joi.string(), Joi.number()),
  casos: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .pattern(/^\d+-\d+$/)
          .required(),
        tipoDte: Joi.number().valid(33, 34, 39, 41, 52, 56, 61).required(),
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
