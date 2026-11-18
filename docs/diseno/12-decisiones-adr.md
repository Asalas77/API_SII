# 12. Registro de decisiones de arquitectura (ADR)

Formato: contexto, decisión, alternativas, consecuencias, estado. Estados posibles: **Aceptada** (vigente e implementada), **Aceptada (parcial)** (vigente, implementada en parte) y **Propuesta** (decidida pero sin código). Las rutas son relativas a la raíz del repositorio.

| Id | Título | Estado |
|---|---|---|
| ADR-001 | NestJS + PostgreSQL como stack de la API | Aceptada |
| ADR-002 | Motor DTE propio; LibreDTE sólo como referencia | Aceptada |
| ADR-003 | ESM, Vitest y oxlint | Aceptada |
| ADR-004 | TypeORM 1.x con migraciones explícitas | Aceptada |
| ADR-005 | Firma RSA-SHA1 con C14N 1.0, tal como la exige el SII | Aceptada |
| ADR-006 | Asignación de folios con bloqueo pesimista sin `LIMIT` | Aceptada |
| ADR-007 | Cifrado AES-256-GCM de PFX con clave maestra | Aceptada (parcial) |
| ADR-008 | XSD oficial como fuente de verdad | Aceptada |
| ADR-009 | `fetch` inyectable y token en caché en el gateway | Aceptada |
| ADR-010 | Emisión síncrona y envío asíncrono | Propuesta |
| ADR-011 | Dominio puro `dte-core` y gateway como adaptador | Aceptada |
| ADR-012 | Multiempresa por columna `empresa_id`, RLS pendiente | Aceptada (parcial) |

---

## ADR-001. NestJS + PostgreSQL como stack de la API

**Contexto.** Hay que construir el motor DTE, una API multiempresa y, después, una integración con SAP Business One. El SII exige criptografía XML (RSA-SHA1, C14N), ISO-8859-1 y dos canales (SOAP/upload y REST). La investigación previa (`docs/01-opciones-arquitectura-y-pruebas.md`, sección 2) comparó cinco opciones.

**Decisión.** API en **NestJS (TypeScript) + PostgreSQL** (opción A de `docs/01-…`). Versiones reales en `apps/api/package.json`: NestJS 12, TypeORM 1.1, `pg` 8, Node 24 (`@types/node` 24), TypeScript 6.

**Alternativas.**

| Opción | Por qué se descartó o difirió |
|---|---|
| B. .NET 8/9 | Equivalente técnico (SignedXml soporta rsa-sha1) y mismo lenguaje que el add-on de B1, pero se prefirió un solo lenguaje con el backoffice web y futuros portales. Si el equipo fuera .NET, no cambiaría la arquitectura |
| C. PHP 8.5 + LibreDTE | Menor tiempo hasta certificación, pero licencia AGPL-3.0 sin opción comercial (obliga a publicar el código del servicio) y exige un equipo PHP |
| D. Híbrido con LibreDTE como microservicio | Dos stacks que operar y revisión legal del límite de la AGPL; se mantiene como plan B |
| E. SaaS (LibreDTE SaaS, SimpleAPI, Febos, etc.) | Costo por documento, dependencia y menor diferenciación; la certificación sigue siendo por RUT |

**Consecuencias.**

- (+) El motor DTE es un activo propio y controlado; ecosistema maduro para multiempresa, colas y auditoría.
- (−) No existe una librería DTE madura en TypeScript: hubo que escribir TED, firma, XSD y constructores (ver ADR-002).
- (−) El add-on de SAP B1 será una pieza aparte en C# (fase 4).

**Estado.** Aceptada. Implementada (`apps/api`).

---

## ADR-002. Motor DTE propio; LibreDTE sólo como referencia

**Contexto.** El motor (XML, TED, firma, sobres, estados) es el corazón del producto. LibreDTE es la implementación abierta más completa, pero su licencia AGPL-3.0 obliga a publicar el código de un servicio ofrecido por red.

