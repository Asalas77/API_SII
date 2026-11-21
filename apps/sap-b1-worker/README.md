# sap-b1-worker

Worker de integración (**fase 1**) entre SAP Business One y la API de DTE/boletas de este repositorio (`apps/api`). Diseño: [`docs/diseno/14-integracion-sap-b1.md`](../../docs/diseno/14-integracion-sap-b1.md).

Qué hace, en un ciclo (por defecto cada 30 s):

1. **Emisión.** Lee de Service Layer los documentos (`Invoices`, `CreditNotes`, `DeliveryNotes`) con `U_SII_Estado = 'PENDIENTE'`, los marca `ENVIANDO`, los mapea al cuerpo de `POST /v1/empresas/:rut/documentos` y los emite con `Idempotency-Key = b1:{rutEmpresa}:{objType}:{DocEntry}`. Escribe en B1 `EMITIDO`, folio, id del documento, URLs de XML/PDF y adjunta el PDF.
2. **Envío al SII.** Los documentos `EMITIDO` se envían con `POST /v1/empresas/:rut/envios` (`{ documentoIds }`; boletas 39/41 en llamadas separadas del resto) y pasan a `ENVIADO` con su `U_SII_TrackId`. Se desactiva con `ENVIAR_AUTOMATICAMENTE=false`.
3. **Seguimiento.** Los `ENVIADO` se consultan con `POST /v1/documentos/:id/consultar-estado` (como mínimo cada `SEGUIMIENTO_MIN_SEGUNDOS`) y pasan a `ACEPTADO`, `REPAROS` o `RECHAZADO`, con la glosa del SII en `U_SII_Glosa`.
4. **Conciliación.** Al arrancar y cada `CONCILIACION_MINUTOS` se reintentan todos los `ENVIANDO` con su `U_SII_IdemKey`; la API devuelve el documento ya emitido (200 + `Idempotent-Replayed: true`), así que nunca hay folio doble.

La API es la autoridad tributaria y de folios: el worker no calcula totales, no toca CAF ni firma.

## Requisitos

**En B1**
- SAP Business One 10.0 (HANA o SQL Server) con **Service Layer** habilitado. `SL_VERSION=v2` (OData v4, `/b1s/v2`) en 10.0 FP 2011 o posterior; `v1` (`/b1s/v1`) en versiones anteriores. *No se pudo verificar sin un B1 real.*
- Un usuario de B1 **dedicado al worker** con permisos mínimos: lectura de facturas/notas de crédito/entregas y de socios de negocios; escritura (actualizar) de esos documentos para los campos de usuario; alta de campos de usuario sólo mientras se ejecuta `instalar-udfs` (se puede usar un usuario administrador para ese paso y luego quitarlo); adjuntos (`Attachments2`).
- Licencia: el worker consume **una** sesión de Service Layer (reutilizada entre ciclos; `Logout` al apagar). Revise el límite de sesiones concurrentes de su licencia (ver *Solución de problemas*).
- Los UDF `U_SII_*` (ver abajo).

**En la API**: la empresa creada, CAF cargados, certificado activo y una **API key** (`Authorization: Bearer`) con los permisos `documentos.emitir`, `documentos.leer`, `envios.crear` y `envios.leer`, restringida a la empresa del worker (ver `apps/api/src/auth/README.md`).

**Runtime**: Node 24. Sin dependencias de runtime (`fetch` nativo).

## Instalación de los UDF

```bash
cd apps/sap-b1-worker
npm install
cp .env.example .env        # complete SL_* , API_KEY, EMPRESA_RUT
npm run instalar-udfs -- --dry-run   # imprime los UserFieldsMD que crearía, sin conectarse
npm run instalar-udfs                # los crea; si existen lo informa y sigue (idempotente)
```

Campos creados (prefijo `U_`; se crean en `OINV`, `ORIN` y `ODLN` salvo que se indique):

| UDF | Tipo | Quién lo escribe | Uso |
|---|---|---|---|
| `U_SII_TipoDTE` | Alfa 3, valores 33/34/39/41/52/56/61 | Usuario / worker | Tipo a emitir. Si está vacío se deriva (ver mapeo). El worker lo deja escrito al emitir |
| `U_SII_Estado` | Alfa 20, valores válidos (ver Estados) | Usuario (`PENDIENTE`) / worker | Estado de la integración |
| `U_SII_Folio` | Número | Worker | Folio asignado por la API |
| `U_SII_TrackId` | Alfa 20 | Worker | Track ID del envío al SII |
| `U_SII_Glosa` | Memo | Worker | Glosa de error, estado del SII y reparos |
| `U_SII_DocId` | Alfa 36 | Worker | UUID del documento en la API |
| `U_SII_XmlUrl`, `U_SII_PdfUrl` | Alfa 254 | Worker | URLs de la API (requieren la API key para descargar) |
| `U_SII_IdemKey` | Alfa 100 | Worker | Idempotency-Key usada |
| `U_SII_IndTraslado` | Alfa 1 | Usuario | Sólo `ODLN`: indicador de traslado 1 a 9 (obligatorio en guías) |
| `U_SII_Transporte` | Alfa 254 | Usuario | Sólo `ODLN`: texto libre; viaja en `origen.transporte` (la API aún no tiene el bloque de transporte) |
| `U_SII_CodRef` | Alfa 1 | Usuario | `OINV`/`ORIN`: código de referencia de notas 1/2/3 (3 por defecto) |
| `U_SII_RazonRef` | Alfa 90 | Usuario | `OINV`/`ORIN`: razón de la referencia |
| `U_SII_TipoDocRef`, `U_SII_FolioRef` | Alfa 3 / 18 | Usuario | `OINV`/`ORIN`: referencia manual cuando la nota no se creó copiando de un documento base |
| `U_SII_Giro` | Alfa 40 | Usuario | En `OCRD` (socio de negocios): giro del receptor |

