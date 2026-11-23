# API SII — Facturación y boletas electrónicas (Chile) + add-on SAP Business One

API REST multiempresa para emitir **Documentos Tributarios Electrónicos** (facturas 33/34, guías 52, notas 56/61) y
**boletas electrónicas** (39/41) ante el Servicio de Impuestos Internos de Chile, con una integración posterior para
SAP Business One. Las decisiones de arquitectura, la estrategia de pruebas y el plan por fases están en
[`docs/01-opciones-arquitectura-y-pruebas.md`](docs/01-opciones-arquitectura-y-pruebas.md).

La documentación de ingeniería de diseño completa (arquitectura, datos, flujos, seguridad, API, pruebas, operación, decisiones y roadmap) está en [`docs/diseno/`](docs/diseno/00-indice.md).

## Estructura del repositorio

| Ruta | Contenido |
|---|---|
| `apps/api/` | API NestJS 12 (ESM, TypeScript estricto, Vitest, oxlint, TypeORM 1.x, PostgreSQL) |
| `apps/api/src/dte-core/` | Núcleo de dominio puro: CAF, timbre electrónico (TED), firma XMLDSig, utilidades XML/ISO-8859-1, validación XSD, carga de PFX, constructores de documentos y sobres de envío |
| `apps/api/src/sii-gateway/` | Clientes HTTP hacia el SII: API REST de boletas (semilla, token, envío, estados) y web services SOAP + upload de DTE |
| `apps/api/src/config/`, `database/`, `health/`, `seguridad/` | Configuración validada con Joi, TypeORM y migraciones, `GET /health`, cifrado AES-256-GCM de certificados |
| `apps/api/src/empresas/`, `certificados/`, `folios/`, `documentos/`, `envios/` | Modelo de datos multiempresa y servicio transaccional de folios |
| `apps/sap-b1-worker/` | Worker de integración con SAP Business One (fase 1): lee documentos por Service Layer, los emite en la API `/v1`, los envía al SII y escribe folio/estado en UDFs `U_SII_*`. Node 24, TypeScript, sin dependencias de runtime; ver su README |
| `apps/sap-b1-addon/` | Add-on C# de SAP Business One (fase 2): núcleo netstandard2.0 probado con fakes (`SapB1Addon.Core`, xUnit) y capa UI API/DI API net48 x64 que solo compila con el SDK de SAP (`-p:SapB1SdkDir=...`); botones Emitir/Reenviar/PDF/Estado/Validar sobre la misma API y UDF que el worker. Sin compilar ni probar contra un B1 real; ver su README |
| `apps/api/resources/sii/` | XSD oficiales del SII (paquete del 2026-02-19 y `EnvioBOLETA_v11.xsd`) y OpenAPI oficial de la API de boletas |
| `docs/` | Documento de arquitectura y referencias oficiales descargadas (`docs/referencias-sii/`) |
| `docker-compose.yml` | PostgreSQL 16 y Redis 7 para desarrollo |

## Requisitos

- Node.js 24 y npm 11.
- Docker con Docker Compose (PostgreSQL y Redis).
- Para hablar con el SII: certificado digital de un firmante autorizado (PFX) y archivos CAF de la empresa. No son
  necesarios para correr las pruebas unitarias: el núcleo genera certificados y CAF sintéticos para los tests.

## Puesta en marcha

```bash
docker compose up -d postgres
```

Si el puerto 5432 del host ya está ocupado por otro PostgreSQL, usa otro puerto:

```bash
POSTGRES_HOST_PORT=5433 docker compose up -d postgres
```

```bash
cd apps/api && cp .env.example .env
```

Ajusta `DATABASE_PORT` en `.env` si cambiaste el puerto, y genera una clave maestra propia para
`CERTIFICADOS_MASTER_KEY` con `openssl rand -base64 32`.

```bash
cd apps/api && npm install
```

```bash
cd apps/api && npm run migration:run
```

```bash
cd apps/api && npm run start:dev
```

- `GET http://localhost:3000/` → nombre, versión y ambiente SII configurado.
- `GET http://localhost:3000/health` → estado de la base de datos.
- Los recursos de negocio están bajo `/v1` y exigen una API key (`Authorization: Bearer <clave>`). Define `API_ADMIN_KEY` en `.env` para crear empresas y claves; ver `apps/api/src/auth/README.md`.

## Pruebas y calidad

```bash
cd apps/api && npm test
```

```bash
cd apps/api && npm run test:e2e
```

```bash
cd apps/api && npm run lint
```

Las pruebas unitarias cubren el núcleo (TED, firma, XSD, constructores) y los clientes del SII con `fetch`
simulado; las e2e usan el PostgreSQL de Docker (se omiten si no hay `DATABASE_HOST`). Todo documento construido
se valida contra los XSD oficiales del SII durante los tests.

## Ambientes del SII

| Canal | Certificación | Producción |
|---|---|---|
| DTE (SOAP + upload) | `maullin.sii.cl` | `palena.sii.cl` |
| Boleta electrónica (REST) | `apicert.sii.cl` (`pangal.sii.cl` sólo para el POST de envío) | `api.sii.cl` (`rahue.sii.cl` sólo para el POST de envío) |

El ambiente se define por empresa (`SII_AMBIENTE` como valor por defecto). Nada de lo implementado ha sido
probado todavía contra el ambiente de certificación real del SII: es el siguiente hito del proyecto.

## Estado y próximos pasos

Hecho: andamiaje, infraestructura, núcleo criptográfico y de XML, clientes del SII, constructores de documentos,
modelo de datos inicial y servicio de folios (ver READMEs de cada carpeta). Pendiente: caso de uso de emisión
(API `/v1/empresas/{rut}/documentos`), colas de envío, representación impresa (PDF con PDF417), entrega digital
de boletas, certificación ante el SII y la integración con SAP Business One (el worker de la fase 1 está en
`apps/sap-b1-worker`; falta probarlo contra un B1 real; el add-on UI API de la fase 2 está en `apps/sap-b1-addon`, también sin probar contra B1). Detalle en la sección 6 del documento de arquitectura.
