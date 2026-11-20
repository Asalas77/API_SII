import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CertificadosModule } from './certificados/certificados.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentosModule } from './documentos/documentos.module.js';
import { EmpresasModule } from './empresas/empresas.module.js';
import { EnviosModule } from './envios/envios.module.js';
import { FoliosModule } from './folios/folios.module.js';
import { HealthModule } from './health/health.module.js';
import { LibrosModule } from './libros/libros.module.js';
import { SeguridadModule } from './seguridad/seguridad.module.js';
import { SiiModule } from './sii/sii.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    EmpresasModule,
    CertificadosModule,
    FoliosModule,
    DocumentosModule,
    EnviosModule,
    LibrosModule,
    SeguridadModule,
    SiiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
