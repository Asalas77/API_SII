import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';
import { AuthGuard } from './auth.guard.js';
import { ApiKey } from './entities/api-key.entity.js';
import { PermisosGuard } from './permisos.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    // El orden importa: primero autenticar, luego autorizar.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
  ],
  exports: [ApiKeysService],
})
export class AuthModule {}
