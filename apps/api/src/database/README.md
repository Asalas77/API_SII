# Base de datos

PostgreSQL + TypeORM 1.x. `synchronize` está desactivado: todo cambio de esquema va por migraciones en `src/database/migrations/`.

## Modelo de datos

```
empresas 1──* certificados
empresas 1──* cafs 1──* documentos *──* envios   (vía envio_documentos)
empresas 1──* documentos
empresas 1──* envios
```

| Tabla | Descripción |
|---|---|
| `empresas` | Emisor (tenant). RUT único, giro, ACTECOs (`int[]`), resolución SII, `ambiente_sii` (`certificacion`/`produccion`), opciones del PDF (`unidad_sii`, `url_verificacion`, `logo` bytea + `logo_tipo`). |
| `certificados` | PFX y clave **cifrados** (`bytea`, AES-256-GCM vía `CifradoService`), vigencia, firmante. Índice `(empresa_id, activo)`. |
| `cafs` | CAF por tipo de DTE: rango, `folio_siguiente` (cursor), vencimiento, XML completo, `agotado`/`anulado`. Único `(empresa_id, tipo_dte, folio_desde)`. |
| `documentos` | DTE emitido: folio, receptor, montos (`bigint`), `estado`, `track_id`, XML firmado, TED, `reparos` (jsonb), `clave_idempotencia`. Único `(empresa_id, tipo_dte, folio)` y único parcial `(empresa_id, clave_idempotencia)` cuando no es null. |
| `envios` | Envío al SII (canal `dte`/`boleta`), Track ID, estado SII (REC, EPR, RPR, RCH…), respuesta jsonb, intentos. |
| `envio_documentos` | N:M envío–documento con estado/glosa por documento. PK compuesta. |

### Convenciones

- Tablas y columnas en `snake_case` y español (terminología del SII); entidades y servicios también en español.
- Entidades en `src/<modulo>/entities/*.entity.ts` (el `DataSource` de la CLI las descubre por ese patrón).
- PK `uuid` con `DEFAULT gen_random_uuid()` (nativo de PostgreSQL 13+, sin extensiones). En las entidades se declara con `@PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })`, no con `PrimaryGeneratedColumn('uuid')`, que genera `uuid_generate_v4()` y requiere la extensión `uuid-ossp`.
- Fechas de calendario (`fecha_emision`, `fecha_vencimiento`…) son `date` y se manejan como string `YYYY-MM-DD`; instantes son `timestamptz`.
- Montos `bigint` (pg los devuelve como string; `documentos` los convierte a `number` con un transformer).
- Todas las FK usan `ON DELETE RESTRICT`. Toda tabla de negocio lleva `empresa_id` (multiempresa).
- Los enums de Postgres tienen nombre explícito (`ambiente_sii_enum`, `estado_documento_enum`, `canal_envio_enum`); `ambiente_sii_enum` es compartido por `empresas` y `envios`.

### Cifrado del CAF y migración `CifrarCafYEmision`

`cafs.xml_cifrado` (bytea, AES-256-GCM vía `CifradoService`) guarda el CAF completo, que incluye la clave privada RSASK. `cafs.xml` queda **nullable y deprecado**: las filas anteriores conservan el XML en claro hasta que `FoliosService` las lee (lo cifra y deja `xml` en NULL) o se llama `FoliosService.cifrarCafsHeredados()`. También agrega `documentos.huella_solicitud` (idempotencia), `documentos.origen` (jsonb) y `empresas.rut_proveedor_software`/`dv_proveedor_software`.

### Folios

`asignarSiguienteFolio(empresaId, tipo, fecha?, manager?)` acepta un `EntityManager` para participar en la transacción de la emisión: si el documento no se guarda, el folio no se consume. Las fechas (`fecha_vencimiento`, "hoy") se calculan en `America/Santiago`. `registrarCaf` valida el RUT del CAF contra la empresa y calcula el vencimiento (6 meses en 33/56/61; sin vencimiento en el resto) si no viene.

`FoliosService.asignarSiguienteFolio` abre una transacción y selecciona los CAF candidatos (no agotados, no anulados, con folios libres y no vencidos) con `FOR UPDATE`, ordenados por fecha de autorización y `folio_desde`; usa el primero e incrementa `folio_siguiente` (marca `agotado` al terminar el rango). Se bloquean todos los candidatos y no solo uno (`LIMIT 1`) a propósito: con `FOR UPDATE ... LIMIT 1`, si el CAF se agota mientras otra transacción espera, Postgres re-evalúa el `WHERE` y devuelve 0 filas aunque exista otro CAF. `registrarCaf` usa un advisory lock por empresa y tipo para validar el solapamiento de rangos sin carreras.

## Migraciones

Requiere Postgres arriba (`docker compose up -d postgres`; el puerto de host es 5433 si el 5432 está ocupado) y `.env` con `DATABASE_*`.

```bash
npm run migration:generate -- src/database/migrations/NombreCambio   # diff entidades vs. BD
npm run migration:run
npm run migration:show
npm run migration:revert                                              # deshace la última
```

Después de generar, **revisar a mano** el archivo:

- Los archivos de migración deben importar `MigrationInterface`/`QueryRunner` con `import type` (los tests con Vitest no eliminan imports de tipos y fallarían al cargar la migración).
- TypeORM 1.1 re-detecta como cambio los `DEFAULT gen_random_uuid()` y las FK en cada `migration:generate` (ruido: `DROP/SET DEFAULT` y `DROP/ADD CONSTRAINT` de FK sin cambio real). Si aparece una migración con solo eso, descartarla.
- Si un enum se comparte entre tablas, verificar que `CREATE TYPE` aparezca una sola vez.

## Row Level Security (RLS)

