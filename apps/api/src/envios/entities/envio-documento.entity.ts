import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Documento } from '../../documentos/entities/documento.entity.js';
import { Envio } from './envio.entity.js';

/** Relación N:M entre un envío y los documentos que contiene. */
@Entity('envio_documentos')
@Index('idx_envio_documentos_documento', ['documentoId'])
export class EnvioDocumento {
  @PrimaryColumn({ name: 'envio_id', type: 'uuid' })
  envioId: string;

  @PrimaryColumn({ name: 'documento_id', type: 'uuid' })
  documentoId: string;

  @ManyToOne(() => Envio, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'envio_id' })
  envio?: Envio;

  @ManyToOne(() => Documento, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'documento_id' })
  documento?: Documento;

  @Column({ type: 'varchar', length: 10, nullable: true })
  estado: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  glosa: string | null;
}
