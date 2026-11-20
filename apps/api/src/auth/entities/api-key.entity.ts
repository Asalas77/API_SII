import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/** Credencial de máquina (worker SAP B1, ERP). Nunca guarda el secreto: solo su hash SHA-256. */
@Entity('api_keys')
@Unique('uq_api_keys_prefijo', ['prefijo'])
export class ApiKey {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  /** Parte visible de la clave (`sk_test_<prefijo>_...`); sirve para buscarla. */
  @Column({ type: 'varchar', length: 16 })
  prefijo: string;

  /** SHA-256 (hex) de la clave completa. */
  @Column({ name: 'hash_clave', type: 'char', length: 64 })
  hashClave: string;

  @Column({ type: 'text', array: true })
  permisos: string[];

  /** RUT normalizados (`76086428-5`) a los que tiene acceso; ignorado si `todasLasEmpresas`. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  empresas: string[];

  @Column({ name: 'todas_las_empresas', type: 'boolean', default: false })
  todasLasEmpresas: boolean;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @Column({ name: 'expira_en', type: 'timestamptz', nullable: true })
  expiraEn: Date | null;

  @Column({ name: 'ultimo_uso_en', type: 'timestamptz', nullable: true })
  ultimoUsoEn: Date | null;

  @CreateDateColumn({ name: 'creada_en', type: 'timestamptz' })
  creadaEn: Date;

  @Column({ name: 'revocada_en', type: 'timestamptz', nullable: true })
  revocadaEn: Date | null;
}
