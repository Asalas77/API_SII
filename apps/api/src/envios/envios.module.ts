import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentosModule } from '../documentos/documentos.module.js';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { SiiModule } from '../sii/sii.module.js';
import { EnvioDocumento } from './entities/envio-documento.entity.js';
import { Envio } from './entities/envio.entity.js';
import { EnviosController } from './envios.controller.js';
import { EnviosService } from './envios.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Envio, EnvioDocumento]),
    DocumentosModule,
    EmpresasModule,
    SiiModule,
  ],
  controllers: [EnviosController],
  providers: [EnviosService],
  exports: [TypeOrmModule, EnviosService],
})
export class EnviosModule {}
