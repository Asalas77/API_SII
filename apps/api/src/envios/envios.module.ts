import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvioDocumento } from './entities/envio-documento.entity.js';
import { Envio } from './entities/envio.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Envio, EnvioDocumento])],
  exports: [TypeOrmModule],
})
export class EnviosModule {}
