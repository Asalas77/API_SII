# 03. Arquitectura

Modelo en niveles C4 (contexto, contenedores, componentes) más vista de despliegue. Convención de los diagramas: **línea continua y borde normal = existe hoy; línea punteada y nodo con la etiqueta "(planificado)" = no existe aún.**

## 1. Contexto (C4 nivel 1)

```mermaid
flowchart TB
  ERP["ERP / POS del cliente<br/>[sistema externo]"]
  SAP["SAP Business One<br/>[sistema externo]"]
  OP["Operador<br/>[persona]"]
  SYS(["API SII<br/>Emite DTE y boletas, gestiona folios y certificados<br/>[este sistema]"])
  SII["SII Chile<br/>Recibe envíos, responde Track ID y estados<br/>[sistema externo]"]
  CF["Consumidor final / receptor<br/>[persona]"]

  ERP -. "REST /v1 (planificado)" .-> SYS
  SAP -. "Service Layer / add-on (planificado)" .-> SYS
  OP -. "backoffice o API de administración (planificado)" .-> SYS
  SYS -- "SOAP + upload (DTE), REST (boletas)<br/>TLS 1.2+" --> SII
  SYS -. "PDF / enlace / correo (planificado)" .-> CF
```

## 2. Contenedores (C4 nivel 2)

```mermaid
flowchart TB
  subgraph Clientes
    ERP["ERP / POS"]
    SAP["SAP Business One<br/>worker Service Layer y add-on (planificado)"]
  end

  subgraph Plataforma["Plataforma API SII"]
    API["API NestJS 12<br/>Node 24, ESM, prefijo /v1<br/>apps/api"]
    PG[("PostgreSQL 16<br/>empresas, certificados, cafs,<br/>documentos, envios, envio_documentos")]
    RD[("Redis 7 + BullMQ<br/>colas de envío (planificado)")]
    OBJ[("Object storage<br/>XML firmado, sobres, PDF (planificado)")]
    KMS["KMS / Vault<br/>cifrado de sobre de PFX (planificado)"]
  end

  subgraph SII["SII Chile"]
    DTE["maullin (certificación) / palena (producción)<br/>SOAP getSeed, getToken, getEstUp, getEstDte<br/>upload /cgi_dte/UPL/DTEUpload"]
    BOL["apicert (certificación) / api (producción)<br/>REST de boleta electrónica<br/>pangal / rahue: sólo POST de envío"]
  end

  ERP -. "REST /v1 (planificado)" .-> API
  SAP -. "REST /v1 (planificado)" .-> API
  API -- "TypeORM / pg" --> PG
  API -. "encolar y consumir (planificado)" .-> RD
  API -. "XML y PDF (planificado)" .-> OBJ
  API -. "clave de datos (planificado)" .-> KMS
  API -- "fetch HTTPS (sii-gateway)" --> DTE
  API -- "fetch HTTPS (sii-gateway)" --> BOL
```

| Contenedor | Tecnología | Estado | Notas |
|---|---|---|---|
| API NestJS | NestJS 12, Express (`@nestjs/platform-express`), TypeScript 6, ESM | Implementado (parcial) | Expone `GET /` y `GET /health`; ningún endpoint de negocio |
| PostgreSQL | 16-alpine en Docker | Implementado | Esquema inicial por migración; XML guardado como `text` en la BD |
| Redis | 7-alpine en `docker-compose.yml` | Planificado | Levantado en compose pero ninguna dependencia lo usa (no hay BullMQ en `package.json`) |
| Object storage | S3 o compatible | Planificado | Hoy `documentos.xml_firmado` y `envios.xml_envio` van en la BD |
| KMS / Vault | n/a | Planificado | Hoy: clave maestra única en `CERTIFICADOS_MASTER_KEY` |
| SII DTE | SOAP + upload | Implementado como cliente | `apps/api/src/sii-gateway/dte/dte-sii.client.ts` |
| SII boletas | REST con OpenAPI 1.0.5 | Implementado como cliente | `apps/api/src/sii-gateway/boleta/boleta-api.client.ts`; spec en `apps/api/resources/sii/openapi/` |
| SAP B1 | Service Layer / UI API | Planificado | Fase 4 |

