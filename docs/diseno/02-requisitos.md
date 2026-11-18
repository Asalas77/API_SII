# 02. Requisitos

Estados: **Implementado** (existe código y pruebas), **Parcial** (existe una parte, ver nota) y **Planificado** (no existe código). Las ubicaciones son relativas a la raíz del repositorio. Los requisitos se derivan de `README.md`, `docs/01-opciones-arquitectura-y-pruebas.md` y del código.

## 1. Requisitos funcionales

### 1.1 Gestión de empresas, certificados y folios

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RF-01 | Mantener empresas emisoras (RUT único, giro, ACTECOs, dirección, resolución SII, ambiente certificación/producción) | Parcial | Entidad y tabla en `apps/api/src/empresas/entities/empresa.entity.ts`; sin servicio ni API |
| RF-02 | Almacenar el certificado PFX y su clave cifrados, con vigencia y datos del firmante, por empresa | Parcial | `apps/api/src/certificados/entities/certificado.entity.ts`, `apps/api/src/seguridad/cifrado.service.ts`; sin servicio de carga ni API |
| RF-03 | Cargar un PFX y extraer certificado, clave privada (PKCS#8), CN, vigencia y RUT del SAN | Implementado | `cargarPfx` en `apps/api/src/dte-core/certificado/certificado.ts` |
| RF-04 | Parsear un CAF (rango, tipo, fecha de autorización, clave RSA) y calcular su vencimiento (autorización + 6 meses) | Implementado | `parsearCaf`, `cafVigente`, `folioEnRango`, `claveCafCoincide` en `apps/api/src/dte-core/caf/caf.ts` |
| RF-05 | Registrar un CAF rechazando rangos solapados con otro no anulado, de forma segura ante concurrencia | Implementado | `FoliosService.registrarCaf` (advisory lock por empresa y tipo) en `apps/api/src/folios/folios.service.ts` |
| RF-06 | Asignar el siguiente folio sin repetir ni saltar, con varios CAF, omitiendo vencidos, agotados y anulados | Implementado | `FoliosService.asignarSiguienteFolio`; prueba e2e de 50 asignaciones concurrentes en `apps/api/test/folios.e2e-spec.ts` |
| RF-07 | Consultar disponibilidad de folios por CAF (disponibles, vencido, agotado, anulado) | Implementado (servicio) | `FoliosService.foliosDisponibles`; sin endpoint |
| RF-08 | Alertas por umbral de folios y por vencimiento de CAF; anulación de folios no usados ante el SII | Planificado | `docs/01-…` sección 3 (módulo `folios`) |
| RF-09 | Verificar la firma `FRMA` del CAF con la clave pública del SII | Planificado | Pendiente en `apps/api/src/dte-core/README.md` |

### 1.2 Construcción, timbre y firma de documentos

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RF-10 | Calcular totales con montos enteros en CLP (IVA 19 %, exentos, impuestos adicionales como suma, descuentos y recargos globales) | Implementado | `calcularTotales` en `apps/api/src/dte-core/documento/totales.ts` |
| RF-11 | Construir el XML de un DTE (33, 34, 39, 41, 52, 56, 61) a partir de un modelo tipado, con textos saneados a Latin-1 y truncados al máximo del XSD | Implementado | `construirDte` en `apps/api/src/dte-core/documento/construir-dte.ts`; modelo en `tipos.ts` |
| RF-12 | Validar reglas de negocio previas a la firma (folio en rango del CAF, CAF del mismo tipo y emisor, DV de RUT, `Acteco`, referencias en notas 56/61, límites de líneas, fechas) | Implementado | `ErrorValidacionDte` en `apps/api/src/dte-core/documento/errores.ts` y `construir-dte.ts` |
| RF-13 | Generar el TED (`DD` + `FRMT` RSA-SHA1 con la clave del CAF) y verificarlo | Implementado | `generarTed`, `verificarTed` en `apps/api/src/dte-core/ted/ted.ts` |
| RF-14 | Firmar el DTE y el sobre con XMLDSig enveloped (rsa-sha1, C14N 1.0) y verificar todas las firmas de un documento | Implementado | `firmarXml`, `verificarFirmaXml` en `apps/api/src/dte-core/firma/firma.ts` |
| RF-15 | Armar sobres `EnvioDTE` y `EnvioBOLETA` (Carátula, `SubTotDTE`, firma de `SetDoc`) | Implementado | `construirEnvioDte`, `construirEnvioBoleta` en `apps/api/src/dte-core/envio/envio.ts` |
| RF-16 | Validar todo XML generado contra los XSD oficiales (DTE, EnvioDTE, EnvioBOLETA, RespSII, RespuestaEnvioDTE) | Implementado | `validarXsd` en `apps/api/src/dte-core/xsd/xsd.ts`; XSD en `apps/api/resources/sii/xsd/` |
| RF-17 | Codificar a ISO-8859-1 y utilidades de RUT, fechas SII (zona America/Santiago) y escapado XML | Implementado | `apps/api/src/dte-core/xml/xml.util.ts` |
| RF-18 | Soportar guías de despacho con datos de traslado (Res. Ex. 144/2026), exportación, liquidaciones, factura de compra (46) | Planificado | Pendientes en `apps/api/src/dte-core/README.md` |
| RF-19 | Soportar impuestos específicos (IEC, ILA/IABA con `TIEBase`, `TpoImpD`…), retenciones e `IVANoRet`, `OtraMoneda`, `SubTotInfo`, `Comisiones`, ítem espectáculo | Planificado | idem; `impuestosAdicionales` hoy sólo suma al total |

### 1.3 Comunicación con el SII

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RF-20 | Autenticar contra la API REST de boletas (semilla, token firmado) | Implementado | `BoletaApiClient.obtenerSemilla/obtenerToken` en `apps/api/src/sii-gateway/boleta/boleta-api.client.ts` |
| RF-21 | Enviar boletas (multipart con cookie `TOKEN`) y consultar estado de un envío y de una boleta | Implementado | `enviarBoletas`, `consultarEstadoEnvio`, `consultarEstadoBoleta` |
| RF-22 | Autenticar por SOAP (`getSeed`, `getToken`), subir el `EnvioDTE` y consultar `getEstUp` y `getEstDte` | Implementado | `apps/api/src/sii-gateway/dte/dte-sii.client.ts` |
| RF-23 | Seleccionar el host por ambiente (maullin/palena, apicert/api) y usar los hosts temporales pangal/rahue para el envío de boletas | Implementado | `apps/api/src/sii-gateway/ambientes.ts` |
| RF-24 | Consulta avanzada `QueryEstDteAv`, web services de aceptación/reclamo (REGISTRORECLAMODTE), consulta de eventos y catálogos `globales/boleta.electronica.*` | Planificado | Pendientes en `apps/api/src/sii-gateway/README.md` |
| RF-25 | Verificar los formatos de respuesta del SII contra el ambiente de certificación real | Planificado | Supuestos no confirmados en `apps/api/src/sii-gateway/README.md` |

### 1.4 Emisión, envío y consulta (caso de uso y API)

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RF-30 | Caso de uso de emisión: validar entrada, asignar folio, construir, timbrar, firmar y persistir el `documento` en una operación coherente | Planificado | Piezas disponibles (RF-06, RF-11 a RF-16); falta el orquestador. `DocumentosModule` sólo registra la entidad |
| RF-31 | `POST /v1/empresas/{rut}/documentos` con `Idempotency-Key` | Planificado | Existe la columna `clave_idempotencia` y su índice único parcial en `documentos` (migración inicial); no hay endpoint |
| RF-32 | `GET /v1/documentos/{id}`, `/xml`, `/pdf` | Planificado | idem |
| RF-33 | `POST /v1/documentos/{id}/reenviar` y `GET /v1/envios/{trackid}` | Planificado | `envios` y `envio_documentos` existen como tablas |
| RF-34 | Administrar CAF, folios y certificados por API (`POST /v1/empresas/{rut}/caf`, `GET …/folios`, `POST …/certificado`) | Planificado | Servicios parciales (RF-05, RF-07) |
| RF-35 | Envío asíncrono al SII por cola (batch de boletas hasta 50, Track ID, polling de estados, prioridad para guías) | Planificado | Redis y BullMQ sólo previstos (`docker-compose.yml`) |
| RF-36 | Modelo de estados del documento: emitido, encolado, enviado, aceptado, aceptado con reparos, rechazado, anulado, con reparos por documento | Parcial | Enum `estado_documento_enum` y columna `reparos` jsonb; sin máquina de estados |
| RF-37 | Webhooks de cambio de estado hacia el ERP | Planificado | `docs/01-…` sección 3 |
| RF-38 | Endpoints de salud e información: `GET /` y `GET /health` | Implementado | `apps/api/src/app.controller.ts`, `apps/api/src/health/health.controller.ts` |

### 1.5 Representación, entrega e intercambio

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RF-40 | PDF con TED en PDF417 y leyenda "verifique en www.sii.cl" | Planificado | Sin dependencias de PDF ni PDF417 en `apps/api/package.json` |
| RF-41 | Entrega digital de boletas (enlace/QR, correo) | Planificado | Res. Ex. 53/2025 (a verificar) |
| RF-42 | Intercambio con receptores (`RecepcionDTE`, `EnvioRecibos`, `ResultadoDTE`) y registro de aceptación o reclamo | Planificado | Fase 5 |
| RF-43 | Integración SAP B1: worker sobre Service Layer y luego add-on UI API en C# | Planificado | Fase 4; `docs/01-…` sección 5 |

## 2. Requisitos no funcionales

### 2.1 Seguridad

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-01 | Los PFX y sus contraseñas se guardan cifrados en reposo (AES-256-GCM, blob versionado `versión(1) \| iv(12) \| tag(16) \| ciphertext`) con una clave maestra de 32 bytes | Implementado | `apps/api/src/seguridad/cifrado.service.ts` (6 pruebas) |
| RNF-02 | La app no arranca sin variables de entorno válidas, incluida la clave maestra de 32 bytes en base64 | Implementado | `apps/api/src/config/env.validation.ts` (Joi) |
| RNF-03 | Cifrado de sobre con KMS/Vault y rotación de clave maestra | Planificado | El byte de versión del blob lo permite (`apps/api/src/database/README.md`) |
| RNF-04 | Autenticación y autorización de clientes de la API (por empresa) | Planificado | No existe ningún guard ni módulo de autenticación |
| RNF-05 | TLS en la conexión a PostgreSQL | Parcial | `DATABASE_SSL=true` activa TLS pero con `rejectUnauthorized: false` (`apps/api/src/database/database.module.ts`); endurecer antes de producción |
| RNF-06 | Nunca registrar en logs el PFX, su clave ni el token del SII | Planificado | No hay política ni pruebas; hoy no hay logging de negocio |
| RNF-07 | Aislamiento de datos por tenant a nivel de base (RLS) | Planificado | Hoy el aislamiento depende de filtrar por `empresa_id` en cada consulta (`apps/api/src/database/README.md`) |

### 2.2 Disponibilidad y resiliencia

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-10 | Reintentos con backoff exponencial ante 405, 5xx y errores de red; sin reintento en 400, 401 (salvo renovación de token), 404 | Implementado | `conReintentos` en `apps/api/src/sii-gateway/comun/http.ts` |
| RNF-11 | Token del SII en caché con TTL de 50 min, deduplicación de peticiones concurrentes y renovación única ante 401 | Implementado (en memoria) | `GestorToken`; no es compartido entre instancias |
| RNF-12 | Circuit breaker, respeto de `X-Retry-After`/`X-RateLimit-*` | Planificado | Pendiente en `apps/api/src/sii-gateway/README.md` |
| RNF-13 | Healthcheck de dependencias | Parcial | `GET /health` sólo verifica la base de datos; Redis y SII no |
| RNF-14 | Apagado ordenado | Implementado | `app.enableShutdownHooks()` en `apps/api/src/main.ts` |

### 2.3 Idempotencia y consistencia

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-20 | Un folio nunca se entrega dos veces, ni con asignaciones concurrentes | Implementado | Bloqueo pesimista `FOR UPDATE` sin `LIMIT` en `FoliosService`; único `(empresa_id, tipo_dte, folio)` en `documentos` |
| RNF-21 | Reintentar una emisión con la misma clave no duplica el documento | Parcial | Restricción de unicidad en BD; falta la lógica y el endpoint |
| RNF-22 | Un reenvío duplicado al SII no genera efectos inesperados | Parcial | El SII rechaza un envío repetido; el gateway reintenta el upload ante 405/5xx (`apps/api/src/sii-gateway/README.md`) |
| RNF-23 | Un folio asignado en una transacción que luego falla puede quedar sin usar (hueco) | Planificado | La política de huecos (reasignar o anular ante el SII) no está definida; ver riesgos en `15-estado-y-roadmap.md` |

### 2.4 Multiempresa

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-30 | Toda tabla de negocio lleva `empresa_id`; FK con `ON DELETE RESTRICT` | Implementado | `apps/api/src/database/migrations/1794643366818-Inicial.ts` |
| RNF-31 | Ambiente SII por empresa (`ambiente_sii`), con `SII_AMBIENTE` como valor por defecto | Parcial | La columna existe en `empresas` y `envios`; `SII_AMBIENTE` se expone en `GET /`; el cableado al gateway no existe |
| RNF-32 | Certificado y CAF propios por RUT | Implementado (modelo) | Tablas `certificados` y `cafs` |

### 2.5 Trazabilidad y auditoría

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-40 | Conservar XML firmado, TED, Track ID, respuestas del SII e intentos por documento y envío | Parcial | Columnas en `documentos` y `envios`; sin lógica que las escriba |
| RNF-41 | Auditoría de quién emitió o cambió qué | Planificado | `docs/01-…` sección 3 (`auditoría`) |
| RNF-42 | Registro de cada llamada al SII, trazas por Track ID, métricas de rechazos y reparos | Planificado | Observabilidad (p. ej. NestJS Observe, mencionado en `apps/api/AGENTS.md`) sin configurar |
| RNF-43 | Retención legal de XML y envíos (6 años, a verificar), purga y archivado | Planificado | `apps/api/src/database/README.md` |

### 2.6 Rendimiento

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-50 | Emisión síncrona (folio + XML + firma) en menos de 1 s para que el POS imprima | Planificado | Meta de `docs/01-…`; no medida. Validadores XSD cacheados (`apps/api/src/dte-core/xsd/xsd.ts`) ayudan |
| RNF-51 | Agrupar boletas en sobres de 50 (máximo 500) | Parcial | Constante `BOLETAS_POR_SOBRE_RECOMENDADO` y tope `MAX_BOLETAS_POR_SOBRE` en `dte-core`; el agrupamiento lo hará la cola (planificada) |
| RNF-52 | Medir carga y resiliencia contra un mock del SII (Prism, WireMock) | Planificado | `docs/01-…` sección 4, nivel 6 |
| RNF-53 | Particionado de `documentos` si el volumen lo exige; mover XML a object storage | Planificado | `apps/api/src/database/README.md` |

### 2.7 Mantenibilidad ante cambios normativos

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-60 | Los XSD oficiales viven versionados en el repositorio y son la fuente de verdad; todo documento de prueba se valida contra ellos | Implementado | `apps/api/resources/sii/xsd/`; `integracion.spec.ts`, `xsd.spec.ts` |
| RNF-61 | Proceso para actualizar el paquete XSD y detectar diferencias | Planificado | No hay script ni CI |
| RNF-62 | Constructor dirigido por una definición versionada de formato | Parcial | El constructor es código TypeScript con el orden del XSD embebido; nuevos campos (IEC/ILA) requieren cambios de código |
| RNF-63 | Dominio puro: el núcleo no depende de NestJS ni de red, y es probable con certificados y CAF sintéticos | Implementado | `apps/api/src/dte-core/testing/` |
| RNF-64 | TypeScript estricto, ESM, lint (oxlint con reglas de tipos) y formato (prettier) | Implementado | `apps/api/tsconfig.json`, `apps/api/.oxlintrc.json`, `apps/api/.prettierrc` |
| RNF-65 | Esquema sólo por migraciones explícitas (`synchronize: false`) | Implementado | `apps/api/src/database/database.module.ts` |
| RNF-66 | CI (lint, tipos, pruebas, validación XSD) | Planificado | No hay pipeline en el repositorio |

### 2.8 Calidad verificada

| Id | Requisito | Estado | Ubicación / nota |
|---|---|---|---|
| RNF-70 | Pruebas unitarias del núcleo y de los clientes con `fetch` simulado | Implementado | 184 pruebas en 17 archivos (`npx vitest run`) |
| RNF-71 | Pruebas e2e con PostgreSQL real, omitidas si falta `DATABASE_HOST` | Implementado | `apps/api/test/*.e2e-spec.ts` (`describe.skipIf`) |
| RNF-72 | Pruebas contra el ambiente de certificación del SII y certificación formal | Planificado | `README.md`: siguiente hito |
