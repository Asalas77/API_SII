import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmpresasModule } from '../empresas/empresas.module.js';
import { SeguridadModule } from '../seguridad/seguridad.module.js';
import { SiiModule } from '../sii/sii.module.js';
import { BuzonService } from './correo/buzon.service.js';
import { FabricaCorreoReal } from './correo/fabrica-correo.real.js';
import { SondeoBuzonService } from './correo/sondeo-buzon.service.js';
import { FABRICA_CORREO } from './correo/tipos.js';
import { BuzonCorreo } from './entities/buzon-correo.entity.js';
import { DteRecibido } from './entities/dte-recibido.entity.js';
import { EnvioRecibido } from './entities/envio-recibido.entity.js';
import {
  DteRecibidosController,
  EmpresaRecepcionController,
  EnviosRecibidosController,
} from './recepcion.controller.js';
import { RecepcionService } from './recepcion.service.js';
import { RegistroSiiService } from './registro-sii.service.js';
import { RespuestasService } from './respuestas.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([EnvioRecibido, DteRecibido, BuzonCorreo]),
    EmpresasModule,
    SiiModule,
    SeguridadModule,
  ],
  controllers: [EmpresaRecepcionController, EnviosRecibidosController, DteRecibidosController],
  providers: [
    RecepcionService,
    RespuestasService,
    RegistroSiiService,
    BuzonService,
    SondeoBuzonService,
    // Los e2e reemplazan este proveedor por un doble en memoria (sin red).
    { provide: FABRICA_CORREO, useClass: FabricaCorreoReal },
  ],
  exports: [TypeOrmModule, RecepcionService],
})
export class RecepcionModule {}
