# documentos

Emisión de DTE (`DocumentosService`), descarga de XML/PDF y consulta del estado de cada documento en el SII (`EstadoSiiService`).

## Estado del documento en el SII

`POST /v1/documentos/:id/consultar-estado` (permiso `documentos.leer`) y `POST /v1/empresas/:rut/documentos/consultar-estados` (lote) preguntan al SII por cada documento:

- **DTE (33, 34, 52, 56, 61 y exportación 110, 111, 112)**: `getEstDte` (`QueryEstDte.jws`) con RUT emisor, RUT receptor, tipo, folio, fecha de emisión `ddmmyyyy` y monto total (en exportación, RUT receptor 55555555-5 y el monto en **pesos**, el equivalente de `OtraMoneda`, que es el que guarda `monto_total`). El consultante es el firmante del certificado de la empresa.
- **Boletas (39, 41)**: `GET boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado` con `rut_receptor`, `dv_receptor`, `monto` y `fechaEmision` (`DD-MM-YYYY`). Usa los mismos códigos que `getEstDte`.
- Solo documentos que ya salieron en un envío (`enviado`, `aceptado`, `aceptado_con_reparos`, `rechazado`, `anulado`); `emitido`/`encolado` responden 409 `ESTADO_INVALIDO`. Recurso de otra empresa: 404 (individual) o 403 (lote, por la ruta `:rut`).
- El ambiente es el del último envío del documento (si no hay, el de la empresa).

Se guardan siempre que haya un estado válido: `documentos.estado_sii` (código), `glosa_sii`, `consultado_sii_en` y `respuesta_estado_sii` (jsonb, resumen de la respuesta). Si el SII responde un error de consulta (ESTADO `-1`..`-14`, `001`..`003`, o un código desconocido) o la llamada falla, la API responde 502 (`SII_CONSULTA_ERROR`) o 503 (`SII_NO_DISPONIBLE`: red caída, 5xx, límite de tasa) y **no modifica nada**.

### Mapeo código SII -> `documentos.estado` (`estado-sii.ts`)

| Código SII | Significado | Efecto en `estado` |
|---|---|---|
| DOK | Recibido, datos coinciden | `enviado` -> `aceptado` |
| TMD, TMC, MMD, MMC | Existe nota de débito/crédito que modifica texto o montos | `enviado` -> `aceptado` |
| AND, ANC | Existe nota de débito/crédito que **anula** el documento | `enviado` -> `aceptado`; la anulación queda solo en `estado_sii` |
| FAN | Documento anulado | `enviado`/`aceptado`/`aceptado_con_reparos` -> `anulado` |
| FNA, EMP | No autorizado / empresa no autorizada | `enviado` -> `rechazado` |
| DNK | Recibido, datos NO coinciden | sin cambio; `advertencia` (revise monto, fecha o receptor) |
| FAU | No recibido | sin cambio; `advertencia` (reintentar más tarde; no es final) |

Reglas: nunca se degrada `aceptado_con_reparos` a `aceptado`; un estado de partida que el SII contradice (p. ej. `rechazado` con DOK) no se pisa y se informa en `advertencia`. Justificación de AND/ANC: la nota de crédito/débito es otro documento que anula los efectos tributarios, pero el documento original sí fue aceptado por el SII; reflejarlo como `anulado` ocultaría que fue aceptado. FAN, en cambio, es el SII diciendo que el propio documento está anulado.

### Respuestas

- Individual: `{ documento, estadoSii, glosaSii, esFinal, descripcionEstado, advertencia? }`.
- Lote (`{ documentoIds?: string[], limite?: 1..200 = 50 }`; por defecto los `enviado` de la empresa, más antiguos primero): `{ total, consultados, conError, resultados[] }`, con `ok`, `estadoAnterior`, `estado`, `estadoSii`, `glosaSii`, `esFinal`, `advertencia?` o `error { code, detail }` por documento. Máximo 3 consultas simultáneas.
- `GET /v1/documentos/:id` incluye `estadoSii`, `glosaSii` y `consultadoSiiEn`.

### Integración con envíos

`POST /v1/envios/:id/consultar` (DTE) resuelve con `getEstUp` los tipos sin resultado mixto. Si un tipo tiene aceptados y rechazados/reparos mezclados, consulta `getEstDte` de cada documento de ese tipo y aplica este mismo mapeo. Limitación: `getEstDte` no distingue "aceptado con reparos" (devuelve DOK), así que en un resultado mixto un documento con reparos queda `aceptado`.

## Traslado (Res. Ex. SII 144/2026)

`EmitirDocumentoDto` acepta el bloque `traslado` (ver `documentos.dto.ts`; reglas en `src/dte-core/README.md`), `idDoc.indTraslado` 1 a 12 (`traslado.indTraslado` es un alias), `detalle[].peso`/`volumen`, `detalle[].precioUnitario` opcional en guías y traslados, y `referencias[].rutOtroContribuyente`. Toda guía (52) debe traer `traslado` mientras `EXIGIR_TRASLADO_GUIAS=true` (por defecto): sin él, 422 `DOCUMENTO_INVALIDO` con `errors[0].campo = traslado`; en facturas sigue siendo opcional. Los errores de negocio responden 422 `DOCUMENTO_INVALIDO` con `errors[{campo, mensaje}]`.