## 3. Componentes de la API (C4 nivel 3)

### 3.1 Módulos Nest tal como están en `apps/api/src/app.module.ts`

`AppModule` importa `ConfigModule`, `DatabaseModule`, `HealthModule`, `EmpresasModule`, `CertificadosModule`, `FoliosModule`, `DocumentosModule`, `EnviosModule` y `SeguridadModule`; declara `AppController` y `AppService`. **Ningún módulo de negocio importa a otro**: los módulos de persistencia sólo se comunican por las relaciones entre entidades TypeORM. Ni `dte-core` ni `sii-gateway` son módulos Nest todavía.

```mermaid
flowchart LR
  subgraph AppModule["AppModule (apps/api/src/app.module.ts)"]
    direction TB
    AC["AppController / AppService<br/>GET /  (nombre, versión, ambiente)"]
    CFG["ConfigModule (global)<br/>Joi + app, database, sii, seguridad"]
    DB["DatabaseModule<br/>TypeOrmModule.forRootAsync<br/>synchronize=false"]
    HL["HealthModule<br/>GET /health (Terminus, ping BD)"]
    EM["EmpresasModule<br/>entity Empresa"]
    CE["CertificadosModule<br/>entity Certificado"]
    FO["FoliosModule<br/>entity Caf + FoliosService"]
    DO["DocumentosModule<br/>entity Documento"]
    EN["EnviosModule<br/>entities Envio, EnvioDocumento"]
    SE["SeguridadModule<br/>CifradoService (AES-256-GCM)"]
  end

  subgraph Librerias["Librerías puras (sin Nest, aún no cableadas)"]
    CORE["dte-core<br/>CAF, TED, firma, XSD, XML, PFX,<br/>totales, construirDte, sobres"]
    GW["sii-gateway<br/>BoletaApiClient, DteSiiClient,<br/>token, reintentos, errores"]
  end

  PGDB[("PostgreSQL")]
  SIIX["SII"]

  CFG --> DB
  CFG --> SE
  DB --> PGDB
  HL --> DB
  EM --> DB
  CE --> DB
  FO --> DB
  DO --> DB
  EN --> DB
  GW -- "fetch" --> SIIX
  GW -. "FirmadorXml (inyectado)" .-> CORE
  FO -. "usará parsearCaf (planificado)" .-> CORE
```

Lectura del diagrama:

- `ConfigModule` es global (`isGlobal: true`), carga `.env` y `.env.local` y valida con Joi (`apps/api/src/config/env.validation.ts`). `SeguridadModule` importa `ConfigModule.forFeature(seguridadConfig)` y exporta `CifradoService`.
- `DatabaseModule` usa `TypeOrmModule.forRootAsync` con `autoLoadEntities: true`; cada módulo registra sus entidades con `TypeOrmModule.forFeature([...])` y las re-exporta.
- `FoliosModule` es el único con un servicio de negocio (`FoliosService`, que inyecta `DataSource`) y lo exporta junto con `TypeOrmModule`.
- `HealthModule` usa `TerminusModule` y `TypeOrmHealthIndicator` (consulta la conexión del `DatabaseModule`).
- `CifradoService` no es consumido todavía por ningún módulo (se usará al cargar certificados).
- Duplicación detectada: el tipo `AmbienteSii` existe en `apps/api/src/config/sii.config.ts` y en `apps/api/src/sii-gateway/ambientes.ts` con el mismo contenido (ver `15-estado-y-roadmap.md`).

### 3.2 Organización interna de `dte-core`

```mermaid
flowchart TB
  subgraph core["dte-core (dominio puro, sin IO de red)"]
    XML["xml/xml.util<br/>escapar, ISO-8859-1, fechas, RUT"]
    XSD["xsd/xsd<br/>libxml2-wasm, validadores cacheados"]
    CAF["caf/caf<br/>parsearCaf, vigencia, rango"]
    TED["ted/ted<br/>generarTed, verificarTed"]
    FIR["firma/firma<br/>firmarXml, verificarFirmaXml"]
    CER["certificado/certificado<br/>cargarPfx (node-forge)"]
    TOT["documento/totales<br/>calcularTotales"]
    DTE["documento/construir-dte<br/>construirDte"]
    ENV["envio/envio<br/>construirEnvioDte, construirEnvioBoleta"]
    ERRD["documento/errores<br/>ErrorValidacionDte"]
  end

  DTE --> TOT
  DTE --> TED
  DTE --> FIR
  DTE --> XML
  DTE --> CAF
  TED --> CAF
  TED --> XML
  ENV --> FIR
  ENV --> XML
  ENV --> DTE
  DTE --> ERRD
```

