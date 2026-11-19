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
