import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  CONTEXTO_SISTEMA,
  type ContextoEmpresa,
  ContextoEmpresaFaltanteError,
  conTransaccion,
  contextoVigente,
  esRutNormalizado,
} from './contexto-empresa.js';

export interface OpcionesEjecucion {
  /**
   * RUT normalizados que se SUMAN al contexto solo durante esta ejecución. Único uso legítimo: crear
   * una empresa (la fila nueva aún no está en el alcance de la key y el WITH CHECK la rechazaría).
   */
  ampliarRuts?: readonly string[];
}

/**
 * Único camino para tocar tablas con RLS. Abre (o reutiliza) una transacción, fija en ella el
 * contexto de empresa con `set_config(..., is_local = true)` y ejecuta `work` con el
 * `EntityManager` de esa transacción. El contexto sale de AsyncLocalStorage (lo fija un interceptor
 * global a partir del principal) y, si falta, se lanza `ContextoEmpresaFaltanteError`: nunca se
 * devuelve vacío en silencio.
 *
 * Por qué una transacción corta por operación y no un QueryRunner por petición: una petición
 * puede pasar segundos descifrando el PFX, generando PDF o esperando al SII; retener una conexión
 * del pool todo ese tiempo la agotaría. Con transacciones cortas la conexión se libera apenas
 * termina cada bloque, y `set_config` local a la transacción hace imposible que el contexto se
 * filtre a la siguiente petición que reciba esa conexión del pool.
 */
@Injectable()
export class EjecutorEmpresa {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ejecuta `work` bajo el contexto de la petición actual. Si ya hay una transacción en curso
   * (p. ej. emisión: folio + documento) la reutiliza, sin abrir otra.
   */
  async ejecutar<T>(
    work: (em: EntityManager) => Promise<T>,
    opciones: OpcionesEjecucion = {},
  ): Promise<T> {
    const vigente = contextoVigente();
    if (!vigente) throw new ContextoEmpresaFaltanteError();
    const contexto = ampliar(vigente, opciones.ampliarRuts);

    if (vigente.manager) {
      if (contexto === vigente) return work(vigente.manager);
      // Ampliación dentro de una transacción ajena: se amplía y se restaura el contexto original.
      await aplicarContexto(vigente.manager, contexto);
      try {
        return await work(vigente.manager);
      } finally {
        await aplicarContexto(vigente.manager, vigente).catch(() => undefined);
      }
    }

    return this.transaccion(contexto, work);
  }

  /**
   * Como `ejecutar` pero con el contexto "sistema" (todas las empresas), ignorando el de la petición.
   * Para CLI y procesos internos de confianza; nunca lo invoque desde código que atiende peticiones.
   */
  ejecutarComoSistema<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.transaccion(CONTEXTO_SISTEMA, work);
  }

  /**
   * Fija el contexto vigente en una transacción abierta por el llamador (no por este ejecutor) y
   * ejecuta `work` en ella. Falla si el manager no está en una transacción.
   */
  async ejecutarEn<T>(
    manager: EntityManager,
    work: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    const vigente = contextoVigente();
    if (!vigente) throw new ContextoEmpresaFaltanteError();
    if (vigente.manager === manager) return work(manager);
    await aplicarContexto(manager, vigente);
    return work(manager);
  }

  private transaccion<T>(
    contexto: ContextoEmpresa,
    work: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (em) => {
      await aplicarContexto(em, contexto);
      return conTransaccion(contexto, em, () => work(em));
    });
  }
}

function ampliar(
  base: ContextoEmpresa,
  extra: readonly string[] | undefined,
): ContextoEmpresa {
  if (!extra || extra.length === 0 || base.todasLasEmpresas) return base;
  const nuevos = extra.filter(esRutNormalizado);
  return { todasLasEmpresas: false, ruts: [...new Set([...base.ruts, ...nuevos])] };
}

/**
 * Fija el contexto en la transacción del manager. `is_local = true` es obligatorio: el valor muere
 * con el COMMIT/ROLLBACK y no puede pasar a otra petición por la conexión del pool.
 */
export async function aplicarContexto(
  em: EntityManager,
  contexto: ContextoEmpresa,
): Promise<void> {
  if (!em.queryRunner?.isTransactionActive) {
    throw new Error('El contexto de empresa solo puede fijarse dentro de una transacción');
  }
  await em.query(
    `SELECT set_config('app.todas_empresas', $1, true), set_config('app.empresas', $2, true)`,
    [contexto.todasLasEmpresas ? 'on' : 'off', contexto.ruts.filter(esRutNormalizado).join(',')],
  );
}