Las flechas indican imports reales entre archivos (`construir-dte.ts`, `envio.ts`, `ted.ts`). `certificado/` y `xsd/` son independientes: `firma.ts` obtiene el certificado embebido con `node:crypto` y quien las combina es el llamador. El único acceso a disco es la lectura de los XSD en `xsd/xsd.ts` (carpeta por `SII_XSD_DIR` o búsqueda hacia arriba de `resources/sii/xsd`).

### 3.3 Organización interna de `sii-gateway`

```mermaid
flowchart TB
  subgraph gw["sii-gateway (adaptador de salida)"]
    AMB["ambientes<br/>hosts, rutas, USER_AGENT_SII"]
    HTTP["comun/http<br/>GestorToken, conReintentos, FetchImpl"]
    ERR["comun/errores<br/>SiiError y subtipos"]
    XMLG["comun/xml<br/>armado y lectura de XML/SOAP"]
    FRM["comun/firmador<br/>interfaz FirmadorXml"]
    BOL["boleta/boleta-api.client<br/>BoletaApiClient"]
    DTE["dte/dte-sii.client<br/>DteSiiClient"]
  end

  BOL --> AMB
  BOL --> HTTP
  BOL --> ERR
  BOL --> FRM
  DTE --> AMB
  DTE --> HTTP
  DTE --> ERR
  DTE --> XMLG
  DTE --> FRM
  HTTP --> AMB
  HTTP --> ERR
  HTTP --> XMLG
  XMLG --> ERR
```

El firmador es una **interfaz** (`firmarXml(xml, idReferencia?)`); la dependencia es hacia el contrato, no hacia `dte-core`. `fetchImpl` es inyectable (por defecto `globalThis.fetch`), de modo que las 85 pruebas del gateway (ver `15-estado-y-roadmap.md`) no tocan la red.

## 4. Estilo arquitectónico

Combina **arquitectura hexagonal ligera** con módulos Nest:

| Capa | Piezas | Regla |
|---|---|---|
| **Dominio puro** | `apps/api/src/dte-core` | Sin decoradores de Nest, sin red. Entradas y salidas son tipos TypeScript, strings y `Buffer`. Es el módulo con más pruebas (90 pruebas en `dte-core`) y utilidades de prueba propias (`testing/`, que no se exportan desde `index.ts`) |
| **Adaptador de salida (SII)** | `apps/api/src/sii-gateway` | Clases puras con dependencias inyectables por constructor (`fetchImpl`, `firmador`, caché, `esperar`, `ahora`); el integrador las envuelve en un módulo Nest |
| **Módulos de persistencia** | `empresas`, `certificados`, `folios`, `documentos`, `envios` | Módulos Nest con TypeORM; entidades en `src/<modulo>/entities/*.entity.ts`; terminología SII en español |
| **Transversales** | `config`, `database`, `seguridad`, `health` | Configuración validada, conexión, cifrado y salud |
| **Aplicación (caso de uso)** | `emision`, `envios` (worker) | Planificada: orquestará folios + `dte-core` + persistencia + `sii-gateway` |

Reglas de dependencia pretendidas: `dte-core` no importa nada de Nest ni de `sii-gateway`; `sii-gateway` no importa `dte-core` (usa la interfaz `FirmadorXml`); los módulos de persistencia no contienen lógica de XML; el caso de uso es el único que une las piezas. Hoy esto se cumple por construcción porque ninguna pieza está cableada con otra.

### Flujo objetivo de emisión y envío (planificado)

