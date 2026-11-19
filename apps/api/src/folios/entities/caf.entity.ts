import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';

/** CAF (Código de Autorización de Folios) y su cursor de asignación. */
@Entity('cafs')
@Unique('uq_cafs_empresa_tipo_desde', ['empresaId', 'tipoDte', 'folioDesde'])
@Index('idx_cafs_empresa_tipo_agotado', ['empresaId', 'tipoDte', 'agotado'])
export class Caf {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ name: 'tipo_dte', type: 'smallint' })
  tipoDte: number;

  @Column({ name: 'folio_desde', type: 'int' })
  folioDesde: number;

  @Column({ name: 'folio_hasta', type: 'int' })
  folioHasta: number;

  /** Próximo folio a entregar; inicia en folio_desde. */
  @Column({ name: 'folio_siguiente', type: 'int' })
  folioSiguiente: number;

  @Column({ name: 'fecha_autorizacion', type: 'date' })
  fechaAutorizacion: string;

  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: string | null;

  /**
   * @deprecated XML del CAF en claro (contiene la clave privada RSASK). Solo existe en filas
   * anteriores a la migración `CifrarCafYEmision`; `FoliosService` lo cifra al leerlo y lo deja en
   * null. Los CAF nuevos nunca lo escriben.
   */
  @Column({ type: 'text', nullable: true })
  xml: string | null;

  /** XML completo del CAF (tal como lo entregó el SII) cifrado con AES-256-GCM (`CifradoService`). */
  @Column({ name: 'xml_cifrado', type: 'bytea', nullable: true })
  xmlCifrado: Buffer | null;

  @Column({ type: 'boolean', default: false })
  agotado: boolean;

  @Column({ type: 'boolean', default: false })
  anulado: boolean;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;
}
