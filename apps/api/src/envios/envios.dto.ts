import Joi from 'joi';

/** Cuerpo de `POST /v1/empresas/{rut}/envios`: ids explícitos (en ese orden) o todos los pendientes de un tipo. */
export interface CrearEnvioDto {
  documentoIds?: string[];
  tipo?: 33 | 34 | 39 | 41 | 52 | 56 | 61;
  pendientes?: boolean;
}

export const crearEnvioSchema = Joi.object<CrearEnvioDto>({
  documentoIds: Joi.array().items(Joi.string().uuid()).min(1).max(2000).unique(),
  tipo: Joi.number().valid(33, 34, 39, 41, 52, 56, 61),
  pendientes: Joi.boolean().valid(true),
})
  .xor('documentoIds', 'pendientes')
  .with('pendientes', 'tipo')
  .without('documentoIds', 'tipo')
  .messages({
    'object.xor': 'indique documentoIds, o bien tipo con pendientes=true',
    'object.missing': 'indique documentoIds, o bien tipo con pendientes=true',
  });
