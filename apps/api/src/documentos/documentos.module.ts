import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { FoliosModule } from '../folios/folios.module.js';
import { SiiModule } from '../sii/sii.module.js';
import {
  DocumentosController,
  EmpresaDocumentosController,
} from './documentos.controller.js';
import { DocumentosService } from './documentos.service.js';
import { EstadoSiiService } from './estado-sii.service.js';
import { Documento } from './entities/documento.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento]),
    EmpresasModule,
    FoliosModule,
    SiiModule,
  ],
  controllers: [EmpresaDocumentosController, DocumentosController],
  providers: [DocumentosService, EstadoSiiService],
  exports: [TypeOrmModule, DocumentosService, EstadoSiiService],
})
export class DocumentosModule {}