```mermaid
sequenceDiagram
  autonumber
  participant C as ERP / POS
  participant A as API /v1 (planificado)
  participant F as FoliosService
  participant K as dte-core
  participant P as PostgreSQL
  participant Q as Cola Redis (planificado)
  participant G as sii-gateway
  participant S as SII

  C->>A: POST /v1/empresas/{rut}/documentos (Idempotency-Key)
  A->>P: buscar por clave de idempotencia
  A->>F: asignarSiguienteFolio(empresa, tipo)
  F->>P: SELECT ... FOR UPDATE de CAF candidatos, folio_siguiente + 1
  F-->>A: folio y XML del CAF
  A->>K: construirDte(doc, caf, certificado)
  K-->>A: xmlFirmado, TED, totales
  A->>P: guardar documento (estado emitido)
  A->>Q: encolar envío (estado encolado)
  A-->>C: 201 folio, TED, XML (respuesta síncrona)
  Q->>G: tomar envío
  G->>S: semilla y token (caché), envío
  S-->>G: Track ID
  G->>P: guardar track_id (estado enviado)
  loop polling programado
    G->>S: consultar estado del envío
    S-->>G: REC / EPR / RPR / RCH ...
    G->>P: aceptado, aceptado con reparos o rechazado
  end
```

Este flujo es el de `docs/01-…` sección 3. Hoy sólo existen los participantes `FoliosService`, `dte-core`, `sii-gateway` y `PostgreSQL`; faltan la API, la orquestación y la cola.

## 5. Modelo de datos

Fuente: `apps/api/src/database/migrations/1794643366818-Inicial.ts` y `apps/api/src/database/README.md`.

```mermaid
erDiagram
  empresas ||--o{ certificados : tiene
  empresas ||--o{ cafs : tiene
  empresas ||--o{ documentos : emite
  empresas ||--o{ envios : realiza
  cafs ||--o{ documentos : "folio de"
  envios ||--o{ envio_documentos : contiene
  documentos ||--o{ envio_documentos : "viaja en"

  empresas {
    uuid id PK
    int rut UK
    char dv
    text actecos "int[]"
    enum ambiente_sii "certificacion|produccion"
    bool activa
  }
  certificados {
    uuid id PK
    uuid empresa_id FK
    bytea pfx_cifrado
    bytea password_cifrada
    timestamptz valido_hasta
    bool activo
  }
  cafs {
    uuid id PK
    uuid empresa_id FK
    smallint tipo_dte
    int folio_desde
    int folio_hasta
    int folio_siguiente
    date fecha_vencimiento
    text xml
    bool agotado
    bool anulado
  }
  documentos {
    uuid id PK
    uuid empresa_id FK
    uuid caf_id FK
    smallint tipo_dte
    int folio
    bigint monto_total
    enum estado
    varchar track_id
    text xml_firmado
    text ted
    jsonb reparos
    varchar clave_idempotencia
  }
  envios {
    uuid id PK
    uuid empresa_id FK
    enum canal "dte|boleta"
    enum ambiente_sii
    varchar track_id
    varchar estado
    text xml_envio
    jsonb respuesta
    int intentos
  }
  envio_documentos {
    uuid envio_id PK
    uuid documento_id PK
    varchar estado
    varchar glosa
  }
```

Restricciones relevantes: único `(empresa_id, tipo_dte, folio_desde)` en `cafs`; único `(empresa_id, tipo_dte, folio)` en `documentos`; índice único parcial `(empresa_id, clave_idempotencia)` cuando no es nulo; todas las FK `ON DELETE RESTRICT`. Estados de `documentos`: `emitido`, `encolado`, `enviado`, `aceptado`, `aceptado_con_reparos`, `rechazado`, `anulado`.

## 6. Vista de despliegue

### 6.1 Actual (desarrollo local)

Definido en `docker-compose.yml`:

```mermaid
flowchart LR
  subgraph Host["Máquina del desarrollador"]
    NODE["Node 24<br/>npm run start:dev<br/>puerto 3000"]
    subgraph DC["docker compose"]
      PGC["postgres:16-alpine<br/>puerto host 5432 (o POSTGRES_HOST_PORT)<br/>volumen postgres_data<br/>healthcheck pg_isready"]
      RDC["redis:7-alpine<br/>puerto host 6379<br/>volumen redis_data<br/>sin uso todavía"]
    end
  end
  NODE -- "DATABASE_HOST/PORT" --> PGC
  NODE -- "HTTPS (sólo pruebas manuales)" --> SIIC["SII certificación"]
```

