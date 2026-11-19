/** Modelo del set de pruebas del SII, independiente del formato de origen (texto del SII o JSON). */

export type TipoCaso = 33 | 34 | 39 | 41 | 52 | 56 | 61;

export interface ItemCaso {
  /** Glosa exacta del caso (el SII exige copiarla tal cual, con acentos y ñ). */
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  /** Descuento del ítem en %. */
  descuentoPorcentaje?: number;
  /** Descuento del ítem en monto. */
  descuentoMonto?: number;
  unidad?: string;
  /** Ítem exento o no afecto. */
  exento?: boolean;
}

export interface ReferenciaCaso {
  /** Caso del mismo set al que se refiere (`4321-1`); se resuelve al folio emitido. */
  caso?: string;
  /** Tipo y folio explícitos cuando no se refiere a un caso del set (p. ej. `801` orden de compra). */
  tipoDocRef?: string;
  folioRef?: string | number;
  /** 1 anula, 2 corrige texto, 3 corrige montos. */
  codRef?: 1 | 2 | 3;
  razonRef?: string;
}

export interface CasoSet {
  /** Identificador del caso tal como lo entrega el SII: `4321-1`. */
  id: string;
  /** Número del caso dentro del set (el sufijo de `id`). */
  numero: number;
  tipoDte: TipoCaso;
  items: ItemCaso[];
  /** Descuento global en % (sobre los ítems afectos). */
  descuentoGlobalPorcentaje?: number;
  referencias: ReferenciaCaso[];
  /** Guías de despacho: indicador de traslado 1..9. */
  indTraslado?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Texto libre del set que no se pudo interpretar (se muestra como advertencia). */
  notas: string[];
}

export interface SetPruebas {
  /** Número de atención del set (`4321`), si viene. */
  numeroAtencion?: string;
  casos: CasoSet[];
  /** Advertencias del parseo (líneas ignoradas, casos incompletos...). */
  advertencias: string[];
}

export class ErrorSetPruebas extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSetPruebas';
  }
}
