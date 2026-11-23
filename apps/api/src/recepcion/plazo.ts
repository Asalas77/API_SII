/**
 * Plazo de reclamo de un DTE recibido (Ley 19.983 modificada por la Ley 20.956): el receptor tiene
 * 8 días corridos, contados desde la fecha-hora de recepción del documento en el SII, para reclamar o
 * acusar recibo; pasado ese plazo el SII no admite más eventos (código 8 del web service) y la mercadería
 * o el servicio se presume recibido.
 */
export const DIAS_PLAZO_RECLAMO = 8;

const MS_DIA = 24 * 60 * 60 * 1000;

/** Fin del plazo: `recepcion` + 8 días corridos (192 horas exactas, igual que el SII mide "desde la fecha-hora"). */
export function calcularPlazoReclamo(recepcion: Date): Date {
  return new Date(recepcion.getTime() + DIAS_PLAZO_RECLAMO * MS_DIA);
}

/** El plazo venció: ya no se pueden registrar eventos. */
export function plazoVencido(plazoHasta: Date, ahora: Date = new Date()): boolean {
  return ahora.getTime() > plazoHasta.getTime();
}

/** Días (con decimales, nunca negativos) que quedan para el plazo. */
export function diasRestantes(plazoHasta: Date, ahora: Date = new Date()): number {
  return Math.max(0, (plazoHasta.getTime() - ahora.getTime()) / MS_DIA);
}

export interface PlazoReclamo {
  hasta: Date;
  /** `true` si parte de la fecha real de recepción informada por el SII. */
  confirmadoSii: boolean;
  /** Fecha de recepción en que se basa el cálculo. */
  desde: Date;
}

/**
 * Plazo a partir de la fecha real de recepción en el SII si se conoce (`consultarFechaRecepcionSii`); si no,
 * se estima con la recepción propia (siempre igual o posterior a la del SII, porque el emisor envía el
 * sobre por correo después de enviarlo al SII). La estimación nunca vence antes que el plazo real: si ya pasó,
 * el plazo real también; si aún no, solo el SII puede confirmarlo (responde código 8 al registrar).
 */
export function plazoDeReclamo(recepcionPropia: Date, recepcionSii?: Date | null): PlazoReclamo {
  if (recepcionSii) {
    return { desde: recepcionSii, hasta: calcularPlazoReclamo(recepcionSii), confirmadoSii: true };
  }
  return { desde: recepcionPropia, hasta: calcularPlazoReclamo(recepcionPropia), confirmadoSii: false };
}
