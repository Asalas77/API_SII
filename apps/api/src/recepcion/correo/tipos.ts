/**
 * Abstracción del correo (IMAP para recibir, SMTP para responder). La implementación real
 * (`fabrica-correo.real.ts`, imapflow + mailparser + nodemailer) se inyecta con `FABRICA_CORREO`; las
 * pruebas la reemplazan por un doble en memoria, sin red.
 */
export const FABRICA_CORREO = Symbol('FABRICA_CORREO');

export interface ConfigImap {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  /** En claro, solo en memoria. */
  password: string;
  carpeta: string;
}

export interface ConfigSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  password: string;
  /** Dirección `From`. */
  remitente: string;
}

export interface AdjuntoCorreo {
  nombre: string;
  tipo?: string;
  contenido: Buffer;
}

export interface MensajeEntrante {
  /** Identificador estable dentro de la carpeta (UID IMAP). */
  uid: string;
  /** Dirección del remitente (`From`), en minúsculas. */
  remitente: string | null;
  asunto: string;
  /** Solo los adjuntos XML (por nombre `.xml` o tipo `xml`). */
  adjuntos: AdjuntoCorreo[];
}

export interface MensajeSaliente {
  para: string;
  asunto: string;
  texto: string;
  adjuntos: AdjuntoCorreo[];
}

/** Conexión abierta a un buzón IMAP. Siempre debe cerrarse. */
export interface SesionImap {
  /** Mensajes no leídos de la carpeta configurada. */
  listarNoLeidos(): Promise<MensajeEntrante[]>;
  /** Marca como leído y, si `destino` se indica, mueve el mensaje a esa carpeta. */
  marcarProcesado(uid: string, destino?: string | null): Promise<void>;
  cerrar(): Promise<void>;
}

export interface FabricaCorreo {
  abrirImap(config: ConfigImap): Promise<SesionImap>;
  enviar(config: ConfigSmtp, mensaje: MensajeSaliente): Promise<void>;
}
