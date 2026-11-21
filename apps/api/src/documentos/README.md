# documentos

Emisión de DTE (`DocumentosService`), descarga de XML/PDF y consulta del estado de cada documento en el SII (`EstadoSiiService`).

## Estado del documento en el SII

`POST /v1/documentos/:id/consultar-estado` (permiso `documentos.leer`) y `POST /v1/empresas/:rut/documentos/consultar-estados` (lote) preguntan al SII por cada documento:

- **DTE (33, 34, 52, 56, 61)**: `getEstDte` (`QueryEstDte.jws`) con RUT emisor, RUT receptor, tipo, folio, fecha de emisión `ddmmyyyy` y monto total. El consultante es el firmante del certificado de la empresa.
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
