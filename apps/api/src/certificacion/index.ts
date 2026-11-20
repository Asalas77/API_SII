export * from './tipos.js';
export * from './parser-texto.js';
export * from './parser-json.js';
export * from './generador.js';
export * from './ejecutar-set.js';

import { parsearSetJson } from './parser-json.js';
import { parsearSetTexto } from './parser-texto.js';
import type { SetPruebas } from './tipos.js';

/** Detecta el formato por el contenido: JSON si empieza con `{`, texto del SII en otro caso. */
export function parsearSet(contenido: string): SetPruebas {
  return contenido.trimStart().replace(/^﻿/, '').startsWith('{')
    ? parsearSetJson(contenido)
    : parsearSetTexto(contenido);
}
export * from './libros-set.js';
