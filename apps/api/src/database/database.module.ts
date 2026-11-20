import { Global, Module } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/index.js';
import { ContextoEmpresaInterceptor } from './contexto-empresa.interceptor.js';
import { EjecutorEmpresa } from './ejecutor-empresa.js';
import { VerificadorRolBd } from './verificador-rol.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db =
          config.getOrThrow<ConfigType<typeof databaseConfig>>('database');
        return {
          type: 'postgres' as const,
          host: db.host,
          port: db.port,
          // En runtime la API usa el rol de aplicación (sujeto a RLS) si está configurado; las
          // migraciones (CLI) siguen usando DATABASE_USER, el dueño del esquema.
          username: db.appUsername ?? db.username,
          password: db.appUsername ? db.appPassword : db.password,
          database: db.database,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          autoLoadEntities: true,
          synchronize: false,
          // Funciona tanto desde src (.ts) como desde dist (.js).
          migrations: [`${import.meta.dirname}/migrations/*{.ts,.js}`],
          migrationsRun: false,
        };
      },
    }),
  ],
  providers: [
    EjecutorEmpresa,
    VerificadorRolBd,
    // Fija el contexto de empresa (AsyncLocalStorage) a partir del principal, tras los guards.
    { provide: APP_INTERCEPTOR, useClass: ContextoEmpresaInterceptor },
  ],
  exports: [EjecutorEmpresa],
})
export class DatabaseModule {}
