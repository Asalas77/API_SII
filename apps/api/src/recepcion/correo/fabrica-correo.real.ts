import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type {
  ConfigImap,
  ConfigSmtp,
  FabricaCorreo,
  MensajeEntrante,
  MensajeSaliente,
  SesionImap,
} from './tipos.js';

/** Tope por mensaje: un EnvioDTE con muchos documentos pesa pocos MB; el resto no es intercambio. */
const MAX_BYTES_MENSAJE = 12 * 1024 * 1024;

function esAdjuntoXml(nombre: string | undefined, tipo: string | undefined): boolean {
  return /\.xml$/i.test(nombre ?? '') || /xml/i.test(tipo ?? '');
}

class SesionImapReal implements SesionImap {
  constructor(
    private readonly cliente: ImapFlow,
    private readonly carpeta: string,
  ) {}

  async listarNoLeidos(): Promise<MensajeEntrante[]> {
    const candado = await this.cliente.getMailboxLock(this.carpeta);
    try {
      const uids = (await this.cliente.search({ seen: false }, { uid: true })) || [];
      const mensajes: MensajeEntrante[] = [];
      for (const uid of uids) {
        const m = await this.cliente.fetchOne(String(uid), { source: true, size: true }, { uid: true });
        if (!m || !m.source) continue;
        if (m.source.length > MAX_BYTES_MENSAJE) {
          // Demasiado grande para ser un envío de intercambio: se marca leído para no reintentarlo siempre.
          mensajes.push({ uid: String(uid), remitente: null, asunto: '(mensaje demasiado grande)', adjuntos: [] });
          continue;
        }
        const parsed = await simpleParser(m.source);
        mensajes.push({
          uid: String(uid),
          remitente: parsed.from?.value[0]?.address?.toLowerCase() ?? null,
          asunto: parsed.subject ?? '',
          adjuntos: parsed.attachments
            .filter((a) => esAdjuntoXml(a.filename, a.contentType))
            .map((a) => ({ nombre: a.filename ?? 'envio.xml', tipo: a.contentType, contenido: a.content })),
        });
      }
      return mensajes;
    } finally {
      candado.release();
    }
  }

  async marcarProcesado(uid: string, destino?: string | null): Promise<void> {
    const candado = await this.cliente.getMailboxLock(this.carpeta);
    try {
      await this.cliente.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      if (destino) await this.cliente.messageMove(uid, destino, { uid: true });
    } finally {
      candado.release();
    }
  }

  async cerrar(): Promise<void> {
    await this.cliente.logout().catch(() => undefined);
  }
}

/** Correo real: IMAP con `imapflow`, análisis MIME con `mailparser` y SMTP con `nodemailer`. */
@Injectable()
export class FabricaCorreoReal implements FabricaCorreo {
  async abrirImap(config: ConfigImap): Promise<SesionImap> {
    const cliente = new ImapFlow({
      host: config.host,
      port: config.puerto,
      secure: config.seguro,
      auth: { user: config.usuario, pass: config.password },
      logger: false,
    });
    // Sin este manejador un error de socket tras conectar tumba el proceso.
    cliente.on('error', () => undefined);
    await cliente.connect();
    return new SesionImapReal(cliente, config.carpeta);
  }

  async enviar(config: ConfigSmtp, mensaje: MensajeSaliente): Promise<void> {
    const transporte = nodemailer.createTransport({
      host: config.host,
      port: config.puerto,
      secure: config.seguro,
      auth: { user: config.usuario, pass: config.password },
    });
    try {
      await transporte.sendMail({
        from: config.remitente,
        to: mensaje.para,
        subject: mensaje.asunto,
        text: mensaje.texto,
        attachments: mensaje.adjuntos.map((a) => ({
          filename: a.nombre,
          content: a.contenido,
          contentType: a.tipo ?? 'application/xml',
        })),
      });
    } finally {
      transporte.close();
    }
  }
}
