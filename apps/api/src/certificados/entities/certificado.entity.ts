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

/** Certificado digital (PFX) del firmante; PFX y clave cifrados con AES-256-GCM. */
@Entity('certificados')
@Index('idx_certificados_empresa_activo', ['empresaId', 'activo'])
export class Certificado {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ name: 'rut_firmante', type: 'int' })
  rutFirmante: number;

  @Column({ name: 'dv_firmante', type: 'char', length: 1 })
  dvFirmante: string;

  @Column({ name: 'nombre_firmante', type: 'varchar', length: 100 })
  nombreFirmante: string;

  @Column({ name: 'pfx_cifrado', type: 'bytea' })
  pfxCifrado: Buffer;

  @Column({ name: 'password_cifrada', type: 'bytea' })
  passwordCifrada: Buffer;

  @Column({ name: 'valido_desde', type: 'timestamptz' })
  validoDesde: Date;

  @Column({ name: 'valido_hasta', type: 'timestamptz' })
  validoHasta: Date;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;
}
