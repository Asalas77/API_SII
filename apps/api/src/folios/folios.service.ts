import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { aFechaCalendario } from '../comun/fechas.js';
import { sumarMeses, TIPOS_CAF_CON_VENCIMIENTO } from '../dte-core/index.js';
import { Empresa } from '../empresas/entities/empresa.entity.js';
import { CifradoService } from '../seguridad/cifrado.service.js';
import {
  CafInvalidoError,
  SinFoliosDisponiblesError,
} from './folios.errors.js';
import { Caf } from './entities/caf.entity.js';

export interface DatosCaf {
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  /** Instante o fecha de calendario `yyyy-mm-dd`. */
  fechaAutorizacion: Date | string;
  /**
   * Si no viene se calcula: autorización + 6 meses para los tipos con crédito fiscal
   * (`TIPOS_CAF_CON_VENCIMIENTO`: 33, 56, 61); sin vencimiento (null) para el resto.
   */
  fechaVencimiento?: Date | string;
  /** XML completo del CAF (ya parseado/validado por dte-core). Se guarda cifrado. */
  xml: string;
  /** RUT del emisor declarado en el CAF (`76086428-5`). Si viene, debe coincidir con el de la empresa. */
  rutEmisor?: string;
}

export interface FolioAsignado {
  folio: number;
  cafId: string;
  /** XML del CAF descifrado. */
  xmlCaf: string;
}

export interface ResumenCaf {
  cafId: string;
  tipoDte: number;
  folioDesde: number;
  folioHasta: number;
  folioSiguiente: number;
  disponibles: number;
  fechaVencimiento: string | null;
  vencido: boolean;
  agotado: boolean;
  anulado: boolean;
}

/**
 * Fecha de calendario `yyyy-mm-dd` (zona `America/Santiago`) de un instante: el formato de las
 * columnas `date`. No depende de la zona horaria del servidor.
 */
export function aFechaSql(fecha: Date): string {
  return aFechaCalendario(fecha);
}

/** Vencimiento por defecto de un CAF (`yyyy-mm-dd`) o null si el tipo no vence. */
export function calcularVencimientoCaf(
  tipoDte: number,
  fechaAutorizacion: string,
): string | null {
  if (!(TIPOS_CAF_CON_VENCIMIENTO as readonly number[]).includes(tipoDte)) {
    return null;
  }
  return sumarMeses(fechaAutorizacion, 6).toISOString().slice(0, 10);
}

