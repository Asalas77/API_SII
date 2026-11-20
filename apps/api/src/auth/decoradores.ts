import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Permiso } from './permisos.js';
import type { Principal } from './principal.js';

export const PUBLICO_KEY = 'auth:publico';
export const PERMISOS_KEY = 'auth:permisos';

/** Endpoint sin autenticación (GET /, /health). */
export const Publico = () => SetMetadata(PUBLICO_KEY, true);

/** Exige TODOS los permisos listados. Sin este decorador (y sin `@Publico`) el endpoint se deniega. */
export const RequierePermisos = (...permisos: Permiso[]) =>
  SetMetadata(PERMISOS_KEY, permisos);

export type RequestConPrincipal = Request & { principal?: Principal };

/** Principal autenticado de la petición (lo deja `AuthGuard`). */
export const PrincipalActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<RequestConPrincipal>().principal;
    if (!principal) throw new Error('Petición sin principal: ¿falta AuthGuard?');
    return principal;
  },
);
