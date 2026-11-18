import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Documento])],
  exports: [TypeOrmModule],
})
export class DocumentosModule {}
