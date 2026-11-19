import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { SeguridadModule } from '../seguridad/seguridad.module.js';
import { Caf } from './entities/caf.entity.js';
import { FoliosController } from './folios.controller.js';
import { FoliosService } from './folios.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Caf]), SeguridadModule, EmpresasModule],
  controllers: [FoliosController],
  providers: [FoliosService],
  exports: [FoliosService, TypeOrmModule],
})
export class FoliosModule {}
