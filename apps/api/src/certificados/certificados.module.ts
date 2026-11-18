import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificado } from './entities/certificado.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Certificado])],
  exports: [TypeOrmModule],
})
export class CertificadosModule {}
