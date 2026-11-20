import Joi from 'joi';
import { rutSchema } from '../comun/joi.js';
import { normalizarRut } from './principal.js';
import { TODOS_LOS_PERMISOS } from './permisos.js';

export interface CrearApiKeyDto {
  nombre: string;
  permisos: string[];
  empresas?: string[];
  todasLasEmpresas?: boolean;
  expiraEn?: Date;
}

export const crearApiKeySchema = Joi.object<CrearApiKeyDto>({
  nombre: Joi.string().trim().min(1).max(100).required(),
  permisos: Joi.array()
    .items(Joi.string().valid(...TODOS_LOS_PERMISOS))
    .min(1)
    .unique()
    .required()
    .messages({
      'any.only': `permiso desconocido; permisos válidos: ${TODOS_LOS_PERMISOS.join(', ')}`,
    }),
  empresas: Joi.array()
    .items(rutSchema.custom((v: string) => normalizarRut(v) ?? v))
    .max(500),
  todasLasEmpresas: Joi.boolean(),
  expiraEn: Joi.date().iso().greater('now'),
})
  .custom((v: CrearApiKeyDto, helpers) =>
    v.todasLasEmpresas === true || v.empresas !== undefined
      ? v
      : helpers.error('any.invalid'),
  )
  .messages({
    'any.invalid': 'indique "empresas" (puede ser vacía) o "todasLasEmpresas": true',
  });