- Columnas nuevas de `documentos` (migración `1795700000000-TrasladoDocumento`): `traslado` (jsonb: traslado normalizado + `solicitud` original; la API devuelve `traslado` sin la solicitud) y `traslado_pendiente` (boolean). La respuesta de documento trae `trasladoPendiente` y `traslado`.
- `GET /v1/empresas/{rut}/documentos?trasladoPendiente=true[&tipo=52][&limite=50]` lista (más recientes primero; máx. 200).
- `POST /v1/documentos/{id}/complementar-traslado` (permiso `documentos.emitir`, `Idempotency-Key` opcional): cuerpo `{ modalidad?: 'guia_posterior' | 'gdt', traslado: {...datos nuevos...}, fechaEmision? }`. Emite una NUEVA guía 52 que referencia a la original (`FolioRef`, sin `RUTOtr`: es del mismo emisor) y deja la original con `trasladoPendiente=false` y `traslado.complementadoPor`, todo en una transacción. `guia_posterior` (por defecto) copia la guía original (mismo `IndTraslado`, detalle y precios) con los datos actualizados (resolutivo 4°); `gdt` emite `IndTraslado` 10 con detalle mínimo y categoría tercerizado, pero si `PERMITIR_INDTRASLADO_RES144=false` cae a guía posterior y responde `advertencia` (en una factura, que solo admite `gdt`, responde 422). Lo no informado se conserva; los campos que se informan salen de `diferido`/`sinDato`. Una guía ya complementada responde 409 `TRASLADO_YA_COMPLEMENTADO` (complemente la última). Sirve también para corregir datos tras emitir (cambio de vehículo o chofer).
- Limitaciones: la guía posterior duplica el detalle de la original, de modo que el libro de guías la contaría dos veces mientras la original no figure anulada; la anulación de la guía reemplazada en el Registro de Guías de Despacho del SII es manual (no hay web service). El estado `anulado` de la API no se usa para eso.

## Exportación (110, 111, 112)

`POST /v1/empresas/{rut}/documentos` con `idDoc.tipoDte` 110, 111 o 112 y el bloque `exportacion` (obligatorio en esos tipos y prohibido en los demás). El RUT del receptor es siempre 55555555-5 (se puede omitir en `receptor`; el identificador del receptor en su país va en `exportacion.extranjero.numId`). Los precios y descuentos van en la moneda de la operación; no hay IVA.

```json
{
  "idDoc": { "tipoDte": 110, "formaPago": 2, "fechaVencimiento": "2026-12-23" },
  "receptor": { "razonSocial": "ACME IMPORT INC", "giro": "Importaciones", "direccion": "350 Fifth Avenue, New York" },
  "detalle": [{ "nombre": "Vino Cabernet Sauvignon caja 6 botellas", "cantidad": 100, "precioUnitario": 45.5, "unidad": "CJ" }],
  "referencias": [{ "tipoDocRef": "807", "folioRef": "2026-123456-7", "razonRef": "DUS" }],
  "exportacion": {
    "moneda": "DOLAR USA", "tipoCambio": 925.4567, "formaPagoExportacion": 11,
    "extranjero": { "numId": "US-12-3456789", "nacionalidad": 225 },
    "aduana": {
      "codigoModalidadVenta": 1, "codigoClausulaVenta": 5, "totalClausulaVenta": 4550,
      "codigoViaTransporte": 1, "nombreTransporte": "MN MAERSK LIMA", "booking": "BKG123456",
      "codigoPuertoEmbarque": 905, "codigoPuertoDesembarque": 134,
      "pesoBruto": 1830.5, "codigoUnidadPesoBruto": 6, "totalBultos": 100,
      "bultos": [{ "codigoTipo": 10, "cantidad": 100, "marcas": "ACME NY" }],
      "montoFlete": 450, "codigoPaisReceptor": 225, "codigoPaisDestino": 225
    }
  }
}
```

`indServicio` 3 a 6 marca una exportación de servicios (omitir para bienes). La respuesta trae `totales.montoTotal` y `montoExento` en pesos (equivalente) y `totales.moneda`, `tipoCambio` y `montoMoneda` (total en la moneda de la operación; hasta 4 decimales). Las reglas, los códigos de Aduana (tablas del Anexo 51) y lo que se asume están en `src/dte-core/README.md` (sección Exportación) y `docs/referencias-aduana/README.md`. Las notas 111/112 referencian la factura con `referencias: [{ "tipoDocRef": "110", "folioRef": 1, "codRef": 3 }]`. La migración `ExportacionDocumento` agrega `moneda`, `tipo_cambio` y `monto_moneda` a `documentos` (RLS sin cambios). No hay copia cedible de exportación (`?cedible=true` se ignora) y el PDF es siempre formato carta.
