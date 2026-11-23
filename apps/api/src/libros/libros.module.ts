import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento } from '../documentos/entities/documento.entity.js';
import { DteRecibido } from '../recepcion/entities/dte-recibido.entity.js';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { SiiModule } from '../sii/sii.module.js';
import { Libro } from './entities/libro.entity.js';
import { EmpresaLibrosController, LibrosController } from './libros.controller.js';
import { LibrosService } from './libros.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Libro, Documento, DteRecibido]), EmpresasModule, SiiModule],
  controllers: [EmpresaLibrosController, LibrosController],
  providers: [LibrosService],
  exports: [TypeOrmModule, LibrosService],
})
export class LibrosModule {}