- La API corre fuera de Docker (no hay `Dockerfile` ni servicio `api` en el compose).
- Las credenciales por defecto (`api_sii/api_sii`) y la clave maestra de `apps/api/.env.example` son **sólo de desarrollo**.
- Las migraciones se ejecutan a mano (`npm run migration:run`); `migrationsRun` está en `false`.

### 6.2 Objetivo (planificado)

```mermaid
flowchart TB
  subgraph Internet
    CLI["ERP / POS / SAP B1"]
  end
  subgraph Prod["Entorno productivo"]
    LB["Balanceador / API gateway<br/>TLS"]
    subgraph Apps["Contenedores sin estado"]
      API1["API NestJS (N réplicas)"]
      WRK["Worker de envíos<br/>BullMQ, polling de estados"]
    end
    PGM[("PostgreSQL gestionado<br/>TLS, RLS, rol sin BYPASSRLS")]
    REDIS[("Redis<br/>colas, caché de token compartida")]
    S3[("Object storage<br/>XML y PDF con retención")]
    VAULT["KMS / Vault"]
    OBS["Observabilidad<br/>trazas, métricas, alarmas"]
  end
  SIIP["SII palena / api"]
  SIIC2["SII maullin / apicert"]

  CLI --> LB --> API1
  API1 --> PGM
  API1 --> REDIS
  WRK --> REDIS
  WRK --> PGM
  API1 --> S3
  WRK --> S3
  API1 --> VAULT
  WRK --> SIIP
  WRK --> SIIC2
  API1 -.-> OBS
  WRK -.-> OBS
```

Consecuencias de pasar a varias réplicas: la caché de token en memoria (`GestorToken`) deja de ser compartida y habrá que usar el parámetro `almacen` (Redis) para no pedir tokens de más; la asignación de folios ya es correcta entre réplicas porque usa bloqueos de base de datos.

## 7. Decisiones transversales

| Tema | Decisión | Dónde |
|---|---|---|
| **ESM** | `"type": "module"`, `module: nodenext`; los imports relativos terminan en `.js`; no existe `__dirname` (se usa `import.meta.dirname`) | `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/AGENTS.md` |
| **TypeScript estricto** | `strict: true`; `strictPropertyInitialization: false` por las entidades TypeORM; `emitDecoratorMetadata` y `experimentalDecorators` por Nest | `apps/api/tsconfig.json` |
| **Prefijo `/v1`** | `app.setGlobalPrefix('v1', { exclude: ['health', '/'] })`: los recursos de negocio vivirán bajo `/v1`; `/` y `/health` quedan sin prefijo | `apps/api/src/main.ts` |
| **Configuración** | Variables de entorno validadas con Joi al arrancar; `registerAs` por área (`app`, `database`, `sii`, `seguridad`) | `apps/api/src/config/` |
| **Esquema de BD** | Sólo migraciones (`synchronize: false`, `migrationsRun: false`), `gen_random_uuid()`, enums con nombre explícito | `apps/api/src/database/` |
| **Pruebas** | Vitest con `globals: true`; pruebas unitarias `*.spec.ts` junto al código y e2e en `apps/api/test/` con configuración aparte | `apps/api/vitest.config.ts`, `apps/api/vitest.config.e2e.ts` |
| **Calidad** | oxlint con `--type-aware` (regla `no-floating-promises` en error), prettier | `apps/api/.oxlintrc.json` |
| **Nomenclatura** | Tablas, columnas, entidades y servicios en español (términos del SII) | `apps/api/src/database/README.md` |
| **Montos y fechas** | Montos `bigint` en BD y enteros en CLP en el dominio; fechas de calendario como `date`/string `YYYY-MM-DD`, instantes `timestamptz`; zona `America/Santiago` para fechas SII | `apps/api/src/database/README.md`, `apps/api/src/dte-core/xml/xml.util.ts` |
| **Errores tipados** | `ErrorValidacionDte`, `SiiError` y subtipos, `SinFoliosDisponiblesError`, `CafInvalidoError`; aún sin filtro HTTP que los traduzca | `dte-core`, `sii-gateway`, `apps/api/src/folios/folios.errors.ts` |

Las razones de cada decisión están en `12-decisiones-adr.md`.
