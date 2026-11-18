import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CafInvalidoError,
  SinFoliosDisponiblesError,
} from './folios.errors.js';
import { Caf } from './entities/caf.entity.js';

export interface DatosCaf {
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  fechaAutorizacion: Date;
  fechaVencimiento?: Date;
  /** XML completo del CAF (ya parseado/validado por dte-core). */
  xml: string;
}

export interface FolioAsignado {
  folio: number;
  cafId: string;
  xmlCaf: string;
}

export interface ResumenCaf {
  cafId: string;
  folioDesde: number;
  folioHasta: number;
  folioSiguiente: number;
  disponibles: number;
  fechaVencimiento: string | null;
  vencido: boolean;
  agotado: boolean;
  anulado: boolean;
}

/** Fecha (calendario local) en formato YYYY-MM-DD, el de las columnas `date`. */
export function aFechaSql(fecha: Date): string {
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${m}-${d}`;
}

@Injectable()
export class FoliosService {
  constructor(private readonly dataSource: DataSource) {}

  /** Registra un CAF; rechaza rangos solapados con otro CAF no anulado. */
  async registrarCaf(empresaId: string, caf: DatosCaf): Promise<Caf> {
    if (
      !Number.isInteger(caf.folioDesde) ||
      !Number.isInteger(caf.folioHasta) ||
      caf.folioDesde < 1 ||
      caf.folioHasta < caf.folioDesde
    ) {
      throw new CafInvalidoError(
        `Rango de folios inválido: ${caf.folioDesde}-${caf.folioHasta}`,
      );
    }

    return this.dataSource.transaction(async (em) => {
      // Serializa registros concurrentes de la misma empresa y tipo.
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `caf:${empresaId}:${caf.tipoDte}`,
      ]);

      const solapados = await em
        .createQueryBuilder(Caf, 'caf')
        .where('caf.empresaId = :empresaId', { empresaId })
        .andWhere('caf.tipoDte = :tipoDte', { tipoDte: caf.tipoDte })
        .andWhere('caf.anulado = false')
        .andWhere('caf.folioDesde <= :hasta AND caf.folioHasta >= :desde', {
          desde: caf.folioDesde,
          hasta: caf.folioHasta,
        })
        .getCount();
      if (solapados > 0) {
        throw new CafInvalidoError(
          `El rango ${caf.folioDesde}-${caf.folioHasta} se solapa con otro CAF del tipo ${caf.tipoDte}`,
        );
      }

      return em.save(
        em.create(Caf, {
          empresaId,
          tipoDte: caf.tipoDte,
          folioDesde: caf.folioDesde,
          folioHasta: caf.folioHasta,
          folioSiguiente: caf.folioDesde,
          fechaAutorizacion: aFechaSql(caf.fechaAutorizacion),
          fechaVencimiento: caf.fechaVencimiento
            ? aFechaSql(caf.fechaVencimiento)
            : null,
          xml: caf.xml,
          agotado: false,
          anulado: false,
        }),
      );
    });
  }

  /**
   * Entrega el siguiente folio del CAF vigente más antiguo con folios libres.
   * Corre en una transacción y bloquea (FOR UPDATE) los CAF candidatos, por lo
   * que dos llamadas concurrentes nunca reciben el mismo folio.
   *
   * Se bloquean todos los candidatos (sin LIMIT) y se usa el primero: con
   * `FOR UPDATE ... LIMIT 1`, si el CAF bloqueado se agota mientras otra
   * transacción espera, Postgres re-evalúa el WHERE sobre esa fila y devolvería
   * cero filas aunque exista otro CAF. Sin LIMIT el orden de bloqueo es estable
   * (evita deadlocks) y ese caso queda cubierto.
   */
  async asignarSiguienteFolio(
    empresaId: string,
    tipoDte: number,
    fecha: Date = new Date(),
  ): Promise<FolioAsignado> {
    const hoy = aFechaSql(fecha);
    return this.dataSource.transaction(async (em) => {
      const candidatos = await em
        .createQueryBuilder(Caf, 'caf')
        .setLock('pessimistic_write')
        .where('caf.empresaId = :empresaId', { empresaId })
        .andWhere('caf.tipoDte = :tipoDte', { tipoDte })
        .andWhere('caf.agotado = false')
        .andWhere('caf.anulado = false')
        .andWhere('caf.folioSiguiente <= caf.folioHasta')
        .andWhere(
          '(caf.fechaVencimiento IS NULL OR caf.fechaVencimiento >= :hoy)',
          { hoy },
        )
        .orderBy('caf.fechaAutorizacion', 'ASC')
        .addOrderBy('caf.folioDesde', 'ASC')
        .getMany();

      const caf = candidatos[0];
      if (!caf) throw new SinFoliosDisponiblesError(empresaId, tipoDte);

      const folio = caf.folioSiguiente;
      const siguiente = folio + 1;
      await em.update(
        Caf,
        { id: caf.id },
        { folioSiguiente: siguiente, agotado: siguiente > caf.folioHasta },
      );
      return { folio, cafId: caf.id, xmlCaf: caf.xml };
    });
  }

  /** Resumen de folios por CAF (no anulados) de la empresa y tipo. */
  async foliosDisponibles(
    empresaId: string,
    tipoDte: number,
  ): Promise<ResumenCaf[]> {
    const hoy = aFechaSql(new Date());
    const cafs = await this.dataSource.getRepository(Caf).find({
      where: { empresaId, tipoDte },
      order: { fechaAutorizacion: 'ASC', folioDesde: 'ASC' },
    });
    return cafs.map((c) => {
      const vencido = c.fechaVencimiento !== null && c.fechaVencimiento < hoy;
      return {
        cafId: c.id,
        folioDesde: c.folioDesde,
        folioHasta: c.folioHasta,
        folioSiguiente: c.folioSiguiente,
        disponibles: Math.max(0, c.folioHasta - c.folioSiguiente + 1),
        fechaVencimiento: c.fechaVencimiento,
        vencido,
        agotado: c.agotado,
        anulado: c.anulado,
      };
    });
  }
}
