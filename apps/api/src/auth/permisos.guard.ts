import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProblemaHttp } from '../comun/problema.js';
import {
  PERMISOS_KEY,
  PUBLICO_KEY,
  type RequestConPrincipal,
} from './decoradores.js';
import type { Permiso } from './permisos.js';
import { asegurarAccesoEmpresa } from './principal.js';

const prohibido = (detalle: string) =>
  new ProblemaHttp(403, 'NO_AUTORIZADO', 'No autorizado', detalle);

/**
 * Guard global (tras `AuthGuard`): exige los permisos de `@RequierePermisos` y, en rutas con `:rut`,
 * que el principal tenga acceso a esa empresa. Fail-closed: un endpoint no público sin permisos
 * declarados se deniega.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const objetivos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLICO_KEY, objetivos)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestConPrincipal>();
    const principal = req.principal;
    if (!principal) {
      throw prohibido('Petición sin autenticar');
    }

    const requeridos = this.reflector.getAllAndOverride<Permiso[] | undefined>(
      PERMISOS_KEY,
      objetivos,
    );
    if (!requeridos || requeridos.length === 0) {
      throw prohibido('El endpoint no declara permisos: acceso denegado');
    }
    const faltantes = requeridos.filter((p) => !principal.permisos.includes(p));
    if (faltantes.length > 0) {
      throw prohibido(`Faltan permisos: ${faltantes.join(', ')}`);
    }

    const rut = (req.params as Record<string, string | undefined> | undefined)?.rut;
    if (rut !== undefined) asegurarAccesoEmpresa(principal, rut);
    return true;
  }
}
