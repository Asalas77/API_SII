export type Nivel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const CLAVES_SENSIBLES = /pass(word)?|api[-_]?key|authorization|cookie|secret|token|b1session|routeid/i;

/**
 * Logger JSON de una línea. Redacta las claves sensibles y, además, cualquier aparición literal de
 * los `secretos` dados (API key, contraseña) dentro del texto final.
 */
export function crearLogger(
  opciones: { secretos?: string[]; nivel?: Nivel; salida?: (linea: string) => void } = {},
): Logger {
  const orden: Record<Nivel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const minimo = orden[opciones.nivel ?? 'info'];
  const salida = opciones.salida ?? ((l: string) => process.stdout.write(`${l}\n`));
  const secretos = (opciones.secretos ?? []).filter((s) => s.length >= 4);

  const emitir = (nivel: Nivel, msg: string, ctx: Record<string, unknown> = {}) => {
    if (orden[nivel] < minimo) return;
    let linea = JSON.stringify(
      { ts: new Date().toISOString(), nivel, msg, ...ctx },
      (clave, valor: unknown) => {
        // `trackId` es un dato de negocio, no una credencial.
        if (clave && clave !== 'trackId' && CLAVES_SENSIBLES.test(clave)) return '***';
        if (valor instanceof Error) return { name: valor.name, message: valor.message };
        return valor;
      },
    );
    for (const s of secretos) linea = linea.split(s).join('***');
    salida(linea);
  };
  return {
    debug: (m, c) => emitir('debug', m, c),
    info: (m, c) => emitir('info', m, c),
    warn: (m, c) => emitir('warn', m, c),
    error: (m, c) => emitir('error', m, c),
  };
}
