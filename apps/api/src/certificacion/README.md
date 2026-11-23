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

## Libros del set (IEV e IEC)

Las instrucciones del SII (secciones III y IV) piden un **Libro de Ventas** con los documentos del set (facturas, notas de crédito y débito) y un **Libro de Compras** con los documentos recibidos del set de compras: carátula `TipoLibro ESPECIAL`, `TipoEnvio TOTAL`, mismo período, `FolioNotificacion` 1 (ventas) y 2 (compras).

```
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --simular --libros --compras compras.json --salida ./salida-set
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --libros --compras compras.json --enviar-libros
```

- `--libros`: Libro de Ventas con los documentos del set recién emitidos (33, 34, 56, 61; sin boletas). `--compras <json>`: Libro de Compras con los documentos recibidos del archivo (`--compras` sin `--libros` genera solo el de compras). `--guias`: Libro de Guías si el set emitió guías (52). `--periodo AAAA-MM` (por defecto el mes de `--fecha`/hoy). `--enviar-libros`: en modo real, los sube al SII.
- **Simulado**: escribe `LibroVentas.xml`, `LibroCompras.xml` (y `LibroGuias.xml`) validados contra el XSD, sin guardar nada. **Real**: guarda los libros en la tabla `libros` (consúltelos con `GET /v1/empresas/:rut/libros`); repetir el comando genera libros nuevos.
- **JSON de compras** (`parsearComprasSet`): `{ "factorProporcionalidad": 0.6, "documentos": [ { "tipoDoc": 33, "folio": 32, "fechaDoc": "2026-11-06", "rutProveedor": "96792430-K", "razonSocial": "Proveedor SA", "montoNeto": 9000, "montoIva": 0, "ivaUsoComun": 1710 }, ... ] }`. Por documento: `montoExento`, `montoNeto`, `montoIva` (IVA recuperable; por defecto neto x 19 %), `ivaUsoComun`, `ivaNoRecuperable: [{ codigo, monto }]`, `montoNetoActivoFijo`/`ivaActivoFijo`, `otrosImpuestos: [{ codigo, tasa, monto }]`, `impuestoSinCredito`, `tipoDocRef`/`folioDocRef`, `montoTotal` (opcional; se calcula). Ver `src/dte-core/README.md`.

## Pendientes

- Verificar contra el set real el formato de texto y el valor de `FolioRef` de la referencia `SET`.
- Notas de corrección de texto sin ítems generan una línea en monto cero (por confirmar con el SII).
- El formato textual del set de compras del SII no se conoce con certeza: los documentos recibidos se toman de un JSON (ver abajo). Verificar contra el set real.
- El libro de guías no forma parte de las instrucciones del set; `--guias` es opcional y usa el folio de notificación 3 (supuesto): para otro folio use `POST /v1/empresas/:rut/libros/guias`.

Nota (Res. Ex. SII 144/2026): `SII_Instrucciones_Set_de_Pruebas.pdf` no menciona datos de transporte (chofer, patente, transportista), así que el parser del set no los trae y las guías del set se emiten sin bloque `traslado`; `ejecutarSet` pasa `omitirExigenciaTraslado: true` a `DocumentosService.emitir` para quedar exento de `EXIGIR_TRASLADO_GUIAS` (opción interna, no expuesta en la API HTTP). `indTraslado` del set sigue siendo 1 a 9.

## Set de exportación (110, 111, 112)

El set de exportación es un set aparte que entrega el SII en el ambiente de certificación; `SII_Instrucciones_Set_de_Pruebas.pdf` no lo describe y no se pudo obtener su formato de texto, así que **solo se admite en JSON**. Cada caso lleva `tipoDte` 110, 111 o 112, `exportacion` (mismo bloque que la API de emisión: moneda, tipo de cambio, `extranjero`, `aduana`), `receptorExtranjero` (`razonSocial`, `direccion`, `giro`), `indServicio` (3 a 6, solo servicios) e `items` con precios en la moneda de la operación; las notas referencian la factura con `referencias[].caso`. Las referencias `SET` / `CASO` y el folio real de la factura se arman igual que en el set básico. Un caso 110/111/112 sin `exportacion` falla con un mensaje claro. Ejemplo en el comentario de `parser-json.ts` y en `docs/certificacion/GUIA-CERTIFICACION.md` (sección 9c). Los libros de ventas del set incluyen 110/111/112.
