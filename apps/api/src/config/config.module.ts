import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  appConfig,
  authConfig,
  databaseConfig,
  envValidationSchema,
  seguridadConfig,
  siiConfig,
} from './index.js';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      envFilePath: ['.env', '.env.local'],
      load: [appConfig, databaseConfig, siiConfig, seguridadConfig, authConfig],
    }),
  ],
})
export class ConfigModule {}