@Injectable()
export class FoliosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cifrado: CifradoService,
  ) {}

  /**
   * Registra un CAF; rechaza rangos solapados con otro CAF no anulado y, si se informa
   * `rutEmisor`, un CAF cuyo RUT no es el de la empresa. El XML se guarda cifrado.
   */
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
    const fechaAutorizacion = aFechaCalendario(caf.fechaAutorizacion);
    const fechaVencimiento = caf.fechaVencimiento
      ? aFechaCalendario(caf.fechaVencimiento)
      : calcularVencimientoCaf(caf.tipoDte, fechaAutorizacion);

    return this.dataSource.transaction(async (em) => {
      if (caf.rutEmisor !== undefined) {
        const empresa = await em.findOne(Empresa, { where: { id: empresaId } });
        if (!empresa) {
          throw new CafInvalidoError(`Empresa inexistente: ${empresaId}`);
        }
        const rutEmpresa = `${empresa.rut}-${empresa.dv}`.toUpperCase();
        if (caf.rutEmisor.trim().toUpperCase() !== rutEmpresa) {
          throw new CafInvalidoError(
            `El CAF pertenece al RUT ${caf.rutEmisor} y la empresa es ${rutEmpresa}`,
          );
        }
      }

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
          fechaAutorizacion,
          fechaVencimiento,
          xml: null,
          xmlCifrado: this.cifrado.cifrar(Buffer.from(caf.xml, 'utf8')),
          agotado: false,
          anulado: false,
        }),
      );
    });
  }

  /**
   * Entrega el siguiente folio del CAF vigente más antiguo con folios libres.
   * Bloquea (FOR UPDATE) los CAF candidatos, por lo que dos llamadas concurrentes nunca reciben el
   * mismo folio.
   *
   * Transacción: sin `manager` abre y confirma la suya (el folio se consume apenas retorna). Con
   * `manager` participa en la transacción del llamador: si ésta se revierte (p. ej. falla la
   * construcción o el guardado del documento) el folio NO se consume. Así lo usa la emisión.
   *
   * Se bloquean todos los candidatos (sin LIMIT) y se usa el primero: con
   * `FOR UPDATE ... LIMIT 1`, si el CAF bloqueado se agota mientras otra
   * transacción espera, Postgres re-evalúa el WHERE sobre esa fila y devolvería
   * cero filas aunque exista otro CAF. Sin LIMIT el orden de bloqueo es estable
   * (evita deadlocks) y ese caso queda cubierto.
   *
   * @param fecha fecha contra la que se evalúa la vigencia del CAF (instante o `yyyy-mm-dd`), por
   * defecto hoy en `America/Santiago`.
   */
  async asignarSiguienteFolio(
    empresaId: string,
    tipoDte: number,
    fecha: Date | string = new Date(),
    manager?: EntityManager,
  ): Promise<FolioAsignado> {
    const hoy = aFechaCalendario(fecha);
    const ejecutar = (em: EntityManager) =>
      this.asignarEn(em, empresaId, tipoDte, hoy);
    return manager ? ejecutar(manager) : this.dataSource.transaction(ejecutar);
  }

  private async asignarEn(
    em: EntityManager,
    empresaId: string,
    tipoDte: number,
    hoy: string,
  ): Promise<FolioAsignado> {
    // Serializa las asignaciones de la misma empresa y tipo hasta el fin de la transacción (que en la
    // emisión incluye guardar el documento): evita el deadlock entre transacciones que bloquean
    // varios CAF y las deja ordenadas. El FOR UPDATE de abajo se mantiene como segunda defensa.
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `folio:${empresaId}:${tipoDte}`,
    ]);
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
    const xmlCaf = await this.xmlDeCaf(em, caf);
    await em.update(
      Caf,
      { id: caf.id },
      { folioSiguiente: siguiente, agotado: siguiente > caf.folioHasta },
    );
    return { folio, cafId: caf.id, xmlCaf };
  }

  /**
   * XML descifrado del CAF. Una fila heredada (XML en claro, anterior al cifrado) se cifra aquí
   * mismo y se borra el texto plano (migración perezosa; ver README de la base de datos).
   */
  private async xmlDeCaf(em: EntityManager, caf: Caf): Promise<string> {
    if (caf.xmlCifrado) {
      return this.cifrado.descifrar(caf.xmlCifrado).toString('utf8');
    }
    if (caf.xml) {
      await em.update(
        Caf,
        { id: caf.id },
        { xmlCifrado: this.cifrado.cifrar(Buffer.from(caf.xml, 'utf8')), xml: null },
      );
      return caf.xml;
    }
    throw new CafInvalidoError(`El CAF ${caf.id} no tiene XML almacenado`);
  }

  /** Cifra de una vez todos los CAF heredados con XML en claro. Devuelve cuántos migró. */
  async cifrarCafsHeredados(): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const heredados = await em
        .createQueryBuilder(Caf, 'caf')
        .where('caf.xml IS NOT NULL')
        .andWhere('caf.xmlCifrado IS NULL')
        .getMany();
      for (const caf of heredados) await this.xmlDeCaf(em, caf);
      return heredados.length;
    });
  }

  /** Resumen de folios por CAF de la empresa; `tipoDte` filtra por tipo si se indica. */
  async foliosDisponibles(
    empresaId: string,
    tipoDte?: number,
  ): Promise<ResumenCaf[]> {
    const hoy = aFechaCalendario(new Date());
    const cafs = await this.dataSource.getRepository(Caf).find({
      where: tipoDte === undefined ? { empresaId } : { empresaId, tipoDte },
      order: { tipoDte: 'ASC', fechaAutorizacion: 'ASC', folioDesde: 'ASC' },
    });
    return cafs.map((c) => {
      const vencido = c.fechaVencimiento !== null && c.fechaVencimiento < hoy;
      return {
        cafId: c.id,
        tipoDte: c.tipoDte,
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
