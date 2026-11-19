/** Zona horaria de referencia de todo el dominio tributario chileno. */
export const ZONA_SANTIAGO = 'America/Santiago';

const FORMATO_FECHA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_SANTIAGO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de calendario `yyyy-mm-dd` en `America/Santiago` (no depende de la zona del servidor). */
export function fechaSantiago(instante: Date = new Date()): string {
  return FORMATO_FECHA.format(instante);
}

/** Acepta un instante (`Date`) o una fecha de calendario ya formateada y devuelve `yyyy-mm-dd`. */
export function aFechaCalendario(fecha: Date | string): string {
  if (typeof fecha === 'string') {
    if (!FECHA_ISO.test(fecha)) {
      throw new Error(`Fecha inválida (se esperaba yyyy-mm-dd): ${fecha}`);
    }
    return fecha;
  }
  return fechaSantiago(fecha);
}
