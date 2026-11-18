import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Caf } from './entities/caf.entity.js';
import { FoliosService } from './folios.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Caf])],
  providers: [FoliosService],
  exports: [FoliosService, TypeOrmModule],
})
export class FoliosModule {}
