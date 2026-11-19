import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { SeguridadModule } from '../seguridad/seguridad.module.js';
import { CertificadosController } from './certificados.controller.js';
import { CertificadosService } from './certificados.service.js';
import { Certificado } from './entities/certificado.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Certificado]),
    EmpresasModule,
    SeguridadModule,
  ],
  controllers: [CertificadosController],
  providers: [CertificadosService],
  exports: [TypeOrmModule, CertificadosService],
})
export class CertificadosModule {}
