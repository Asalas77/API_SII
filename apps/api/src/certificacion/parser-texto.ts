import {
  type CasoSet,
  type ItemCaso,
  type ReferenciaCaso,
  type SetPruebas,
  type TipoCaso,
  ErrorSetPruebas,
} from './tipos.js';

/**
 * Parser tolerante del TEXTO del set de pruebas que entrega el SII (mejor esfuerzo: no hay una
 * especificación publicada del archivo, solo las "Instrucciones del set de pruebas").
 *
 * Estructura que se reconoce (mayúsculas/minúsculas y acentos indiferentes; separadores por tabs o
 * 2+ espacios):
 *
 * ```
 * SET BASICO - NUMERO DE ATENCION: 4321
 * CASO 4321-1
 * DOCUMENTO        FACTURA ELECTRONICA
 * ITEM             CANTIDAD   PRECIO UNITARIO   DESCUENTO
 * Cajón AFECTO     224        4617              10%
 * Relleno EXENTO   174        2205
 * DESCUENTO GLOBAL 5%
 * REFERENCIA       ANULA FACTURA ELECTRONICA CASO 4321-1
 * RAZON REFERENCIA ANULA FACTURA
 * ```
 *
 * Lo que no se entiende se conserva en `notas` y se informa como advertencia, nunca se descarta en
 * silencio. Ante cualquier duda use el formato JSON equivalente (`parser-json.ts`).
 */

const NOMBRES_DOCUMENTO: Array<[RegExp, TipoCaso]> = [
  [/NOTA\s+DE\s+CREDITO/, 61],
  [/NOTA\s+DE\s+DEBITO/, 56],
  [/GUIA\s+DE\s+DESPACHO/, 52],
  [/BOLETA.*(EXENTA|NO\s+AFECTA)/, 41],
  [/BOLETA/, 39],
  [/FACTURA.*(EXENTA|NO\s+AFECTA)/, 34],
  [/FACTURA/, 33],
];

const TRASLADOS: Array<[RegExp, NonNullable<CasoSet['indTraslado']>]> = [
  [/CONSTITUYE\s+VENTA/, 1],
  [/VENTAS?\s+POR\s+EFECTUAR/, 2],
  [/CONSIGNACION/, 3],
  [/ENTREGA\s+GRATUITA/, 4],
  [/TRASLADOS?\s+INTERNOS?/, 5],
  [/OTROS\s+TRASLADOS/, 6],
  [/DEVOLUCION/, 7],
  [/EXPORTACION.*NO\s+VENTA|NO\s+VENTA.*EXPORTACION/, 8],
  [/EXPORTACION/, 9],
];

/** Mayúsculas y sin acentos para comparar claves (la `Ñ` se conserva en los textos originales). */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

