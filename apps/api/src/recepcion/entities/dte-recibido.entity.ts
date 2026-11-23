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
import { EnvioRecibido } from './envio-recibido.entity.js';

export type EstadoComercialDte = 'pendiente' | 'aceptado' | 'aceptado_con_reparos' | 'rechazado';

/** Correspondencia con `EstadoDTE` de `RespuestaEnvioDTE` (`pendiente` aún no tiene código). */
export const CODIGO_ESTADO_COMERCIAL: Record<Exclude<EstadoComercialDte, 'pendiente'>, 0 | 1 | 2> = {
  aceptado: 0,
  aceptado_con_reparos: 1,
  rechazado: 2,
};

const numeroBigint = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

export interface EventoRegistroSii {
  accion: string;
  codigo: number;
  descripcion: string;
  exito: boolean;
  en: string;
}

/** Último estado conocido del registro ante el SII (WS RegistroReclamoDTE). */
export interface RegistroSii {
  acciones: EventoRegistroSii[];
  /** Eventos del historial del SII (`listarEventosHistDoc`). */
  eventos?: Array<{ codigo: string; descripcion: string; rutResponsable: string; fecha: string }>;
  consultadoEn?: string;
  cedible?: { codigo: number; descripcion: string; cedible: boolean };
  fechaRecepcionTexto?: string;
}

/** DTE recibido de un proveedor (compra) con su estado comercial y su registro ante el SII. */
@Entity('dte_recibidos')
@Unique('uq_dte_recibidos_documento', ['empresaId', 'rutEmisor', 'tipoDte', 'folio'])
@Index('idx_dte_recibidos_empresa_fecha', ['empresaId', 'fechaEmision'])
@Index('idx_dte_recibidos_envio', ['envioRecibidoId'])
export class DteRecibido {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ name: 'envio_recibido_id', type: 'uuid' })
  envioRecibidoId: string;

  @ManyToOne(() => EnvioRecibido, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'envio_recibido_id' })
  envioRecibido?: EnvioRecibido;

  /** Posición del DTE dentro del `SetDTE`. */
  @Column({ type: 'int', default: 0 })
  indice: number;

  @Column({ name: 'tipo_dte', type: 'smallint' })
  tipoDte: number;

  @Column({ type: 'bigint', transformer: numeroBigint })
  folio: number;

  @Column({ name: 'rut_emisor', type: 'int' })
  rutEmisor: number;

  @Column({ name: 'dv_emisor', type: 'char', length: 1 })
  dvEmisor: string;

  @Column({ name: 'razon_social_emisor', type: 'varchar', length: 100, nullable: true })
  razonSocialEmisor: string | null;

  /** `yyyy-mm-dd`. */
  @Column({ name: 'fecha_emision', type: 'date' })
  fechaEmision: string;

  @Column({ name: 'monto_neto', type: 'bigint', nullable: true, transformer: numeroBigint })
  montoNeto: number | null;

  @Column({ name: 'monto_exento', type: 'bigint', nullable: true, transformer: numeroBigint })
  montoExento: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: numeroBigint })
  iva: number | null;

  @Column({ name: 'monto_total', type: 'bigint', transformer: numeroBigint })
  montoTotal: number;

  @Column({ name: 'otros_impuestos', type: 'jsonb', nullable: true })
  otrosImpuestos: Array<{ codigo: number; tasa: number; monto: number }> | null;

  /** XML del DTE individual, tal cual venía en el sobre (la firma sigue verificando). */
  @Column({ type: 'text' })
  xml: string;

  /** `EstadoRecepDTE`; solo se guardan los DTE recibidos OK (0). */
  @Column({ name: 'estado_recepcion_dte', type: 'smallint', default: 0 })
  estadoRecepcionDte: number;

  @Column({ name: 'estado_comercial', type: 'varchar', length: 25, default: 'pendiente' })
  estadoComercial: EstadoComercialDte;

  /** Glosa de la respuesta comercial (obligatoria al rechazar, Ley 19.983). */
  @Column({ type: 'text', nullable: true })
  glosa: string | null;

  @Column({ name: 'respondido_en', type: 'timestamptz', nullable: true })
  respondidoEn: Date | null;

  @Column({ name: 'xml_resultado_dte', type: 'text', nullable: true })
  xmlResultadoDte: string | null;

  @Column({ name: 'xml_envio_recibos', type: 'text', nullable: true })
  xmlEnvioRecibos: string | null;

  /** Fin del plazo para reclamar o acusar recibo (8 días corridos desde la recepción en el SII). */
  @Column({ name: 'plazo_reclamo_hasta', type: 'timestamptz' })
  plazoReclamoHasta: Date;

  /** `true` si el plazo parte de la fecha real de recepción en el SII; `false` si es la estimación (recepción propia + 8 días). */
  @Column({ name: 'plazo_confirmado_sii', type: 'boolean', default: false })
  plazoConfirmadoSii: boolean;

  @Column({ name: 'fecha_recepcion_sii', type: 'timestamptz', nullable: true })
  fechaRecepcionSii: Date | null;

  @Column({ name: 'acuse_recibo_mercaderias', type: 'boolean', default: false })
  acuseReciboMercaderias: boolean;

  @Column({ name: 'registro_sii', type: 'jsonb', nullable: true })
  registroSii: RegistroSii | null;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
