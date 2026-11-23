import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';
import { Caf } from '../../folios/entities/caf.entity.js';

export type EstadoDocumento =
  | 'emitido'
  | 'encolado'
  | 'enviado'
  | 'aceptado'
  | 'aceptado_con_reparos'
  | 'rechazado'
  | 'anulado';

/** bigint llega como string desde pg; este transformer lo expone como number. */
const bigintNumero = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('documentos')
@Unique('uq_documentos_empresa_tipo_folio', ['empresaId', 'tipoDte', 'folio'])
@Index(
  'uq_documentos_empresa_idempotencia',
  ['empresaId', 'claveIdempotencia'],
  { unique: true, where: '"clave_idempotencia" IS NOT NULL' },
)
@Index('idx_documentos_empresa_estado', ['empresaId', 'estado'])
@Index('idx_documentos_empresa_traslado_pendiente', ['empresaId'], { where: '"traslado_pendiente"' })
export class Documento {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ name: 'caf_id', type: 'uuid', nullable: true })
  cafId: string | null;

  @ManyToOne(() => Caf, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'caf_id' })
  caf?: Caf | null;

  @Column({ name: 'tipo_dte', type: 'smallint' })
  tipoDte: number;

  @Column({ type: 'int' })
  folio: number;

  @Column({ name: 'fecha_emision', type: 'date' })
  fechaEmision: string;

  @Column({ name: 'rut_receptor', type: 'int', nullable: true })
  rutReceptor: number | null;

  @Column({ name: 'dv_receptor', type: 'char', length: 1, nullable: true })
  dvReceptor: string | null;

  @Column({
    name: 'razon_social_receptor',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  razonSocialReceptor: string | null;

  @Column({
    name: 'monto_neto',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumero,
  })
  montoNeto: number | null;

  @Column({
    name: 'monto_exento',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumero,
  })
  montoExento: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: bigintNumero })
  iva: number | null;

  @Column({ name: 'monto_total', type: 'bigint', transformer: bigintNumero })
  montoTotal: number;

  @Column({
    type: 'enum',
    enum: [
      'emitido',
      'encolado',
      'enviado',
      'aceptado',
      'aceptado_con_reparos',
      'rechazado',
      'anulado',
    ],
    enumName: 'estado_documento_enum',
  })
  estado: EstadoDocumento;

  @Column({ name: 'track_id', type: 'varchar', length: 20, nullable: true })
  trackId: string | null;

  @Column({ name: 'xml_firmado', type: 'text' })
  xmlFirmado: string;

  @Column({ type: 'text' })
  ted: string;

  @Column({ type: 'jsonb', nullable: true })
  reparos: unknown;

  @Column({
    name: 'clave_idempotencia',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  claveIdempotencia: string | null;

  /** SHA-256 (hex) de la solicitud de emisión; detecta reuso de la clave de idempotencia con otro cuerpo. */
  @Column({
    name: 'huella_solicitud',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  huellaSolicitud: string | null;

  /** Último código de estado devuelto por el SII para el documento (DOK, FAU, FNA, ...). */
  @Column({ name: 'estado_sii', type: 'varchar', length: 10, nullable: true })
  estadoSii: string | null;

  @Column({ name: 'glosa_sii', type: 'text', nullable: true })
  glosaSii: string | null;

  @Column({ name: 'consultado_sii_en', type: 'timestamptz', nullable: true })
  consultadoSiiEn: Date | null;

  /** Resumen de la última respuesta de estado del SII. */
  @Column({ name: 'respuesta_estado_sii', type: 'jsonb', nullable: true })
  respuestaEstadoSii: unknown;

  /**
   * Res. Ex. SII 144/2026: traslado normalizado del documento (categoría, origen/destino, chofer, patentes,
   * fechas, estado de cada campo) y la `solicitud` original de emisión (para complementar o corregir con una
   * nueva guía). Null si el documento no informa traslado.
   */
  @Column({ type: 'jsonb', nullable: true })
  traslado: Record<string, unknown> | null;

  /** true si algún dato del traslado quedó "Diferido" o "Sin Dato" y falta complementarlo. */
  @Column({ name: 'traslado_pendiente', type: 'boolean', default: false })
  trasladoPendiente: boolean;

  /** Exportación (110-112): glosa de la moneda de la operación (`DOLAR USA`); null en el resto. Los montos de arriba están en pesos. */
  @Column({ type: 'varchar', length: 15, nullable: true })
  moneda: string | null;

  /** Exportación: pesos chilenos por unidad de moneda. */
  @Column({ name: 'tipo_cambio', type: 'numeric', precision: 10, scale: 4, nullable: true, transformer: bigintNumero })
  tipoCambio: number | null;

  /** Exportación: monto total en la moneda de la operación (hasta 4 decimales). */
  @Column({ name: 'monto_moneda', type: 'numeric', precision: 18, scale: 4, nullable: true, transformer: bigintNumero })
  montoMoneda: number | null;

  /** Metadato opcional para correlacionar con el sistema de origen (p. ej. ERP). */
  @Column({ type: 'jsonb', nullable: true })
  origen: unknown;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