**Decisión.** Escribir el motor propio en `apps/api/src/dte-core` y `apps/api/src/sii-gateway`, usando LibreDTE **sólo como implementación de referencia** para entender detalles (TED, C14N, codificación, mensajes del SII), sin copiar código.

**Alternativas.** Embeber LibreDTE (AGPL); usarlo como microservicio interno sin modificar (opción D); contratar un SaaS (opción E).

**Consecuencias.**

- (+) Sin obligaciones de copyleft; control total del formato y de las pruebas.
- (+) El motor se apoya en bibliotecas con licencias permisivas: `xml-crypto`, `node-forge`, `libxml2-wasm`, `fast-xml-parser`, `@xmldom/xmldom`, `iconv-lite`, `xpath`.
- (−) Mayor esfuerzo inicial y riesgo de divergencias sutiles con lo que acepta el SII; mitigado con validación XSD en cada prueba y, a futuro, con certificación real.
- (−) El motor no ha sido probado contra el SII: el CAF de prueba tiene `FRMA` aleatorio y no sirve contra el SII real (`apps/api/src/dte-core/README.md`).

**Estado.** Aceptada. Implementada; pendiente de validar en certificación.

---

## ADR-003. ESM, Vitest y oxlint

**Contexto.** El andamiaje de NestJS 12 es ESM-only: sus paquetes sólo se publican como ES modules (`apps/api/AGENTS.md`). Vitest 4 y Vite 8 son nativos de ESM; `oxlint` ofrece reglas con información de tipos.

**Decisión.**

- `"type": "module"`, `module`/`moduleResolution: nodenext`; imports relativos con extensión `.js`; `import.meta.dirname` en lugar de `__dirname` (`apps/api/tsconfig.json`, `apps/api/package.json`).
- Pruebas con **Vitest** (`globals: true`; mocks con `vi.fn()`), con `vitest.config.ts` para unitarias (`**/*.spec.ts`) y `vitest.config.e2e.ts` para e2e.
- Lint con **oxlint** `--type-aware` (`typescript/no-floating-promises: error`, `no-explicit-any` desactivada) y formato con prettier.

**Alternativas.** CommonJS con Jest (el esquema clásico de Nest); ESLint + typescript-eslint.

**Consecuencias.**

- (+) Alineado con el ecosistema actual; ejecución de pruebas rápida; sin transpilación a CJS.
- (−) Gotchas ESM: los archivos de migración deben usar `import type` para `MigrationInterface`/`QueryRunner`, porque Vitest no elimina imports de tipos (`apps/api/src/database/README.md`); el CLI de TypeORM se invoca con `typeorm-ts-node-esm`.
- (−) Ecosistema de plugins de oxlint menor que el de ESLint.

**Estado.** Aceptada. Implementada.

---

## ADR-004. TypeORM 1.x y migraciones explícitas

**Contexto.** El esquema debe ser reproducible y auditable; un error de esquema en un sistema tributario es costoso. TypeORM puede sincronizar el esquema automáticamente, lo que es inaceptable en producción.

**Decisión.**

- `synchronize: false` y `migrationsRun: false`; todo cambio va por migraciones en `apps/api/src/database/migrations/` (`apps/api/src/database/database.module.ts`, `data-source.ts`). Hay una migración inicial, `1794643366818-Inicial.ts`.
- Claves primarias `uuid` con `DEFAULT gen_random_uuid()` (nativo desde PostgreSQL 13, sin extensión), declaradas con `@PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })`. `PrimaryGeneratedColumn('uuid')` se descartó porque genera `uuid_generate_v4()` y exige `uuid-ossp`.
- Enums de Postgres con nombre explícito; `ambiente_sii_enum` **compartido** entre `empresas` y `envios` (en la migración debe aparecer un único `CREATE TYPE`).
- Nomenclatura `snake_case` en español; montos `bigint` (con transformer a `number` en `documentos`); fechas de calendario `date`; instantes `timestamptz`; FK `ON DELETE RESTRICT`.
- Tras `migration:generate`, revisar a mano: TypeORM 1.1 re-detecta como cambio los `DEFAULT gen_random_uuid()` y las FK en cada generación (ruido que debe descartarse).

