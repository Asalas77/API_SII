import Joi from 'joi';
import { rutSchema } from '../comun/joi.js';

const periodo = Joi.string()
  .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
  .messages({ 'string.pattern.base': 'debe tener formato AAAA-MM' });

const correo = Joi.string().trim().email({ tlds: { allow: false } }).max(254);

export const ESTADOS_COMERCIALES = ['pendiente', 'aceptado', 'aceptado_con_reparos', 'rechazado'] as const;

/* ------------------------------------------------------------------ ingreso */

export interface RecepcionCamposDto {
  /** Correo del emisor al que se responde (si se pide `enviarCorreo`). */
  remitente?: string;
  enviarCorreo?: boolean;
}

export const recepcionCamposSchema = Joi.object<RecepcionCamposDto>({
  remitente: correo,
  enviarCorreo: Joi.boolean(),
});

/* ------------------------------------------------------------------ consulta */

export interface FiltroDteRecibidosQuery {
  periodo?: string;
  estado?: (typeof ESTADOS_COMERCIALES)[number];
  rutEmisor?: string;
  pagina?: number;
  porPagina?: number;
}

export const filtroDteRecibidosSchema = Joi.object<FiltroDteRecibidosQuery>({
  periodo,
  estado: Joi.string().valid(...ESTADOS_COMERCIALES),
  rutEmisor: rutSchema,
  pagina: Joi.number().integer().min(1).default(1),
  porPagina: Joi.number().integer().min(1).max(200).default(50),
});

export interface PaginacionQuery {
  pagina?: number;
  porPagina?: number;
}

export const paginacionSchema = Joi.object<PaginacionQuery>({
  pagina: Joi.number().integer().min(1).default(1),
  porPagina: Joi.number().integer().min(1).max(200).default(50),
});

/* ------------------------------------------------------------------ respuesta comercial */

interface RespuestaBaseDto {
  /** Envía la respuesta por SMTP (requiere buzón con SMTP configurado). */
  enviarCorreo?: boolean;
  /** Destino del correo; por defecto el remitente del envío recibido. */
  destinatario?: string;
}

export interface AceptarDto extends RespuestaBaseDto {
  /** Acepta con discrepancias (`EstadoDTE` 1); exige `glosa`. */
  reparos?: boolean;
  glosa?: string;
}

export interface RechazarDto extends RespuestaBaseDto {
  /** Motivo del rechazo (obligatorio: Ley 19.983). */
  glosa: string;
  /** `CodRchDsc`: entero negativo de hasta 3 dígitos. */
  codigoRechazo?: number;
}

export interface ReciboMercaderiasDto extends RespuestaBaseDto {
  recinto: string;
  /** RUT de quien firma el recibo (titular del certificado). */
  rutFirma: string;
}

const respuestaBase = {
  enviarCorreo: Joi.boolean(),
  destinatario: correo,
};

export const aceptarSchema = Joi.object<AceptarDto>({
  ...respuestaBase,
  reparos: Joi.boolean(),
  glosa: Joi.string().trim().min(1).max(256),
}).custom((v: AceptarDto, helpers) =>
  v.reparos && !v.glosa ? helpers.message({ custom: 'glosa es obligatoria al aceptar con reparos' }) : v,
);

export const rechazarSchema = Joi.object<RechazarDto>({
  ...respuestaBase,
  glosa: Joi.string().trim().min(1).max(256).required(),
  codigoRechazo: Joi.number().integer().min(-999).max(-1),
});

export const reciboMercaderiasSchema = Joi.object<ReciboMercaderiasDto>({
  ...respuestaBase,
  recinto: Joi.string().trim().min(1).max(80).required(),
  rutFirma: rutSchema.required(),
});

/* ------------------------------------------------------------------ registro SII */

export const ACCIONES_SII = ['ACD', 'RCD', 'ERM', 'RFP', 'RFT'] as const;
export type AccionSiiDto = (typeof ACCIONES_SII)[number];

export interface RegistrarSiiDto {
  accion: AccionSiiDto;
}

export const registrarSiiSchema = Joi.object<RegistrarSiiDto>({
  accion: Joi.string()
    .valid(...ACCIONES_SII)
    .required(),
});

/* ------------------------------------------------------------------ buzón de correo */

export interface ConfigurarBuzonDto {
  activo?: boolean;
  imapHost: string;
  imapPuerto?: number;
  imapSeguro?: boolean;
  usuario: string;
  /** Obligatoria al crear; al actualizar, si se omite se conserva la guardada. */
  password?: string;
  carpeta?: string;
  carpetaProcesados?: string | null;
  smtpHost?: string | null;
  smtpPuerto?: number | null;
  smtpSeguro?: boolean;
  smtpUsuario?: string | null;
  smtpPassword?: string | null;
  smtpRemitente?: string | null;
  intervaloSegundos?: number;
}

const host = Joi.string().trim().hostname().max(200);
const puerto = Joi.number().integer().min(1).max(65535);

export const configurarBuzonSchema = Joi.object<ConfigurarBuzonDto>({
  activo: Joi.boolean(),
  imapHost: host.required(),
  imapPuerto: puerto,
  imapSeguro: Joi.boolean(),
  usuario: Joi.string().trim().min(1).max(200).required(),
  password: Joi.string().min(1).max(500),
  carpeta: Joi.string().trim().min(1).max(200),
  carpetaProcesados: Joi.string().trim().min(1).max(200).allow(null),
  smtpHost: host.allow(null),
  smtpPuerto: puerto.allow(null),
  smtpSeguro: Joi.boolean(),
  smtpUsuario: Joi.string().trim().min(1).max(200).allow(null),
  smtpPassword: Joi.string().min(1).max(500).allow(null),
  smtpRemitente: correo.allow(null),
  intervaloSegundos: Joi.number().integer().min(60).max(86_400),
});
