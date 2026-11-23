import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity.js';

/** Buzón de intercambio de la empresa: IMAP para recibir y SMTP para responder. Contraseñas siempre cifradas. */
@Entity('buzones_correo')
@Unique('uq_buzones_correo_empresa', ['empresaId'])
export class BuzonCorreo {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @OneToOne(() => Empresa, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'empresa_id' })
  empresa?: Empresa;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'imap_host', type: 'varchar', length: 200 })
  imapHost: string;

  @Column({ name: 'imap_puerto', type: 'int', default: 993 })
  imapPuerto: number;

  @Column({ name: 'imap_seguro', type: 'boolean', default: true })
  imapSeguro: boolean;

  @Column({ type: 'varchar', length: 200 })
  usuario: string;

  /** AES-256-GCM (`CifradoService`). Nunca se devuelve por la API. */
  @Column({ name: 'password_cifrada', type: 'bytea', select: false })
  passwordCifrada: Buffer;

  @Column({ type: 'varchar', length: 200, default: 'INBOX' })
  carpeta: string;

  /** Si se indica, los mensajes procesados se mueven a esta carpeta; si no, solo se marcan como leídos. */
  @Column({ name: 'carpeta_procesados', type: 'varchar', length: 200, nullable: true })
  carpetaProcesados: string | null;

  @Column({ name: 'smtp_host', type: 'varchar', length: 200, nullable: true })
  smtpHost: string | null;

  @Column({ name: 'smtp_puerto', type: 'int', nullable: true })
  smtpPuerto: number | null;

  /** `true` = TLS implícito (puerto 465); `false` = STARTTLS si el servidor lo ofrece. */
  @Column({ name: 'smtp_seguro', type: 'boolean', default: false })
  smtpSeguro: boolean;

  /** Si falta, se usa `usuario`. */
  @Column({ name: 'smtp_usuario', type: 'varchar', length: 200, nullable: true })
  smtpUsuario: string | null;

  /** Si falta, se usa la contraseña IMAP. */
  @Column({ name: 'smtp_password_cifrada', type: 'bytea', nullable: true, select: false })
  smtpPasswordCifrada: Buffer | null;

  /** Dirección `From` de las respuestas (por defecto el correo de intercambio de la empresa o el usuario). */
  @Column({ name: 'smtp_remitente', type: 'varchar', length: 254, nullable: true })
  smtpRemitente: string | null;

  @Column({ name: 'intervalo_segundos', type: 'int', default: 300 })
  intervaloSegundos: number;

  @Column({ name: 'ultimo_sondeo_en', type: 'timestamptz', nullable: true })
  ultimoSondeoEn: Date | null;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
