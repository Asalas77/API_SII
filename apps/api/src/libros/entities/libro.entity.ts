import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';
import type { AmbienteSii } from '../../empresas/entities/empresa.entity.js';

/** VENTA y COMPRA son los dos IECV (`LibroCompraVenta`); GUIA es el Libro de Guías de Despacho. */
export type TipoOperacionLibroDb = 'VENTA' | 'COMPRA' | 'GUIA';

const numeroBigint = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

/** Libro electrónico generado (firmado) para una empresa y, si se envió, su Track ID y estado en el SII. */
@Entity('libros')
@Index('idx_libros_empresa_periodo', ['empresaId', 'periodo'])
export class Libro {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ name: 'tipo_operacion', type: 'varchar', length: 6 })
  tipoOperacion: TipoOperacionLibroDb;

  @Column({ name: 'tipo_libro', type: 'varchar', length: 10 })
  tipoLibro: string;

  @Column({ name: 'tipo_envio', type: 'varchar', length: 7 })
  tipoEnvio: string;

  /** `AAAA-MM`. */
  @Column({ type: 'varchar', length: 7 })
  periodo: string;

  @Column({ name: 'folio_notificacion', type: 'bigint', nullable: true, transformer: numeroBigint })
  folioNotificacion: number | null;

  @Column({ name: 'nro_segmento', type: 'int', nullable: true })
  nroSegmento: number | null;

  @Column({
    name: 'ambiente_sii',
    type: 'enum',
    enum: ['certificacion', 'produccion'],
    enumName: 'ambiente_sii_enum',
  })
  ambienteSii: AmbienteSii;

  /** Libro firmado (sin declaración XML; se entrega en ISO-8859-1 al descargarlo o enviarlo). */
  @Column({ name: 'xml_libro', type: 'text' })
  xmlLibro: string;

  /** Totales por tipo de documento (resumen del período o del segmento). */
  @Column({ type: 'jsonb', nullable: true })
  resumen: unknown;

  @Column({ name: 'cantidad_documentos', type: 'int', default: 0 })
  cantidadDocumentos: number;

  @Column({ name: 'track_id', type: 'varchar', length: 20, nullable: true })
  trackId: string | null;

  /** Código de estado del SII (REC, EPR, RCH, ...) o `ERR` si el envío falló. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  estado: string | null;

  @Column({ name: 'glosa_estado', type: 'varchar', length: 200, nullable: true })
  glosaEstado: string | null;

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

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
