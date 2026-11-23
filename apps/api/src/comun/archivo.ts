/** Archivo subido por multipart (memoria). Evita depender de `@types/multer`. */
export interface ArchivoSubido {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Límite de tamaño de las subidas (PFX y CAF pesan pocos KB). */
export const LIMITE_ARCHIVO_BYTES = 1024 * 1024;

/** Límite de la recepción de DTE (un `EnvioDTE` con muchos documentos pesa algunos MB). Solo para `POST .../recepcion`. */
export const LIMITE_RECEPCION_BYTES = 5 * 1024 * 1024;
