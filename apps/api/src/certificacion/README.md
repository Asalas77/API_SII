# certificacion

Herramienta del set de pruebas del SII: lee el set (texto del SII o JSON), emite un DTE por caso con la API interna, arma el sobre y lo envía al ambiente de certificación mostrando el track id. Con `--simular` solo genera archivos para revisarlos.

```
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --simular --salida ./salida-set
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt
```

El script compila (`nest build`) y ejecuta `dist/certificacion/cli.js` (el loader `ts-node/esm` no resuelve los imports ESM de Nest 12). Opciones: `--empresa`, `--archivo`, `--simular`, `--salida`, `--fecha yyyy-mm-dd`, `--clave` (prefijo de idempotencia).

## Qué hace

1. `parsearSet` detecta el formato (JSON si empieza con `{`, texto en otro caso).
2. Por cada caso, en orden, `casoADocumento` arma el cuerpo de emisión: **primera referencia** `SET` con razón `CASO nnnn-n` (instrucción 6 del SII; `FolioRef` = número del caso, supuesto), receptor distinto por caso (`receptoresDePrueba`, RUT ficticios válidos), fecha del día. Las referencias propias de las notas van desde la línea 2 y apuntan al folio real ya emitido del caso referenciado. Una anulación sin ítems repite los del documento anulado.
3. **Modo simulado**: emite dentro de una transacción que se **revierte** (no consume folios ni deja documentos), escribe `<caso>_T<tipo>_F<folio>.xml` (ISO-8859-1), `.pdf` y el sobre `EnvioDTE.xml`/`EnvioBOLETA.xml`, valida el sobre contra el XSD y no toca el SII.
4. **Modo real**: emite con clave de idempotencia `set-<atención>-<caso>` (repetir el comando no duplica ni reenvía documentos ya enviados), arma un único sobre en el orden del set (DTE; las boletas, si las hay, van en su propio envío) y lo envía. Muestra `TRACK ID`. Si cambia la fecha entre ejecuciones, la API responde `IDEMPOTENCIA_CONFLICTO`: repita con la misma `--fecha` o con otro `--clave`.

## Formato del texto del SII (mejor esfuerzo)

No hay una especificación publicada del archivo; el parser (`parser-texto.ts`) es tolerante y está probado con un ejemplo representativo inventado a partir de las "Instrucciones del set de pruebas". Reconoce `CASO nnnn-n`, `DOCUMENTO <tipo>`, tabla `ITEM / CANTIDAD / PRECIO UNITARIO [/ DESCUENTO]` (separada por tabs o 2+ espacios; también filas con espacios simples), `DESCUENTO GLOBAL n%`, `REFERENCIA <texto>` (verbo `ANULA`/`CORRIGE...` y número de caso) y `RAZON REFERENCIA`, `TRASLADO <texto>` (guías). Ítems con `EXENTO`/`NO AFECTO` en la glosa se marcan exentos. Todo lo que no entiende se informa como advertencia; **revise las advertencias y los XML con `--simular`**. Cuando el texto real difiera, use el JSON.

## Formato JSON equivalente

Ver el comentario de `parser-json.ts`. Campos por caso: `id`, `tipoDte`, `items[]` (`nombre`, `cantidad`, `precioUnitario`, `descuentoPorcentaje`, `descuentoMonto`, `unidad`, `exento`), `descuentoGlobalPorcentaje`, `referencias[]` (`caso` o `tipoDocRef`+`folioRef`, `codRef`, `razonRef`), `indTraslado`.

## Pendientes

- Verificar contra el set real el formato de texto y el valor de `FolioRef` de la referencia `SET`.
- Notas de corrección de texto sin ítems generan una línea en monto cero (por confirmar con el SII).
- Libros IEV/IECV y set de compras (no implementados).
