import { ProblemaHttp, noEncontrado } from '../comun/problema.js';
import { separarRut } from '../dte-core/index.js';
import type { Permiso } from './permisos.js';

/** Quién hace la petición, tras autenticarse. */
export interface Principal {
  tipo: 'admin' | 'api_key';
  apiKeyId?: string;
  permisos: readonly Permiso[];
  todasLasEmpresas: boolean;
  /** RUT normalizados (`76086428-5`); se ignora si `todasLasEmpresas`. */
  empresas: readonly string[];
}

/** Lo mínimo que hace falta para decidir acceso a una empresa. */
export type AccesoEmpresas = Pick<Principal, 'todasLasEmpresas' | 'empresas'>;

/** `76.086.428-5` o `76086428-5` -> `76086428-5` (DV en mayúscula); `undefined` si no es un RUT. */
export function normalizarRut(rut: string): string | undefined {
  const r = separarRut(rut);
  return r ? `${Number(r.numero)}-${r.dv}` : undefined;
}

/** ¿Puede el principal operar sobre la empresa de ese RUT? Un RUT ilegible nunca es accesible. */
export function tieneAccesoEmpresa(acceso: AccesoEmpresas, rut: string): boolean {
  if (acceso.todasLasEmpresas) return true;
  const n = normalizarRut(rut);
  return n !== undefined && acceso.empresas.includes(n);
}

/** 403 si el principal no tiene acceso a la empresa (rutas con `:rut`). */
export function asegurarAccesoEmpresa(acceso: AccesoEmpresas, rut: string): void {
  if (!tieneAccesoEmpresa(acceso, rut)) {
    throw new ProblemaHttp(
      403,
      'NO_AUTORIZADO',
      'No autorizado',
      'La credencial no tiene acceso a esta empresa',
    );
  }
}

/**
 * 404 (no revela que existe) si el recurso pertenece a una empresa a la que el principal no accede.
 * `rutEmpresa` es el RUT de la empresa dueña del recurso.
 */
export function asegurarRecursoDeEmpresa(
  acceso: AccesoEmpresas,
  rutEmpresa: string,
  que: string,
  id: string,
): void {
  if (!tieneAccesoEmpresa(acceso, rutEmpresa)) throw noEncontrado(que, id);
}

/** Acceso de `a` incluye todo lo de `b`: usado para evitar escalada al crear/gestionar API keys. */
export function contieneAcceso(
  a: Pick<Principal, 'permisos' | 'todasLasEmpresas' | 'empresas'>,
  b: Pick<Principal, 'permisos' | 'todasLasEmpresas' | 'empresas'>,
): boolean {
  if (!b.permisos.every((p) => a.permisos.includes(p))) return false;
  if (a.todasLasEmpresas) return true;
  if (b.todasLasEmpresas) return false;
  return b.empresas.every((e) => a.empresas.includes(e));
}
