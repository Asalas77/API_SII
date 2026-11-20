import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';
import type { AccesoEmpresas } from '../auth/principal.js';

/**
 * Alcance de empresas con el que se accede a la base de datos. Es lo que las políticas RLS ven a
 * través de las variables de transacción `app.todas_empresas` / `app.empresas`.
 */
export interface ContextoEmpresa {
  readonly todasLasEmpresas: boolean;
  /** RUT normalizados (`76086428-5`); se ignora si `todasLasEmpresas`. */
  readonly ruts: readonly string[];
}

/** Lo que guarda el AsyncLocalStorage: el contexto y, si hay una, la transacción en curso. */
interface Almacen extends ContextoEmpresa {
  readonly manager?: EntityManager;
}

const almacenamiento = new AsyncLocalStorage<Almacen>();

/**
 * Contexto "sistema": todas las empresas. Solo para procesos internos y de confianza (CLI de
 * certificación, fixtures de tests). Nunca debe construirse a partir de una petición.
 */
export const CONTEXTO_SISTEMA: ContextoEmpresa = Object.freeze({
  todasLasEmpresas: true,
  ruts: Object.freeze([]) as readonly string[],
});

/** Un RUT normalizado válido para viajar en la lista separada por comas del GUC. */
const RUT_NORMALIZADO = /^\d{1,9}-[\dK]$/;

export function esRutNormalizado(rut: string): boolean {
  return RUT_NORMALIZADO.test(rut);
}

/** Contexto equivalente al alcance de un principal (descarta valores que no sean RUT normalizados). */
export function contextoDeAcceso(acceso: AccesoEmpresas): ContextoEmpresa {
  return {
    todasLasEmpresas: acceso.todasLasEmpresas,
    ruts: acceso.todasLasEmpresas ? [] : acceso.empresas.filter(esRutNormalizado),
  };
}

/** Ejecuta `fn` (y todo lo que dispare, también asíncrono) con ese contexto. */
export function conContextoEmpresa<T>(contexto: ContextoEmpresa, fn: () => T): T {
  return almacenamiento.run(
    { todasLasEmpresas: contexto.todasLasEmpresas, ruts: [...contexto.ruts] },
    fn,
  );
}

/** Atajo de `conContextoEmpresa(CONTEXTO_SISTEMA, fn)`. */
export function comoSistema<T>(fn: () => T): T {
  return conContextoEmpresa(CONTEXTO_SISTEMA, fn);
}

/** Contexto vigente (`undefined` fuera de una petición autenticada o de `conContextoEmpresa`). */
export function contextoVigente(): Almacen | undefined {
  return almacenamiento.getStore();
}

/** Ejecuta `fn` con la transacción `manager` registrada como la vigente (para reutilizarla). */
export function conTransaccion<T>(
  contexto: ContextoEmpresa,
  manager: EntityManager,
  fn: () => T,
): T {
  return almacenamiento.run(
    { todasLasEmpresas: contexto.todasLasEmpresas, ruts: [...contexto.ruts], manager },
    fn,
  );
}

/** Se intentó acceder a tablas con RLS sin un contexto de empresa: es un error de programación. */
export class ContextoEmpresaFaltanteError extends Error {
  constructor() {
    super(
      'Acceso a tablas con RLS sin contexto de empresa. Use EjecutorEmpresa dentro de una petición ' +
        'autenticada, o conContextoEmpresa()/ejecutarComoSistema() en procesos internos.',
    );
    this.name = 'ContextoEmpresaFaltanteError';
  }
}
