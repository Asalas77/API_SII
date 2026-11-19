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
| `empresas` | Emisor (tenant). RUT único, giro, ACTECOs (`int[]`), resolución SII, `ambiente_sii` (`certificacion`/`produccion`). |
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

## Pendientes

- **RLS multiempresa**: habilitar `ROW LEVEL SECURITY` en todas las tablas con `empresa_id`, políticas por `current_setting('app.empresa_id')` y un rol de aplicación sin `BYPASSRLS`; fijar el setting por transacción. Hoy el aislamiento depende de filtrar por `empresa_id` en cada consulta.
- **Retención**: política de conservación legal de DTE y envíos (6 años, a verificar) y purga/archivado de `envios.xml_envio` y `respuesta`.
- **Object storage** para XML firmado, XML de envío y PDF: hoy `documentos.xml_firmado` y `envios.xml_envio` son `text` en la BD; moverlos a S3/compatible y guardar solo la referencia.
- Cifrado de sobre con KMS/Vault en lugar de la clave maestra única (rotación; el byte de versión del blob lo permite).
- Particionado de `documentos` si el volumen lo requiere; auditoría de cambios.
