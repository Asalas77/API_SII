import type { EmitirDocumentoDto } from '../documentos/documentos.dto.js';
import { calcularDv } from '../dte-core/index.js';
import { type CasoSet, ErrorSetPruebas, type ItemCaso } from './tipos.js';

/** Lo que se recuerda de cada caso ya emitido, para que las notas puedan referenciarlo. */
export interface CasoEmitido {
  tipoDte: number;
  folio: number;
  fechaEmision: string;
  items: ItemCaso[];
}

export interface ContextoGeneracion {
  fechaEmision: string;
  /** Receptor de la factura (distinto por caso, como exige el SII). Ignorado en boletas. */
  receptor: NonNullable<EmitirDocumentoDto['receptor']>;
  emitidos: ReadonlyMap<string, CasoEmitido>;
}

const BOLETAS = [39, 41];

/**
 * Receptores de prueba válidos y distintos entre sí (el SII pide RUT distintos en las facturas del
 * set). Los RUT son ficticios; el DV se calcula.
 */
export function receptoresDePrueba(cantidad: number): Array<{ rut: string; razonSocial: string }> {
  return Array.from({ length: cantidad }, (_, i) => {
    const cuerpo = 12_345_678 + i * 1_111;
    return {
      rut: `${cuerpo}-${calcularDv(cuerpo)}`,
      razonSocial: `CLIENTE DE PRUEBA ${i + 1} LTDA`,
    };
  });
}

/**
 * Convierte un caso del set en el cuerpo de emisión de la API. La PRIMERA referencia es siempre
 * `SET` / `CASO xxxx-x` (instrucción 6 del SII); las del propio caso (notas) van desde la línea 2.
 */
export function casoADocumento(caso: CasoSet, ctx: ContextoGeneracion): EmitirDocumentoDto {
  const boleta = BOLETAS.includes(caso.tipoDte);
  const referencias: NonNullable<EmitirDocumentoDto['referencias']> = [
    {
      tipoDocRef: 'SET',
      folioRef: caso.numero,
      fechaRef: ctx.fechaEmision,
      razonRef: `CASO ${caso.id}`,
    },
  ];

  let items = caso.items;
  for (const r of caso.referencias) {
    if (r.caso) {
      const origen = ctx.emitidos.get(r.caso);
      if (!origen) {
        throw new ErrorSetPruebas(
          `Caso ${caso.id}: referencia al caso ${r.caso}, que no se ha emitido (¿está antes en el set?)`,
        );
      }
      referencias.push({
        tipoDocRef: String(origen.tipoDte),
        folioRef: origen.folio,
        fechaRef: origen.fechaEmision,
        ...(r.codRef ? { codRef: r.codRef } : {}),
        ...(r.razonRef ? { razonRef: r.razonRef.slice(0, 90) } : {}),
      });
      // Una anulación sin ítems propios repite los del documento anulado.
      if (items.length === 0 && r.codRef === 1) items = origen.items;
    } else if (r.tipoDocRef && r.folioRef !== undefined) {
      referencias.push({
        tipoDocRef: r.tipoDocRef,
        folioRef: r.folioRef,
        fechaRef: ctx.fechaEmision,
        ...(r.codRef ? { codRef: r.codRef } : {}),
        ...(r.razonRef ? { razonRef: r.razonRef.slice(0, 90) } : {}),
      });
    } else if (caso.tipoDte === 56 || caso.tipoDte === 61) {
      throw new ErrorSetPruebas(
        `Caso ${caso.id}: la nota no indica a qué documento se refiere (use "CASO nnnn-n" o el formato JSON)`,
      );
    }
  }

  // Corrección de texto sin ítems: el SII acepta una nota con una línea en monto cero.
  if (items.length === 0 && (caso.tipoDte === 56 || caso.tipoDte === 61)) {
    const razon = caso.referencias.find((r) => r.razonRef)?.razonRef ?? 'Corrección';
    items = [{ nombre: razon.slice(0, 80), cantidad: 1, precioUnitario: 0 }];
  }
  if (items.length === 0) {
    throw new ErrorSetPruebas(`Caso ${caso.id}: no tiene ítems`);
  }

  return {
    idDoc: {
      tipoDte: caso.tipoDte,
      fechaEmision: ctx.fechaEmision,
      ...(boleta ? {} : { formaPago: 1 as const }),
      ...(caso.tipoDte === 52 ? { indTraslado: caso.indTraslado ?? 1 } : {}),
    },
    ...(boleta ? {} : { receptor: ctx.receptor }),
    detalle: items.map((i) => ({
      nombre: i.nombre,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      ...(i.descuentoPorcentaje !== undefined ? { descuentoPorcentaje: i.descuentoPorcentaje } : {}),
      ...(i.descuentoMonto !== undefined ? { descuentoMonto: i.descuentoMonto } : {}),
      ...(i.unidad ? { unidad: i.unidad } : {}),
      ...(i.exento && caso.tipoDte !== 34 && caso.tipoDte !== 41 ? { exento: true } : {}),
    })),
    ...(caso.descuentoGlobalPorcentaje !== undefined
      ? {
          descuentosRecargos: [
            {
              tipo: 'D' as const,
              tipoValor: '%' as const,
              valor: caso.descuentoGlobalPorcentaje,
              glosa: 'Descuento global',
            },
          ],
        }
      : {}),
    referencias,
  };
}
