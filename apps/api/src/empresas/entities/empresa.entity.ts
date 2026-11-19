import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type AmbienteSii = 'certificacion' | 'produccion';

/** Contribuyente emisor de DTE (tenant del sistema). */
@Entity('empresas')
@Unique('uq_empresas_rut', ['rut'])
export class Empresa {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ type: 'int' })
  rut: number;

  @Column({ type: 'char', length: 1 })
  dv: string;

  @Column({ name: 'razon_social', type: 'varchar', length: 100 })
  razonSocial: string;

  @Column({ type: 'varchar', length: 80 })
  giro: string;

  /** Codigos de actividad economica (ACTECO). */
  @Column({ type: 'int', array: true })
  actecos: number[];

  @Column({ type: 'varchar', length: 70 })
  direccion: string;

  @Column({ type: 'varchar', length: 20 })
  comuna: string;

  @Column({ type: 'varchar', length: 20 })
  ciudad: string;

  @Column({
    name: 'codigo_sucursal_sii',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  codigoSucursalSii: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefono: string | null;

  @Column({
    name: 'correo_intercambio',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  correoIntercambio: string | null;

  @Column({ name: 'nro_resolucion_sii', type: 'int', nullable: true })
  nroResolucionSii: number | null;

  @Column({ name: 'fecha_resolucion_sii', type: 'date', nullable: true })
  fechaResolucionSii: string | null;

  /** Proveedor de software (RUTProvSW de las boletas): cuerpo del RUT y DV; ambos o ninguno. */
  @Column({ name: 'rut_proveedor_software', type: 'int', nullable: true })
  rutProveedorSoftware: number | null;

  @Column({
    name: 'dv_proveedor_software',
    type: 'char',
    length: 1,
    nullable: true,
  })
  dvProveedorSoftware: string | null;

  @Column({
    name: 'ambiente_sii',
    type: 'enum',
    enum: ['certificacion', 'produccion'],
    enumName: 'ambiente_sii_enum',
    default: 'certificacion',
  })
  ambienteSii: AmbienteSii;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
