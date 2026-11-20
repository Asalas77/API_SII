import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';
import type { AmbienteSii } from '../../empresas/entities/empresa.entity.js';

export type CanalEnvio = 'dte' | 'boleta';

/** Envío al SII (un sobre EnvioDTE o EnvioBOLETA) con su Track ID. */
@Entity('envios')
@Index('idx_envios_empresa', ['empresaId'])
export class Envio {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({
    type: 'enum',
    enum: ['dte', 'boleta'],
    enumName: 'canal_envio_enum',
  })
  canal: CanalEnvio;

  @Column({
    name: 'ambiente_sii',
    type: 'enum',
    enum: ['certificacion', 'produccion'],
    enumName: 'ambiente_sii_enum',
  })
  ambienteSii: AmbienteSii;

  @Column({ name: 'track_id', type: 'varchar', length: 20, nullable: true })
  trackId: string | null;

  /** Código de estado del SII (REC, EPR, RPR, RCH, ...). */
  @Column({ type: 'varchar', length: 10, nullable: true })
  estado: string | null;

  @Column({
    name: 'glosa_estado',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  glosaEstado: string | null;

  @Column({ name: 'xml_envio', type: 'text', nullable: true })
  xmlEnvio: string | null;

  @Column({ type: 'jsonb', nullable: true })
  respuesta: unknown;

  @Column({ type: 'int', default: 0 })
  intentos: number;

  @Column({ name: 'enviado_en', type: 'timestamptz', nullable: true })
  enviadoEn: Date | null;

  @Column({ name: 'consultado_en', type: 'timestamptz', nullable: true })
  consultadoEn: Date | null;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;
}