Para emitir, el usuario (o una regla/UDO/query de B1) pone `U_SII_Estado = 'PENDIENTE'` en un documento ya agregado.

## Variables de entorno

Todas se validan al arrancar (se informan todos los errores juntos). `.env` se carga con `process.loadEnvFile` si existe; las variables ya definidas en el entorno tienen prioridad. Ver `.env.example`.

| Variable | Defecto | Descripción |
|---|---|---|
| `SL_URL` | — | URL base de Service Layer sin `/b1s/vN` (p. ej. `https://b1:50000`) |
| `SL_VERSION` | `v2` | `v1` o `v2` |
| `SL_COMPANY_DB`, `SL_USER`, `SL_PASSWORD` | — | Credenciales (nunca se registran en logs) |
| `SL_TIMEOUT_MS`, `SL_PAGINA_MAX` | 30000, 100 | Timeout por petición; tamaño de página OData |
| `API_URL` | `http://localhost:3000` | Base de la API (se agrega `/v1`) |
| `API_KEY` | — | API key de la empresa |
| `EMPRESA_RUT` | — | RUT emisor en la API (con o sin puntos; se valida el DV) |
| `INTERVALO_SEGUNDOS` | 30 | Pausa entre ciclos (no se solapan) |
| `CONCILIACION_MINUTOS` | 60 | Cada cuánto se reintentan todos los `ENVIANDO` (además de al arrancar) |
| `CONCURRENCIA` | 2 | Documentos procesados en paralelo |
| `ENVIAR_AUTOMATICAMENTE` | `true` | Dispara el envío al SII tras emitir |
| `SEGUIMIENTO_MIN_SEGUNDOS` | 120 | Mínimo entre consultas de estado del mismo documento |
| `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS` | 30000, 600000 | Backoff exponencial de reintentos transitorios |
| `B1_CODIGOS_EXENTOS` | `IVA_EXE,EXE` | `TaxCode` tratados como exentos |
| `B1_GRUPOS_PAGO_CONTADO` | `-1` | `PaymentGroupCode` de pago contado (formaPago 1; el resto crédito, 2) |
| `B1_CAMPO_GIRO` | `U_SII_Giro` | Campo del socio con el giro |

## Cómo correr

```bash
npm start                  # ciclo continuo (compila y arranca); SIGINT/SIGTERM apagan ordenadamente
npm run once               # un ciclo con conciliación y sale
npm run instalar-udfs      # ver arriba
npm test                   # pruebas (Service Layer y API simulados; no requieren SAP ni la API)
npm run typecheck && npm run lint
```

Logs: una línea JSON por evento en stdout (`ts`, `nivel`, `msg`, contexto). Nunca incluyen la API key, la contraseña ni la cookie de sesión.

### Varias empresas

Una instancia del worker = una company de B1 = un RUT emisor de la API. Para varias empresas, ejecute una instancia por empresa con su propio `.env` (por ejemplo `node --env-file=... dist/main.js start`, o variables de entorno por servicio/contenedor), cada una con su propia API key limitada a su RUT.

### TLS autofirmado

