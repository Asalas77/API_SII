import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { EmpresasController } from './empresas.controller.js';
import { EmpresasService } from './empresas.service.js';
import { Empresa } from './entities/empresa.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, Certificado]), AuthModule],
  controllers: [EmpresasController],
  providers: [EmpresasService],
  exports: [TypeOrmModule, EmpresasService],
})
export class EmpresasModule {}
