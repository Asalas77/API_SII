import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ProblemaHttp } from '../comun/problema.js';
import { authConfig } from '../config/auth.config.js';
import { igualesEnTiempoConstante } from './api-key.js';
import { ApiKeysService } from './api-keys.service.js';
import { PUBLICO_KEY, type RequestConPrincipal } from './decoradores.js';
import { TODOS_LOS_PERMISOS } from './permisos.js';
import type { Principal } from './principal.js';

const noAutenticado = (detalle: string) =>
  new ProblemaHttp(401, 'NO_AUTENTICADO', 'No autenticado', detalle);

/** Extrae la credencial de `Authorization: Bearer` o `X-API-Key`. */
export function extraerCredencial(req: RequestConPrincipal): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const x = req.headers['x-api-key'];
  const valor = Array.isArray(x) ? x[0] : x;
  return valor?.trim() || undefined;
}

/** Guard global: autentica y deja `request.principal`. Los endpoints `@Publico()` pasan sin credencial. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly claves: ApiKeysService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean | undefined>(PUBLICO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publico) return true;

    const req = context.switchToHttp().getRequest<RequestConPrincipal>();
    const credencial = extraerCredencial(req);
    if (!credencial) {
      throw noAutenticado(
        'Falta la credencial: envíe "Authorization: Bearer <clave>" o "X-API-Key: <clave>"',
      );
    }

    const principal = await this.autenticar(credencial);
    if (!principal) {
      throw noAutenticado('La credencial es inválida, fue revocada o expiró');
    }
    req.principal = principal;
    return true;
  }

  private async autenticar(credencial: string): Promise<Principal | undefined> {
    const admin = this.config.adminKey;
    if (admin && igualesEnTiempoConstante(credencial, admin)) {
      return {
        tipo: 'admin',
        permisos: TODOS_LOS_PERMISOS,
        todasLasEmpresas: true,
        empresas: [],
      };
    }
    return this.claves.autenticar(credencial);
  }
}
