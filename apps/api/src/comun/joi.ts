import Joi from 'joi';
import { validarRut } from '../dte-core/index.js';

/** RUT con DV válido, `76086428-5` (admite puntos; se normaliza a la forma sin puntos). */
export const rutSchema = Joi.string()
  .trim()
  .custom((valor: string, helpers) =>
    validarRut(valor)
      ? valor.replace(/\./g, '').toUpperCase()
      : helpers.error('any.invalid'),
  )
  .messages({
    'any.invalid':
      'RUT inválido (formato 12345678-5 con dígito verificador correcto)',
  });

/** Fecha de calendario `yyyy-mm-dd`. */
export const fechaSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((v: string, helpers) =>
    Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      ? helpers.error('any.invalid')
      : v,
  )
  .messages({
    'string.pattern.base': 'debe tener formato yyyy-mm-dd',
    'any.invalid': 'fecha inexistente',
  });
