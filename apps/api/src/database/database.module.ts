import { Module } from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/index.js';

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
          username: db.username,
          password: db.password,
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
})
export class DatabaseModule {}
