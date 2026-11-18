import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AmbienteSii } from './config/index.js';

export interface InfoApi {
  nombre: string;
  version: string;
  ambienteSii: AmbienteSii;
}

// Funciona igual desde src/ y desde dist/ (ambos cuelgan de la raíz del paquete).
const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
) as { version: string };

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  getInfo(): InfoApi {
    return {
      nombre: 'api-sii',
      version,
      ambienteSii: this.config.getOrThrow<AmbienteSii>('sii.ambiente'),
    };
  }
}
