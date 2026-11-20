import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { RequestConPrincipal } from '../auth/decoradores.js';
import { conContextoEmpresa, contextoDeAcceso } from './contexto-empresa.js';

/**
 * Interceptor global: tras AuthGuard (los guards corren antes que los interceptores) fija el
 * contexto de empresa de la petición a partir de `request.principal`. Los endpoints `@Publico()` no
 * tienen principal, así que no reciben contexto (y cualquier acceso a tablas con RLS fallaría).
 *
 * El handler corre dentro de `conContextoEmpresa` porque se suscribe al Observable allí mismo:
 * NestJS invoca el controlador (y sus pipes) al suscribirse, y AsyncLocalStorage propaga el
 * contexto por todas las continuaciones asíncronas de esa suscripción.
 */
@Injectable()
export class ContextoEmpresaInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const principal = context.switchToHttp().getRequest<RequestConPrincipal>().principal;
    if (!principal) return next.handle();
    const contexto = contextoDeAcceso(principal);
    return new Observable<unknown>((suscriptor) =>
      conContextoEmpresa(contexto, () => next.handle().subscribe(suscriptor)),
    );
  }
}
