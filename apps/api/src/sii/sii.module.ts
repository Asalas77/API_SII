import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { SeguridadModule } from '../seguridad/seguridad.module.js';
import { SiiClienteFactory } from './sii-cliente.factory.js';
import { SII_FETCH } from './tokens.js';

@Module({
  imports: [TypeOrmModule.forFeature([Certificado]), SeguridadModule],
  providers: [
    // Resuelve `globalThis.fetch` en cada llamada (respeta una sustitución posterior). Los e2e lo
    // reemplazan con `.overrideProvider(SII_FETCH).useValue(falso)`.
    {
      provide: SII_FETCH,
      useValue: (url: string, init?: RequestInit) =>
        globalThis.fetch(url, init),
    },
    SiiClienteFactory,
  ],
  exports: [SiiClienteFactory, SII_FETCH],
})
export class SiiModule {}
