import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { EmpresasController } from './empresas.controller.js';
import { EmpresasService } from './empresas.service.js';
import { Empresa } from './entities/empresa.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, Certificado])],
  controllers: [EmpresasController],
  providers: [EmpresasService],
  exports: [TypeOrmModule, EmpresasService],
})
export class EmpresasModule {}