/** Número en formato chileno (`1.234,5`) o simple (`1234.5`). */
export function parsearNumero(texto: string): number | undefined {
  let t = texto.replace(/[$\s%]/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return undefined;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const celdas = (linea: string): string[] =>
  linea
    .trim()
    .split(/\t+|\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c !== '');

type Columna = 'nombre' | 'cantidad' | 'precio' | 'descuento' | 'unidad' | 'exento';

function columnaDe(nombre: string): Columna | undefined {
  const n = normalizar(nombre);
  if (/^ITEM|^DESCRIPCION|^PRODUCTO|^NOMBRE/.test(n)) return 'nombre';
  if (n.startsWith('CANT')) return 'cantidad';
  if (/^PRECIO|^VALOR/.test(n)) return 'precio';
  if (n.startsWith('DESC')) return 'descuento';
  if (/^UNIDAD|^UM$/.test(n)) return 'unidad';
  if (/^EXENT|^AFECT/.test(n)) return 'exento';
  return undefined;
}

function esExento(nombre: string, columna?: string): boolean {
  const n = normalizar(`${nombre} ${columna ?? ''}`);
  return /\b(EXENTO|EXENTA|NO\s+AFECTO|NO\s+AFECTA)\b/.test(n);
}

function parsearReferencia(
  valor: string,
  numeroAtencion: string | undefined,
): ReferenciaCaso {
  const n = normalizar(valor);
  let codRef: ReferenciaCaso['codRef'];
  if (/ANULA/.test(n)) codRef = 1;
  else if (/CORRIGE\s+(TEXTO|GIRO|DIRECCION|RAZON|RUT)|MODIFICA\s+TEXTO/.test(n)) codRef = 2;
  else if (/CORRIGE|DEVOLUCION|MODIFICA|DIFERENCIA/.test(n)) codRef = 3;

  const caso = /(\d+-\d+)/.exec(valor)?.[1];
  const nro = /(?:N[°ºO.]*|NUMERO|FOLIO|CASO)\s*\.?\s*(\d+)\b/i.exec(valor)?.[1];
  return {
    caso: caso ?? (nro && numeroAtencion ? `${numeroAtencion}-${nro}` : undefined),
    codRef,
    razonRef: valor,
  };
}

export function parsearSetTexto(texto: string): SetPruebas {
  const advertencias: string[] = [];
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  let numeroAtencion = /NUMERO\s+DE\s+ATENCION\s*:?\s*(\d+)/.exec(normalizar(texto))?.[1];

  const casos: CasoSet[] = [];
  let actual: CasoSet | undefined;
  let columnas: Columna[] | undefined;
  let referenciaPendiente: ReferenciaCaso | undefined;
  const declarados = new Set<string>();

  const cerrarReferencia = () => {
    if (actual && referenciaPendiente) actual.referencias.push(referenciaPendiente);
    referenciaPendiente = undefined;
  };

  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (linea === '' || /^[=\-_*#]{3,}$/.test(linea)) {
      // Una línea en blanco termina la tabla de ítems.
      if (linea === '') columnas = undefined;
      continue;
    }
    const n = normalizar(linea);

    const mCaso = /^CASO\s*(?:N[°ºO.]*)?\s*(\d+)\s*-\s*(\d+)/.exec(n);
    if (mCaso) {
      cerrarReferencia();
      numeroAtencion ??= mCaso[1];
      actual = {
        id: `${mCaso[1]}-${mCaso[2]}`,
        numero: Number(mCaso[2]),
        tipoDte: 33,
        items: [],
        referencias: [],
        notas: [],
      };
      casos.push(actual);
      columnas = undefined;
      continue;
    }
    if (!actual) continue; // encabezado del set

    const partes = celdas(linea);
    const clave = normalizar(partes[0] ?? '');
    const resto = partes.slice(1).join(' ').trim();

    if (/^DOCUMENTO\b/.test(clave) || /^DOCUMENTO\s/.test(n)) {
      const valor = normalizar(resto || linea.replace(/^documento\s*:?/i, ''));
      const tipo = NOMBRES_DOCUMENTO.find(([re]) => re.test(valor))?.[1];
      if (tipo) {
        actual.tipoDte = tipo;
        declarados.add(actual.id);
      } else advertencias.push(`Caso ${actual.id}: tipo de documento no reconocido: "${valor}"`);
      columnas = undefined;
      continue;
    }

    if (/^RAZON\s+REFERENCIA/.test(n)) {
      const valor = resto || linea.replace(/^raz[oó]n\s+referencia\s*:?/i, '').trim();
      if (referenciaPendiente) referenciaPendiente.razonRef = valor;
      else actual.referencias.push({ razonRef: valor });
      columnas = undefined;
      continue;
    }
    if (n.startsWith('REFERENCIA')) {
      cerrarReferencia();
      const valor = resto || linea.replace(/^referencia\s*:?/i, '').trim();
      referenciaPendiente = parsearReferencia(valor, numeroAtencion);
      columnas = undefined;
      continue;
    }
    if (/^DESCUENTO\s+(GLOBAL|SOBRE\s+EL\s+TOTAL|TOTAL)/.test(n)) {
      const pct = parsearNumero(/(-?[\d.,]+)\s*%/.exec(linea)?.[1] ?? '');
      if (pct !== undefined) actual.descuentoGlobalPorcentaje = pct;
      else advertencias.push(`Caso ${actual.id}: descuento global sin porcentaje: "${linea}"`);
      columnas = undefined;
      continue;
    }
    if (/^(TRASLADO|INDICADOR\s+DE\s+TRASLADO|TIPO\s+DE\s+TRASLADO)/.test(n)) {
      const t = TRASLADOS.find(([re]) => re.test(n))?.[1];
      if (t) actual.indTraslado = t;
      else actual.notas.push(linea);
      columnas = undefined;
      continue;
    }

    // Encabezado de la tabla de ítems.
    if (/^ITEM\b/.test(n) && partes.length > 1 && partes.slice(1).every((p) => columnaDe(p))) {
      columnas = partes.map((p) => columnaDe(p) as Columna);
      continue;
    }

    if (columnas) {
      const item = parsearItem(partes, columnas, linea);
      if (item) {
        actual.items.push(item);
        continue;
      }
    } else if (/\d/.test(linea) && partes.length >= 3) {
      // Fila de ítem sin encabezado: nombre, cantidad, precio [, descuento].
      const item = parsearItem(partes, ['nombre', 'cantidad', 'precio', 'descuento'], linea);
      if (item) {
        actual.items.push(item);
        continue;
      }
    }
    actual.notas.push(linea);
  }
  cerrarReferencia();

  if (casos.length === 0) {
    throw new ErrorSetPruebas('No se encontró ningún "CASO nnnn-n" en el texto del set');
  }
  for (const c of casos) {
    if (!declarados.has(c.id)) advertencias.push(`Caso ${c.id}: sin línea DOCUMENTO; se asume factura electrónica (33)`);
    if (c.items.length === 0 && c.tipoDte !== 56 && c.tipoDte !== 61) advertencias.push(`Caso ${c.id}: sin ítems reconocidos`);
    for (const nota of c.notas) advertencias.push(`Caso ${c.id}: línea no interpretada: "${nota}"`);
  }
  return { numeroAtencion, casos, advertencias };
}

function parsearItem(
  partes: string[],
  columnas: Columna[],
  linea: string,
): ItemCaso | undefined {
  let valores = partes;
  // Fila con espacios simples: se rescata el nombre y los números del final.
  if (valores.length < columnas.filter((c) => c !== 'exento').length) {
    const m = /^(.*?)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)(?:\s+(-?\d[\d.,]*\s*%?))?\s*$/.exec(linea);
    if (!m) return undefined;
    valores = [m[1], m[2], m[3], ...(m[4] ? [m[4]] : [])];
  }
  const item: Partial<ItemCaso> = {};
  let colExento: string | undefined;
  columnas.forEach((col, i) => {
    const v = valores[i];
    if (v === undefined) return;
    if (col === 'nombre') item.nombre = v;
    else if (col === 'unidad') item.unidad = v;
    else if (col === 'exento') colExento = v;
    else {
      const n = parsearNumero(v);
      if (n === undefined) return;
      if (col === 'cantidad') item.cantidad = n;
      else if (col === 'precio') item.precioUnitario = n;
      else if (col === 'descuento') {
        if (v.includes('%')) item.descuentoPorcentaje = n;
        else item.descuentoMonto = n;
      }
    }
  });
  if (!item.nombre || item.cantidad === undefined || item.precioUnitario === undefined) {
    return undefined;
  }
  return {
    nombre: item.nombre,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    ...(item.descuentoPorcentaje !== undefined ? { descuentoPorcentaje: item.descuentoPorcentaje } : {}),
    ...(item.descuentoMonto !== undefined ? { descuentoMonto: item.descuentoMonto } : {}),
    ...(item.unidad ? { unidad: item.unidad } : {}),
    ...(esExento(item.nombre, colExento) ? { exento: true } : {}),
  };
}
