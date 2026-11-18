import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { seguridadConfig } from '../config/seguridad.config.js';

const VERSION = 1;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_CLAVE = 32;

/**
 * Cifrado simétrico AES-256-GCM con la clave maestra (CERTIFICADOS_MASTER_KEY).
 * Formato del blob: versión(1) | iv(12) | tag(16) | ciphertext.
 */
@Injectable()
export class CifradoService {
  private readonly clave: Buffer;

  constructor(
    @Inject(seguridadConfig.KEY)
    config: ConfigType<typeof seguridadConfig>,
  ) {
    this.clave = config.certificadosMasterKey;
    if (this.clave.length !== LARGO_CLAVE) {
      throw new Error(
        'CERTIFICADOS_MASTER_KEY debe ser una clave de 32 bytes en base64',
      );
    }
  }

  cifrar(plano: Buffer): Buffer {
    const iv = randomBytes(LARGO_IV);
    const cipher = createCipheriv('aes-256-gcm', this.clave, iv);
    const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
    return Buffer.concat([
      Buffer.from([VERSION]),
      iv,
      cipher.getAuthTag(),
      cifrado,
    ]);
  }

  descifrar(cifrado: Buffer): Buffer {
    if (cifrado.length < 1 + LARGO_IV + LARGO_TAG) {
      throw new Error('Blob cifrado inválido: demasiado corto');
    }
    if (cifrado[0] !== VERSION) {
      throw new Error(`Versión de cifrado no soportada: ${cifrado[0]}`);
    }
    const iv = cifrado.subarray(1, 1 + LARGO_IV);
    const tag = cifrado.subarray(1 + LARGO_IV, 1 + LARGO_IV + LARGO_TAG);
    const datos = cifrado.subarray(1 + LARGO_IV + LARGO_TAG);
    const decipher = createDecipheriv('aes-256-gcm', this.clave, iv);
    decipher.setAuthTag(tag);
    // final() lanza si el tag no coincide (blob alterado o clave distinta).
    return Buffer.concat([decipher.update(datos), decipher.final()]);
  }
}