Service Layer suele usar un certificado autofirmado. **No** se desactiva la verificación TLS. Exporte la CA (o el propio certificado) en PEM:

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/b1/ca-b1.pem
```

(en Windows PowerShell: `$env:NODE_EXTRA_CA_CERTS = 'C:\certs\ca-b1.pem'`). El certificado debe incluir el host usado en `SL_URL` en su SAN.

## Estados (`U_SII_Estado`)

| Estado | Significado | Quién avanza |
|---|---|---|
| `PENDIENTE` | Listo para emitir | Usuario lo marca; el worker lo toma |
| `ENVIANDO` | Emisión en curso o con fallo transitorio (red, 5xx, sesión). Se reintenta con la **misma** `Idempotency-Key` y backoff exponencial | Worker |
| `EMITIDO` | Folio asignado, XML firmado en la API; aún sin enviar al SII | Worker |
| `ENVIADO` | Enviado al SII, con `U_SII_TrackId`, esperando resultado | Worker |
| `ACEPTADO` | El SII lo aceptó | Final |
| `REPAROS` | Aceptado con reparos (ver `U_SII_Glosa`) | Final |
| `RECHAZADO` | Rechazado por el SII (o anulado). Corrija y emita un documento nuevo / nota | Final |
| `ERROR` | La API (o la validación local) rechazó el documento; **sin reintento**. Corrija el dato y vuelva a poner `PENDIENTE` | Usuario |

Errores de la API (tabla de la sección 7 del diseño): `400/409/413/422` (`DOCUMENTO_INVALIDO`, `SIN_FOLIOS_DISPONIBLES`, `IDEMPOTENCIA_CONFLICTO`, certificado/CAF inválido…) pasan a `ERROR` con el detalle en `U_SII_Glosa`; red, `5xx`, `429`, `401/403` (clave mal configurada) y `404` (empresa) dejan `ENVIANDO` y se reintentan. Tras cargar un CAF, vuelva a poner `PENDIENTE` los documentos en `ERROR` por falta de folios.

Un documento en `ERROR` por `IDEMPOTENCIA_CONFLICTO` significa que ese documento B1 ya se emitió con otro contenido: no se puede reemitir; corríjalo con una nota de crédito.

## Mapeo B1 → DTE

- **Tipo**: `U_SII_TipoDTE` si está; si no, `Invoices` → 33 (o 34 si todas las líneas son exentas), `CreditNotes` → 61, `DeliveryNotes` → 52. Boletas 39/41 y nota de débito 56 se piden con `U_SII_TipoDTE` (en B1 no existe una entidad estándar de nota de débito: se modela como una factura de deudores con `U_SII_TipoDTE = 56`, referencia por líneas copiadas o por `U_SII_TipoDocRef`/`U_SII_FolioRef`). Un tipo incompatible con la entidad es error de validación.
- **Receptor**: socio (`BusinessPartners`): `LicTradNum` (RUT; se valida el DV antes de llamar), `CardName`, giro desde `B1_CAMPO_GIRO`, dirección de facturación (`PayToCode` o la primera `bo_BillTo`; `County` → comuna, `City` → ciudad), correo y teléfono. Boletas: sin RUT o `66666666-6` → sin receptor (consumidor final).
- **Líneas**: nombre truncado a 80 (el texto completo pasa a `descripcion`), `Quantity`, `UnitPrice` neto (boletas: `PriceAfterVAT`, o neto × (1+IVA) si falta), `DiscountPercent`, exento si `TaxCode ∈ B1_CODIGOS_EXENTOS`. Límites: 60 líneas (1000 en boletas).
- **Descuento de cabecera** (`DiscountPercent`) → `descuentosRecargos`; en documentos mixtos se emiten dos descuentos (afecto y exento).
- **Pago**: `PaymentGroupCode ∈ B1_GRUPOS_PAGO_CONTADO` → contado (1), otro → crédito (2); `DocDueDate` como vencimiento. No se informa en boletas ni guías.
- **Notas 61/56**: documento base por `BaseType/BaseEntry` de las líneas; se lee su `U_SII_Folio`, `U_SII_TipoDTE` y fecha. Sin folio en el base → `ERROR` con mensaje claro (emita primero el base). `codRef` de `U_SII_CodRef` (3 por defecto).
- **Guía 52**: `U_SII_IndTraslado` obligatorio.
- `origen` lleva `{ sistema: 'SAP_B1', objType, docEntry, docNum }` (y `transporte` en guías) para correlación.

No mapeado todavía: impuestos adicionales/específicos, retenciones, boletas por medio de pago (`medioPago`), referencias en facturas copiadas desde guías, proveedor de software de boletas y bloque de transporte de la guía (dependen de la API/`dte-core`).

## Solución de problemas

- **`self-signed certificate` / `unable to verify the first certificate`**: configure `NODE_EXTRA_CA_CERTS` (arriba). No existe opción para saltarse la verificación.
- **401 en Login** (`Fail to get DB Credentials…`): revise `SL_COMPANY_DB` (nombre de la base, no de la empresa), usuario y contraseña, y que el usuario tenga permiso de Service Layer.
- **Sesiones**: el timeout de sesión de Service Layer es de 30 min por defecto *(verificar)*; el worker reautentica una vez ante 401. Si ve `ErrorServiceLayer` por límite de sesiones/licencias, otro cliente de Service Layer está ocupando las licencias disponibles: cierre sesiones huérfanas o asigne una licencia al usuario del worker. Dos instancias del worker contra la misma company consumen dos sesiones.
- **Documentos que quedan `ENVIANDO`**: mire el log (`emision fallida…`): API caída, clave inválida (401/403) o sesión. Se reintentan solos; la conciliación los retoma al reiniciar.
- **Campo `U_SII_*` rechazado en PATCH**: ejecute `instalar-udfs`; el valor de `U_SII_Estado` debe estar entre los valores válidos.
- **`E2E` opcional**: `API_SII_E2E=1 API_URL=... API_KEY=... EMPRESA_RUT=... npm run test:e2e` emite una factura de prueba contra la API real (consume un folio) con Service Layer simulado.