**Alternativas.** `synchronize: true` (descartada); Drizzle o Prisma (Nest tiene paquete de primera clase para TypeORM y Drizzle; se eligió TypeORM por el ecosistema `@nestjs/typeorm`); SQL a mano sin ORM.

**Consecuencias.**

- (+) Cambios de esquema revisables y reversibles (`migration:revert`).
- (−) Disciplina manual para limpiar el ruido del generador; la migración se ejecuta como paso explícito del despliegue.

**Estado.** Aceptada. Implementada.

---

## ADR-005. Firma RSA-SHA1 con C14N 1.0, tal como la exige el SII

**Contexto.** El SII exige XMLDSig con `rsa-sha1`, digest `sha1` y canonicalización C14N 2001 (`REC-xml-c14n-20010315`). Son algoritmos débiles hoy, pero un cambio sería rechazado por el SII.

**Decisión.** Firmar con `xml-crypto` exactamente así (`apps/api/src/dte-core/firma/firma.ts`):

- Único transform `enveloped-signature`, `Reference URI="#ID"` (para el token de autenticación, firma del documento completo con `URI=""`).
- `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` sin prefijo y como último hijo de la raíz.
- `KeyInfo` = `KeyValue/RSAKeyValue(Modulus, Exponent)` + `X509Data/X509Certificate`, en el orden que exige `xmldsignature_v10.xsd`.
- `verificarFirmaXml` verifica *todas* las firmas del documento (SetDTE y cada DTE) con el certificado embebido; **no** valida la cadena de confianza.
- El `<DTE>` declara `xmlns` y `xmlns:xsi` igual que el sobre, para que la canonización sea idéntica dentro y fuera del sobre.
- El TED (`apps/api/src/dte-core/ted/ted.ts`): `FRMT` = RSA-SHA1 PKCS#1 v1.5 sobre los bytes ISO-8859-1 del string exacto `<DD>…</DD>`, orden fijo de tags, sin espacios, sólo `& < >` escapados; `verificarTed` extrae `<DD>` textualmente.

**Alternativas.** SHA-256 (rechazado por el SII); `libxmlsec`/binarios nativos (peor portabilidad); firmar con `node:crypto` a mano (más riesgo en la canonicalización).

**Consecuencias.**

- (+) Conformidad con lo que el SII valida; pruebas de firma y de TED con certificados y CAF sintéticos.
- (−) Dependencia de un algoritmo obsoleto; hay que vigilar anuncios del SII.
- (−) Pendiente validar el `KeyInfo` y los espacios en blanco contra el ambiente de certificación (`apps/api/src/dte-core/README.md`).

**Estado.** Aceptada. Implementada (9 pruebas de firma, 5 de TED).

---

## ADR-006. Asignación de folios con bloqueo pesimista sin `LIMIT`

**Contexto.** Un folio no puede repetirse ni reutilizarse. Varias solicitudes concurrentes de la misma empresa y tipo deben recibir folios distintos, y puede haber varios CAF (un rango se agota y sigue otro; algunos vencen).

**Decisión.** `FoliosService.asignarSiguienteFolio` (`apps/api/src/folios/folios.service.ts`):

1. Abre una transacción y selecciona con `FOR UPDATE` (`setLock('pessimistic_write')`) **todos** los CAF candidatos: no agotados, no anulados, con `folio_siguiente <= folio_hasta` y no vencidos, ordenados por `fecha_autorizacion` y `folio_desde`.
2. Usa el primero e incrementa `folio_siguiente`; marca `agotado` al terminar el rango.
3. **Sin `LIMIT 1`**: con `FOR UPDATE ... LIMIT 1`, si el CAF bloqueado se agota mientras otra transacción espera, PostgreSQL re-evalúa el `WHERE` sobre esa fila y devuelve 0 filas aunque exista otro CAF disponible. Sin `LIMIT`, el orden de bloqueo es estable (evita deadlocks) y ese caso queda cubierto.
4. `registrarCaf` usa `pg_advisory_xact_lock(hashtext('caf:<empresa>:<tipo>'))` para validar el solapamiento de rangos sin carreras.

