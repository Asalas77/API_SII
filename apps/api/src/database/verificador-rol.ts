import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * Al arrancar comprueba que la API NO se conecta con un rol que se salta RLS (superusuario o
 * BYPASSRLS): en ese caso las políticas no aplican y el aislamiento por empresa quedaría solo en la
 * aplicación. En producción es un error fatal; en otros entornos, un aviso fuerte.
 */
@Injectable()
export class VerificadorRolBd implements OnApplicationBootstrap {
  private readonly logger = new Logger(VerificadorRolBd.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const filas = (await this.dataSource.query(
      `SELECT current_user AS rol, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    )) as Array<{ rol: string; rolsuper: boolean; rolbypassrls: boolean }>;
    const fila = filas[0];
    if (!fila || (!fila.rolsuper && !fila.rolbypassrls)) return;

    const motivo = fila.rolsuper ? 'es SUPERUSUARIO' : 'tiene BYPASSRLS';
    const mensaje =
      `El rol de base de datos "${fila.rol}" ${motivo}: PostgreSQL NO aplica Row Level Security a ` +
      'este rol y el aislamiento por empresa depende solo de la aplicación. Defina ' +
      'DATABASE_APP_USER y DATABASE_APP_PASSWORD (rol de aplicación sin BYPASSRLS, creado por la ' +
      'migración RowLevelSecurity).';
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error(mensaje);
    }
    this.logger.warn(mensaje);
  }
}
