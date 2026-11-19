import Joi from 'joi';
import { fechaSchema, rutSchema } from '../comun/joi.js';
import type { AmbienteSii } from './entities/empresa.entity.js';

export interface CrearEmpresaDto {
  rut: string;
  razonSocial: string;
  giro: string;
  actecos: number[];
  direccion: string;
  comuna: string;
  ciudad: string;
  codigoSucursalSii?: string;
  telefono?: string;
  correoIntercambio?: string;
  nroResolucionSii?: number;
  fechaResolucionSii?: string;
  ambienteSii?: AmbienteSii;
  proveedorSoftware?: { rut: string } | null;
}

export type ActualizarEmpresaDto = Partial<Omit<CrearEmpresaDto, 'rut'>>;

const campos = {
  razonSocial: Joi.string().trim().max(100),
  giro: Joi.string().trim().max(80),
  actecos: Joi.array()
    .items(Joi.number().integer().min(1).max(999999))
    .min(1)
    .max(4),
  direccion: Joi.string().trim().max(70),
  comuna: Joi.string().trim().max(20),
  ciudad: Joi.string().trim().max(20),
  codigoSucursalSii: Joi.string().trim().max(20).allow(null),
  telefono: Joi.string().trim().max(20).allow(null),
  correoIntercambio: Joi.string().trim().email().max(80).allow(null),
  nroResolucionSii: Joi.number().integer().min(0).allow(null),
  fechaResolucionSii: fechaSchema.allow(null),
  ambienteSii: Joi.string().valid('certificacion', 'produccion'),
  proveedorSoftware: Joi.object({ rut: rutSchema.required() }).allow(null),
};

export const crearEmpresaSchema = Joi.object<CrearEmpresaDto>({
  rut: rutSchema.required(),
  razonSocial: campos.razonSocial.required(),
  giro: campos.giro.required(),
  actecos: campos.actecos.required(),
  direccion: campos.direccion.required(),
  comuna: campos.comuna.required(),
  ciudad: campos.ciudad.required(),
  codigoSucursalSii: campos.codigoSucursalSii,
  telefono: campos.telefono,
  correoIntercambio: campos.correoIntercambio,
  nroResolucionSii: campos.nroResolucionSii,
  fechaResolucionSii: campos.fechaResolucionSii,
  ambienteSii: campos.ambienteSii,
  proveedorSoftware: campos.proveedorSoftware,
});

export const actualizarEmpresaSchema = Joi.object<ActualizarEmpresaDto>(
  campos,
).min(1);
