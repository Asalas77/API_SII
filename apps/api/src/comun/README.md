# API `/v1`: convenciones y módulos

Controladores y servicios viven en su módulo (`empresas`, `certificados`, `folios`, `documentos`, `envios`); `src/app.setup.ts` (`configurarApp`) fija el prefijo `/v1`, la validación y el filtro de errores, y lo usan `main.ts` y los e2e.

| Método y ruta | Módulo | Notas |
|---|---|---|
| `POST /v1/empresas`, `GET/PATCH /v1/empresas/:rut` | empresas | resolución SII, ambiente, proveedor de software (`proveedorSoftware.rut`) |
| `POST/GET /v1/empresas/:rut/certificados`, `DELETE .../:id` | certificados | multipart `archivo` + `password`; cifrado AES-256-GCM; nunca se devuelve |
| `POST /v1/empresas/:rut/cafs`, `GET /v1/empresas/:rut/folios?tipoDte=` | folios | `parsearCaf` + `claveCafCoincide` + RUT de la empresa; CAF cifrado en reposo |
| `POST /v1/empresas/:rut/documentos` | documentos | `Idempotency-Key`; 201, o 200 + `Idempotent-Replayed: true` |
| `GET /v1/documentos/:id`, `/xml` (ISO-8859-1), `/pdf?formato=&cedible=` | documentos | PDF con `representacion/generarPdf` |
| `POST /v1/empresas/:rut/envios` (`{documentoIds[]}` o `{tipo, pendientes:true}`), `GET /v1/empresas/:rut/envios` | envios | responde `{ envios: [...] }`: boletas en lotes de 50 (máx. 500) |
| `GET /v1/envios/:id` (UUID o track id), `POST /v1/envios/:id/consultar` | envios | actualiza envío y documentos |

Validación con esquemas Joi (Standard Schema) vía `@Body({ schema })`. Errores: `application/problem+json` (`problem.filter.ts`), con `code` estable (`VALIDACION` 400, `NO_ENCONTRADO` 404, `SIN_FOLIOS_DISPONIBLES` y `IDEMPOTENCIA_CONFLICTO` y `ESTADO_INVALIDO` 409, `DOCUMENTO_INVALIDO`/`CAF_INVALIDO`/`CERTIFICADO_INVALIDO` 422, `SII_RECHAZO`/`SII_NO_DISPONIBLE` 502).

## Decisiones

- **Emisión**: una transacción asigna el folio (`FoliosService.asignarSiguienteFolio(..., manager)`, con bloqueo del CAF), construye y firma con `construirDte` y guarda el documento. Si algo falla se revierte y el folio no se consume. La `Idempotency-Key` se valida con un hash del cuerpo (`documentos.huella_solicitud`); solicitudes simultáneas con la misma clave devuelven el mismo documento.
- **Envíos**: los documentos se reservan (`encolado`, con bloqueo de fila) antes de enviar; si el envío falla vuelven a `emitido` y el envío queda con estado `ERR`.
- **Estados**: `envios/resultado-envio.ts` traduce el estado del SII a estados de documento. En DTE el SII solo da conteos por tipo; un resultado mixto dentro de un tipo no se atribuye a un documento y queda `enviado` (pendiente: `getEstDte` por documento).
- Fechas y vencimientos en `America/Santiago` (`fechas.ts`).

## PENDIENTE CRÍTICO antes de producción

**No hay autenticación ni autorización de clientes**: cualquiera con acceso a la red puede crear empresas, subir certificados y emitir. Falta API key por empresa (`docs/diseno/08-seguridad.md`), aislamiento por empresa en `GET /documentos/:id` y `/envios/:id`, límites de tasa, y RLS. Tampoco hay listado paginado de documentos ni webhooks.