**Alternativas.** Secuencia de PostgreSQL por CAF (no permite omitir vencidos ni saltar de CAF de forma simple y deja huecos ante rollback); `SELECT ... FOR UPDATE SKIP LOCKED` (haría que solicitudes concurrentes tomen CAF distintos y desordenen los folios); contador en Redis (nueva dependencia crítica).

**Consecuencias.**

- (+) Garantía de unicidad por transacción; probada con 50 asignaciones concurrentes que entregan folios únicos 1..50 y la 51 falla (`apps/api/test/folios.e2e-spec.ts`, requiere PostgreSQL).
- (+) La unicidad se refuerza con `(empresa_id, tipo_dte, folio)` único en `documentos`.
- (−) Las asignaciones de una misma empresa y tipo se serializan; aceptable para el volumen previsto.
- (−) Si el caso de uso asigna el folio y luego falla antes de persistir el documento, queda un hueco; hay que definir una política (diseñar la asignación dentro de la misma transacción de emisión, o anular el folio ante el SII). No está resuelto.

**Estado.** Aceptada. Implementada.

---

## ADR-007. Cifrado AES-256-GCM de PFX con clave maestra

**Contexto.** El PFX y su contraseña permiten firmar en nombre de una persona natural. Deben estar cifrados en reposo y nunca en texto plano ni en logs.

**Decisión.** `CifradoService` (`apps/api/src/seguridad/cifrado.service.ts`) cifra con **AES-256-GCM** y una clave maestra de 32 bytes en base64 (`CERTIFICADOS_MASTER_KEY`, validada al arrancar en `apps/api/src/config/env.validation.ts` y de nuevo en el constructor). Formato del blob: `versión(1) | iv(12) | tag(16) | ciphertext`; IV aleatorio por mensaje; `descifrar` falla si el tag no coincide (blob alterado o clave distinta). Se almacena en `certificados.pfx_cifrado` y `certificados.password_cifrada` (`bytea`).

**Alternativas.** Cifrado de sobre con KMS/Vault desde el inicio (más seguro, más infraestructura); `pgcrypto` en la base (la clave pasaría por SQL y los logs); almacenar en un secret manager externo.

**Consecuencias.**

- (+) Simple, sin dependencias externas, autenticado (GCM detecta alteraciones); el byte de versión permite evolucionar el formato.
- (−) Una única clave maestra: sin rotación ni KMS. Comprometerla expone todos los PFX; la clave de ejemplo de `apps/api/.env.example` es sólo de desarrollo.
- (−) Aún no hay servicio que cargue certificados ni que use `CifradoService`; sólo está probado de forma aislada (6 pruebas).

**Estado.** Aceptada (parcial). El cifrado de sobre con KMS/Vault queda **Propuesta** (`apps/api/src/database/README.md`).

---

## ADR-008. XSD oficial como fuente de verdad

**Contexto.** El PDF de formato DTE publicado por el SII es de 2014 y está desactualizado; el paquete `schema_dte.zip` más reciente tiene archivos del 2026-02-19. La normativa 2026 sigue cambiando.

**Decisión.** Versionar los XSD oficiales en `apps/api/resources/sii/xsd/` (`DTE_v10`, `EnvioDTE_v10`, `EnvioBOLETA_v11`, `RespSII_v10`, `RespuestaEnvioDTE_v10`, `SiiTypes_v10`, `xmldsignature_v10`) y validar con ellos **todo** documento que se construye en las pruebas (`validarXsd` con `libxml2-wasm`, validadores cacheados; `apps/api/src/dte-core/xsd/xsd.ts`). El orden de tags y los máximos de longitud del constructor siguen el XSD. La carpeta puede redefinirse con `SII_XSD_DIR`; por defecto se busca hacia arriba desde `import.meta.dirname`, de modo que funciona desde `src/` y `dist/`. Los OpenAPI oficiales de boletas están en `apps/api/resources/sii/openapi/`.