Segunda barrera de aislamiento por empresa. La primera sigue siendo la aplicación (guards, `src/auth/README.md`); RLS garantiza que, aunque un servicio olvide filtrar, PostgreSQL no devuelve ni deja escribir filas de empresas fuera del alcance del principal. Migración: `1795200000000-RowLevelSecurity`.

### Roles

- **Dueño** (`DATABASE_USER`): crea el esquema y corre las migraciones. En el docker local es SUPERUSER (salta RLS).
- **Rol de aplicación** (`DATABASE_APP_USER`, por defecto `api_sii_app`): lo crea la migración `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, con la contraseña de `DATABASE_APP_PASSWORD` leída al correr `migration:run` (sin ella se crea `NOLOGIN` y se avisa). Solo tiene DML (`SELECT/INSERT/UPDATE/DELETE`) sobre las tablas de negocio, `USAGE` en secuencias y `ALTER DEFAULT PRIVILEGES` para las tablas futuras. La API se conecta con él en runtime; si no está definido usa el dueño y **registra un warning** (en `NODE_ENV=production` las variables son obligatorias y `VerificadorRolBd` aborta el arranque si el rol es superusuario o tiene `BYPASSRLS`).
- Producción gestionada sin `CREATEROLE`: cree el rol a mano; la migración solo normaliza atributos y otorga privilegios.

### Contexto y políticas

El contexto viaja en dos variables **locales a la transacción** (`set_config(..., true)`; jamás `false`, para que no se filtren por el pool): `app.todas_empresas` (`on`/`off`) y `app.empresas` (RUT normalizados `76086428-5` separados por coma).

- `empresas`: `app_rut_permitido(rut, dv)` (función SQL STABLE, SECURITY INVOKER) = `todas_empresas = 'on'` o `rut || '-' || upper(dv)` en la lista (mismo formato que `normalizarRut`).
- `certificados`, `cafs`, `documentos`, `envios`: `empresa_id IN (SELECT id FROM empresas)`; la subconsulta ya está filtrada por la política de `empresas` y se evalúa una vez por consulta. `documentos` además exige que `caf_id` sea de un CAF visible (las FK se validan saltándose RLS).
- `envio_documentos`: su envío y su documento deben ser visibles.
- Todas con `ENABLE` + `FORCE ROW LEVEL SECURITY`, `USING` y `WITH CHECK`. Sin contexto, 0 filas y los INSERT fallan (fail-closed).
- `api_keys` **no** tiene RLS: se consulta antes de conocer al principal (es la tabla que lo determina) y solo guarda prefijo y hash SHA-256.
- Con `FORCE`, incluso un dueño no superusuario necesita contexto: una migración futura que lea/escriba datos de estas tablas debe hacer `SELECT set_config('app.todas_empresas','on',true)` en su transacción.

### Uso en código

`EjecutorEmpresa` (`ejecutor-empresa.ts`, global) es el único camino a tablas con RLS: `ejecutor.ejecutar((em) => em.getRepository(X)...)`. Abre una transacción corta, fija los GUC con el contexto de AsyncLocalStorage (`contexto-empresa.ts`) y ejecuta; si ya hay una transacción en curso la reutiliza (emisión: folio + documento en la misma). `ContextoEmpresaInterceptor` (global, tras los guards) fija el contexto desde `request.principal`; los `@Publico()` no tienen contexto. Sin contexto, `ejecutar` lanza `ContextoEmpresaFaltanteError` (no devuelve vacío en silencio). Se eligió transacción corta por operación y no un QueryRunner por petición para no retener conexiones durante PFX/PDF/llamadas al SII.

- **Ejecutar como sistema** (CLI, procesos internos, fixtures): `ejecutor.ejecutarComoSistema(fn)` o `comoSistema(() => ...)` (todas las empresas). Nunca desde código que atiende peticiones. La CLI de certificación (`ejecutarSet`) ya lo hace.
- **Crear empresa** con una key acotada: `EmpresasService.crear` usa `ampliarRuts` para sumar el RUT nuevo al contexto solo durante el INSERT (WITH CHECK).
- Las tablas sin RLS (`api_keys`) pueden usar repositorios normales.
- Tests: los e2e siembran/limpian con `test/helpers/fixtures.ts` (conexión del dueño con `app.todas_empresas=on` a nivel de sesión) y la API corre con el rol de aplicación; `test/rls.e2e-spec.ts` demuestra las políticas con SQL directo y falla si una tabla con `empresa_id` no tiene RLS forzada.

### Agregar una tabla nueva

1. Columna `empresa_id uuid NOT NULL` con FK a `empresas` e índice que la lleve primero.
2. En su migración: `ENABLE` y `FORCE ROW LEVEL SECURITY` y `CREATE POLICY aislamiento_empresa ON t FOR ALL USING (empresa_id IN (SELECT id FROM empresas)) WITH CHECK (empresa_id IN (SELECT id FROM empresas))` (tablas sin `empresa_id`: derive del padre como `envio_documentos`). Los privilegios al rol de aplicación llegan por `DEFAULT PRIVILEGES`.
3. Acceda siempre mediante `EjecutorEmpresa`. Si olvida RLS, el e2e `rls` falla.

## Pendientes

- **Retención**: política de conservación legal de DTE y envíos (6 años, a verificar) y purga/archivado de `envios.xml_envio` y `respuesta`.
- **Object storage** para XML firmado, XML de envío y PDF: hoy `documentos.xml_firmado` y `envios.xml_envio` son `text` en la BD; moverlos a S3/compatible y guardar solo la referencia.
- Cifrado de sobre con KMS/Vault en lugar de la clave maestra única (rotación; el byte de versión del blob lo permite).
- Particionado de `documentos` si el volumen lo requiere; auditoría de cambios.
