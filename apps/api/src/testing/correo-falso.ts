/**
 * UTILIDAD DE PRUEBA - NO USAR EN PRODUCCION.
 * Doble en memoria de la fábrica de correo (IMAP/SMTP) del módulo `recepcion`: sin red. Se inyecta con
 * `FABRICA_CORREO` (`.overrideProvider(FABRICA_CORREO).useValue(correoFalso())`).
 */
import type {
  ConfigImap,
  ConfigSmtp,
  FabricaCorreo,
  MensajeEntrante,
  MensajeSaliente,
  SesionImap,
} from '../recepcion/correo/tipos.js';

export interface CorreoFalso extends FabricaCorreo {
  /** Mensajes en la bandeja (leídos o no). */
  bandeja: Array<MensajeEntrante & { leido: boolean; movidoA?: string | null }>;
  /** Correos enviados por SMTP, con la configuración con que se enviaron. */
  enviados: Array<{ config: ConfigSmtp; mensaje: MensajeSaliente }>;
  /** Configuraciones IMAP con las que se abrió sesión. */
  sesiones: ConfigImap[];
  /** Si se define, el próximo `abrirImap` falla con este error. */
  fallarImap?: Error;
  /** Si se define, `enviar` falla con este error. */
  fallarSmtp?: Error;
}

export function crearCorreoFalso(): CorreoFalso {
  const f: CorreoFalso = {
    bandeja: [],
    enviados: [],
    sesiones: [],
    abrirImap: async (config) => {
      if (f.fallarImap) throw f.fallarImap;
      f.sesiones.push(config);
      const sesion: SesionImap = {
        listarNoLeidos: async () => f.bandeja.filter((m) => !m.leido),
        marcarProcesado: async (uid, destino) => {
          const m = f.bandeja.find((x) => x.uid === uid);
          if (m) {
            m.leido = true;
            m.movidoA = destino ?? null;
          }
        },
        cerrar: async () => undefined,
      };
      return sesion;
    },
    enviar: async (config, mensaje) => {
      if (f.fallarSmtp) throw f.fallarSmtp;
      f.enviados.push({ config, mensaje });
    },
  };
  return f;
}
