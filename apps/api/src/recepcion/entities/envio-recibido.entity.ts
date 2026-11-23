import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';

export type OrigenEnvioRecibido = 'upload' | 'correo';

/** Resumen por DTE del análisis de un envío (incluye los rechazados, que no se guardan en `dte_recibidos`). */
export interface ResumenDteEnvio {
  indice: number;
  tipoDte: number;
  folio: number;
  fechaEmision: string;
  rutEmisor: string;
  rutReceptor: string;
  montoTotal: number;
  estado: number;
  glosa: string;
  errores: string[];
}

/** `EnvioDTE` recibido de un proveedor: XML original, hash de deduplicación y el acuse generado. */
@Entity('envios_recibidos')
@Unique('uq_envios_recibidos_hash', ['empresaId', 'hashSha256'])
@Index('idx_envios_recibidos_empresa_fecha', ['empresaId', 'recibidoEn'])
export class EnvioRecibido {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ type: 'varchar', length: 10 })
  origen: OrigenEnvioRecibido;

  /** Correo del remitente (origen `correo`) o el indicado al subir el archivo. */
  @Column({ type: 'varchar', length: 254, nullable: true })
  remitente: string | null;

  @Column({ name: 'nombre_archivo', type: 'varchar', length: 200, nullable: true })
  nombreArchivo: string | null;

  /** XML tal cual llegó (sin re-codificar): es lo que se firmó y lo que respalda el hash. */
  @Column({ type: 'bytea' })
  xml: Buffer;

  @Column({ name: 'hash_sha256', type: 'char', length: 64 })
  hashSha256: string;

  /** `CodEnvio` de las respuestas (entero positivo único, de la secuencia `seq_codigo_envio_recibido`). */
  @Column({ name: 'codigo_envio', type: 'int' })
  codigoEnvio: number;

  @Column({ name: 'rut_emisor', type: 'varchar', length: 12, nullable: true })
  rutEmisor: string | null;

  @Column({ name: 'rut_envia', type: 'varchar', length: 12, nullable: true })
  rutEnvia: string | null;

  /** `TmstFirmaEnv` de la carátula. */
  @Column({ name: 'fecha_firma', type: 'timestamptz', nullable: true })
  fechaFirma: Date | null;

  /** `EstadoRecepEnv` (0 recibido conforme, 1 schema, 2 firma, 3 RUT receptor, 90 repetido, 91 ilegible, 99 otros). */
  @Column({ name: 'estado_recepcion', type: 'smallint' })
  estadoRecepcion: number;

  @Column({ type: 'varchar', length: 300 })
  glosa: string;

  /** `RespuestaDTE/RecepcionEnvio` firmado (sin declaración XML); `null` si no se pudo armar. */
  @Column({ name: 'xml_recepcion_envio', type: 'text', nullable: true })
  xmlRecepcionEnvio: string | null;

  @Column({ name: 'resumen_dtes', type: 'jsonb', nullable: true })
  resumenDtes: ResumenDteEnvio[] | null;

  @Column({ name: 'respuesta_enviada_en', type: 'timestamptz', nullable: true })
  respuestaEnviadaEn: Date | null;

  @Column({ name: 'recibido_en', type: 'timestamptz', default: () => 'now()' })
  recibidoEn: Date;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;
}
