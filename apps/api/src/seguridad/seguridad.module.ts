import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { seguridadConfig } from '../config/seguridad.config.js';
import { CifradoService } from './cifrado.service.js';

@Module({
  imports: [ConfigModule.forFeature(seguridadConfig)],
  providers: [CifradoService],
  exports: [CifradoService],
})
export class SeguridadModule {}