**Alternativas.** `libxmljs2` o `xmllint` (la investigación los sugería; se eligió `libxml2-wasm` por no requerir compilación nativa); confiar en el PDF; validar sólo en integración.

**Consecuencias.**

- (+) Detecta divergencias del formato en cada ejecución de pruebas.
- (−) Hay que actualizar el paquete manualmente cuando el SII lo publique; no existe todavía un script de actualización ni de comparación.
- (−) Campos nuevos (IEC, ILA: `TIEBase`, `TpoImpD`…) aún no están en el XSD de febrero de 2026; el constructor tendrá que adaptarse cuando aparezcan.

**Estado.** Aceptada. Implementada.

---

## ADR-009. `fetch` inyectable y token en caché en el gateway

**Contexto.** Los clientes del SII deben poder probarse sin red, soportar el límite de peticiones del SII (HTTP 405) y no pedir un token por cada operación (la semilla vale 2 minutos; el token de boletas, 1 hora).

**Decisión** (`apps/api/src/sii-gateway`, ver su README):

- `fetchImpl` inyectable (por defecto `globalThis.fetch`) y el firmador inyectable mediante la interfaz `FirmadorXml` (`firmarXml(xml, idReferencia?)`): el gateway no depende de `dte-core`.
- **Caché de token** por (tipo `boleta|dte`, ambiente, `rutEmpresa`), en memoria, TTL por defecto 50 minutos, configurable (`cacheToken: { ttlMs, almacen, ahora }`; `false` la desactiva). Las peticiones concurrentes de token se deduplican. Ante 401 (o STATUS 5 del upload, o ESTADO 001/002/003 en consultas DTE) se invalida, se renueva **una sola vez** y se repite la operación. El token de boletas y el de DTE no se mezclan.
- **Reintentos** con backoff exponencial (`maxIntentos = 3`, `esperaBaseMs = 500`, `factor = 2`; `esperar` inyectable): se reintenta 405, 5xx y errores de red; no 400, 401 (salvo renovación), 404 ni otros 4xx.
- **Errores tipados**: `SiiError` y subtipos por categoría; `SiiEnvioDteError` con `status`, `glosa` y `errores[]`.
- Hosts por ambiente en `ambientes.ts`, con host alternativo (`pangal`/`rahue`) para el POST de envío de boletas.

**Alternativas.** Librería SOAP (`soap`) en lugar de armar los envelopes a mano (los WSDL del SII son rpc/encoded; se prefirió control total); biblioteca de reintentos externa; caché distribuida desde el inicio.

**Consecuencias.**

- (+) 85 pruebas sin tocar la red; la caché y los reintentos son configurables por prueba (`ahora`, `esperar`).
- (−) La caché es por proceso: con varias réplicas hay que proporcionar un `almacen` compartido (Redis).
- (−) Supuestos no confirmados con el SII real (envelopes SOAP sin namespace de método, nombres de parámetros de `getEstUp`, cookie `TOKEN` en consultas SOAP). Sin circuit breaker ni respeto de `X-Retry-After`/`X-RateLimit-*`.
- El gateway no valida el tope de boletas por envío (500, recomendado 50): es responsabilidad del dominio.

**Estado.** Aceptada. Implementada como librería; sin cablear a un módulo Nest.

---

## ADR-010. Emisión síncrona y envío asíncrono

**Contexto.** Un POS necesita imprimir la boleta de inmediato, pero el SII puede estar lento o caído, impone límites (405) y recomienda agrupar boletas. Las guías y facturas que amparan traslado deben estar recibidas por el SII antes del traslado (Res. Ex. 99/2019).

**Decisión.** Separar en dos tiempos:

1. **Emisión síncrona**: validar, asignar folio, construir el DTE, timbrar, firmar y persistir en una sola solicitud (meta de menos de 1 s), con `Idempotency-Key` (columna `clave_idempotencia`).
2. **Envío asíncrono**: outbox + cola (BullMQ sobre Redis) para agrupar boletas (hasta 50 por sobre), enviar, guardar el Track ID, consultar el estado con polling programado y registrar reparos y rechazos; prioridad alta para guías y facturas con traslado.

Modelo de estados: `borrador → emitido → encolado → enviado → aceptado | aceptado con reparos | rechazado`; la tabla y el enum ya existen (`estado_documento_enum`), la lógica no.

**Alternativas.** Emisión y envío síncronos (el POS quedaría atado a la disponibilidad del SII); emisión asíncrona completa (el POS no tendría folio ni TED para imprimir); cron con la base como cola.

**Consecuencias.**

- (+) El POS no depende del SII; permite reintentos, límites y priorización.
- (−) Más piezas operativas (Redis, worker); el cliente debe aceptar estados intermedios y webhooks.
- (−) Requiere resolver los huecos de folio (ADR-006) y la caché de token compartida (ADR-009).

**Estado.** Propuesta (no hay código; Redis sólo está declarado en `docker-compose.yml` y BullMQ no está en `package.json`).

---

## ADR-011. Dominio puro `dte-core` y gateway como adaptador

**Contexto.** El núcleo criptográfico y de XML es la parte con más riesgo normativo y más pruebas; debe poder ejecutarse sin base de datos, sin red y sin el framework.

**Decisión.** `apps/api/src/dte-core` es dominio puro: sin decoradores Nest ni IO de red; recibe y devuelve tipos, strings y `Buffer`. `apps/api/src/sii-gateway` es el adaptador hacia el SII, también como clases puras con dependencias inyectadas por constructor. Los módulos Nest (`empresas`, `certificados`, `folios`, `documentos`, `envios`) sólo hacen persistencia. El caso de uso futuro será quien combine las piezas. Las utilidades de prueba (`generarCertificadoPrueba`, `generarPfxPrueba`, `generarCafPrueba`, `documentoDePrueba`) viven en `testing/` y no se exportan desde `index.ts`.

**Alternativas.** Un módulo Nest por dominio con servicios acoplados al framework; un paquete npm separado desde el inicio (monorepo con workspaces).

**Consecuencias.**

- (+) Pruebas rápidas y deterministas; reutilizable por un worker o un add-on.
- (−) Más código de pegamento al integrar; dos tipos `AmbienteSii` duplicados (`apps/api/src/config/sii.config.ts` y `apps/api/src/sii-gateway/ambientes.ts`) que conviene unificar.

**Estado.** Aceptada. Implementada.

---

## ADR-012. Multiempresa por columna `empresa_id`, RLS pendiente

**Contexto.** Cada emisor (RUT) tiene su certificado, sus CAF y sus documentos; los datos de un cliente no pueden filtrarse a otro.

**Decisión.** Modelo de **base compartida y esquema compartido**: toda tabla de negocio lleva `empresa_id` (FK `ON DELETE RESTRICT`) y las claves únicas incluyen la empresa (`(empresa_id, tipo_dte, folio)`, `(empresa_id, clave_idempotencia)`). El ambiente SII se define por empresa (`ambiente_sii`), con `SII_AMBIENTE` como valor por defecto. Se **planifica** habilitar Row Level Security con políticas por `current_setting('app.empresa_id')`, un rol de aplicación sin `BYPASSRLS` y el setting fijado por transacción.

**Alternativas.** Una base o un esquema por empresa (aislamiento fuerte, más costo operativo y migraciones multiplicadas); aislamiento sólo en aplicación (el estado actual).

**Consecuencias.**

- (+) Operación simple con un único esquema.
- (−) Hoy el aislamiento depende de que cada consulta filtre por `empresa_id`; un olvido filtra datos entre clientes. Debe cerrarse con RLS antes de exponer la API.

**Estado.** Aceptada (parcial): columnas y claves implementadas; RLS, **Propuesta**.
