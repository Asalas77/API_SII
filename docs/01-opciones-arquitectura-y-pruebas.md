# API REST de facturación y boletas electrónicas (SII Chile) + add-on SAP Business One

**Opciones de arquitectura, estrategia de pruebas y recomendación**
Fecha de la investigación: 2026-11-13. Basado en documentos oficiales del SII y de SAP (ver sección 8 y la carpeta
`docs/referencias-sii/`). Los puntos tomados de fuentes secundarias están marcados como *(verificar)*.

---

## 0. Resumen ejecutivo

Hay que construir tres piezas, y conviene tratarlas como tres productos distintos:

| Pieza | Qué hace | Dificultad principal |
|---|---|---|
| **Motor DTE** | Arma el XML, asigna folio desde el CAF, calcula el timbre (TED), firma, genera PDF con PDF417, habla con el SII | Criptografía XML (RSA-SHA1, C14N), formato ISO-8859-1, reglas de negocio del SII, certificación |
| **API REST multiempresa** | Expone el motor a cualquier ERP/POS: emitir, consultar estado, descargar XML/PDF, administrar CAF y certificados, webhooks | Multiempresa (un certificado y CAF por RUT), colas y reintentos, seguridad de certificados |
| **Add-on / integración SAP B1** | Toma facturas, notas, guías y boletas desde B1, llama a la API y devuelve folio, estado y PDF a B1 | SDK COM (UI/DI API) vs Service Layer, versiones de B1, localización Chile |

El SII tiene **dos canales técnicos distintos** que la arquitectura debe soportar:

- **DTE** (facturas 33/34, guías 52, notas 56/61, liquidaciones, exportación): web services **SOAP** de autenticación y consulta, más un **upload HTTP** del `EnvioDTE`. Certificación en `maullin.sii.cl`, producción en `palena.sii.cl`.
- **Boleta electrónica** (39/41): **API REST** propia con OpenAPI publicado. Certificación en `apicert.sii.cl` (y `pangal.sii.cl` sólo para el POST de envío), producción en `api.sii.cl` (y `rahue.sii.cl` sólo para el POST de envío).

**Recomendación en una frase:** API en **NestJS + PostgreSQL** con un **motor DTE propio** (usando LibreDTE sólo como implementación de referencia), envío al SII **asíncrono por colas**, y para SAP B1 un **worker sobre Service Layer** en la fase 1 seguido de un **add-on UI API en C# delgado** en la fase 2. Si el equipo es .NET, la opción B (.NET 8/9) es equivalente y no cambia la arquitectura. Detalle y alternativas en la sección 2.

**Alerta normativa:** 2026 trae cambios activos (Res. Ex. 121/2026 con tres estados de recepción y validaciones por fases, XSD oficial actualizado en febrero 2026, nuevos campos de impuestos específicos, Res. Ex. 144/2026 sobre guías y traslado). El motor debe construir el XML a partir de una definición versionada de formato, no "a mano".

---

## 1. Lo que exige el SII (verificado en fuentes oficiales)

### 1.1 Prerrequisitos por empresa emisora

1. **Enrolamiento y certificación** ante el SII como emisor de DTE (proceso por RUT, sección 4.3). La boleta electrónica tiene **su propio proceso de certificación**, adicional al de DTE.
2. **Certificado digital** de firma electrónica de una persona natural autorizada como firmante por el representante legal, emitido por una entidad acreditada por el SII (formato PFX/P12). Firma el DTE completo, el `EnvioDTE` y la semilla de autenticación.
3. **CAF (Código de Autorización de Folios)** por tipo de documento: XML con el rango de folios, la clave privada RSA del CAF y la firma del SII. Los CAF de documentos con derecho a crédito fiscal (factura afecta, etc.) **vencen a los 6 meses** (Res. Ex. 58/2017, vigente desde 2018); los folios vencidos sin usar deben anularse en el SII *(detalle de alcance: verificar)*.
4. **Correo de intercambio** registrado en el SII, para recibir DTE de proveedores y acuses de recibo.
5. Para boletas: representación impresa o digital con la leyenda **"verifique en www.sii.cl"**, y los campos del **proveedor de software** (`RutProvSW`, `RznSocProvSW`) en el XML (formato v4.2).

### 1.2 Flujo técnico de un DTE (33, 34, 52, 56, 61, …)

1. Construir el XML (**ISO-8859-1**) conforme a `DTE_v10.xsd`. El paquete oficial `schema_dte.zip` tiene archivos fechados **2026-02-19** (fuentes de terceros lo llaman "Formato DTE v2.5"); el PDF "formato_dte.pdf" publicado sigue siendo la versión 2014, por lo que **el XSD es la fuente de verdad**.
2. Asignar un **folio** del CAF del tipo de documento (único, nunca reutilizado).
3. Calcular el **TED** (timbre electrónico): el bloque `<DD>` (RUT emisor, tipo, folio, fecha, receptor, monto, primer ítem, CAF, timestamp) se firma con **SHA1withRSA usando la clave privada del CAF** y se guarda en `<FRMT>`.
4. **Firmar el DTE completo** con XMLDSig *enveloped* (`rsa-sha1`, digest `sha1`, canonicalización C14N 2001) con el certificado del firmante.
5. Agrupar uno o más DTE en un **`EnvioDTE`** (`Carátula` + `SetDTE`) y firmar el envío.
6. **Autenticar**: `CrSeed.jws` entrega una semilla, se firma el XML `getToken` y `GetTokenFromSeed.jws` devuelve el `TOKEN`.
7. **Enviar**: `POST /cgi_dte/UPL/DTEUpload` (multipart) con `Cookie: TOKEN=…` y el `User-Agent` fijo que exige el SII (`Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.0; YComp 5.0.2.4)`). El SII responde un **Track ID de 10 dígitos**.
8. **Resultado**: correo al contacto registrado y consulta por `QueryEstUp.jws` (estado del envío) y `QueryEstDte.jws` (estado de un documento). El instructivo exige no enviar el XML como una sola línea sin saltos.

| Servicio DTE | Certificación | Producción |
|---|---|---|
| Semilla / token (SOAP) | `https://maullin.sii.cl/DTEWS/CrSeed.jws`, `GetTokenFromSeed.jws` | `https://palena.sii.cl/DTEWS/…` |
| Upload de `EnvioDTE` | `https://maullin.sii.cl/cgi_dte/UPL/DTEUpload` | `https://palena.sii.cl/cgi_dte/UPL/DTEUpload` |
| Estado envío / documento (SOAP) | `https://maullin.sii.cl/DTEWS/QueryEstUp.jws`, `QueryEstDte.jws` | `https://palena.sii.cl/DTEWS/…` |
| Registro aceptación / reclamo (SOAP) | `ws2.sii.cl` (REGISTRORECLAMODTE) | `ws1.sii.cl` (REGISTRORECLAMODTE) |

### 1.3 Flujo técnico de una boleta electrónica (39, 41)

Misma base criptográfica (CAF, TED, firma), pero XML conforme a **`EnvioBOLETA_v11.xsd`** (2024-12-05) y formato **v4.2 (2025-09-08)**, que agregó `MedioPago`, `CorreoRecep`, `TelefonoRecep`, los datos del proveedor de software y una zona opcional de georreferenciación. El envío va por la **API REST** oficial (OpenAPI "API SII - V1" 1.0.5, guardado en `docs/referencias-sii/openapi/`):

| Paso | Endpoint | Notas |
|---|---|---|
| Semilla | `GET /recursos/v1/boleta.electronica.semilla` | Vale **2 minutos** |
| Token | `POST /recursos/v1/boleta.electronica.token` | Cuerpo: XML `<getToken><item><Semilla>…</Semilla></item></getToken>` firmado (2 líneas exactas). Token válido **1 hora**, se renueva con cada uso. Se envía como `Cookie: TOKEN=…` |
| Envío | `POST /recursos/v1/boleta.electronica.envio` | multipart: `rutSender`, `dvSender`, `rutCompany`, `dvCompany`, `archivo`. Header `User-Agent` **obligatorio**. Máximo **500 boletas por envío**, el SII recomienda **50** para volumen. Respuesta JSON con `trackid` (**15 dígitos**), `estado: REC` |
| Estado del envío | `GET /recursos/v1/boleta.electronica.envio/{rut}-{dv}-{trackid}` | Estados: `REC, EPR, CRT, FOK, PRD, RCH, RCO, VOF, RFR, RPR (aceptado con reparos), RPT, RSC, SOK, RCT` + detalle de reparos/rechazos por documento |
| Estado de una boleta | `GET /recursos/v1/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado?rut_receptor&dv_receptor&monto&fechaEmision` | Códigos: `DOK, DNK, FAU, FNA, FAN, EMP, TMD, TMC, MMD, MMC, AND, ANC` |
| Catálogos | `GET /recursos/v1/globales/boleta.electronica.{tipo,estado,envio.estado,nivel,seccion}` | Tablas de códigos |

| Host boletas | Uso |
|---|---|
| `https://apicert.sii.cl/recursos/v1` | Certificación (todos los recursos) |
| `https://pangal.sii.cl/recursos/v1` | Certificación, **temporal, sólo** `POST /boleta.electronica.envio` |
| `https://api.sii.cl/recursos/v1` | Producción |
| `https://rahue.sii.cl/recursos/v1` | Producción, **temporal, sólo** `POST /boleta.electronica.envio` |

Otras reglas del canal boleta: **TLS 1.2 o superior** obligatorio; `HTTP 405` significa **límite excedido** (hay que implementar backoff); el token de boletas es distinto del de DTE. El **Resumen de Ventas Diarias (RVD, ex RCOF)** dejó de ser obligatorio el 1 de agosto de 2022 (Res. Ex. 53/2022) *(fuente secundaria, verificar)*: hoy el Registro de Ventas se alimenta de las boletas recibidas.

### 1.4 Intercambio con receptores y registro de aceptación o reclamo

- El emisor envía el `EnvioDTE` al correo de intercambio del receptor; el receptor responde con `RecepcionDTE` (acuse de recepción del envío), `EnvioRecibos` (recibo de mercaderías o servicios, Ley 19.983) y `ResultadoDTE` (aceptación o rechazo comercial). Schemas: `schema_ic.zip` y `schema19983.zip`.
- En el SII, el receptor registra aceptación o reclamo con el web service **REGISTRORECLAMODTE** (`ingresarAceptacionReclamoDoc`; acciones `ACD, RCD, ERM, RFP, RFT`) dentro de **8 días** desde la recepción; sin reclamo se presume recibido.
- Para una API de **emisión** esto es alcance de fase posterior (sección 6), salvo que los clientes también quieran gestionar compras.

### 1.5 Representación impresa o digital y entrega al cliente

- PDF con el TED en **PDF417** según el Manual de Muestras Impresas; las muestras se revisan en la certificación.
- Boletas: desde la Res. Ex. **53/2025** el comercio debe entregar representación **impresa o virtual** de la boleta o del comprobante de pago; quienes no imprimen deben entregarla por canal digital (correo, SMS, mensajería, QR) desde el **1 de marzo de 2026** *(fecha de fuente secundaria, verificar en el texto de la resolución)*. La API debería ofrecer entrega digital (enlace/QR, correo) además del PDF.

### 1.6 Cambios normativos 2024–2026 que condicionan el diseño

| Norma | Efecto en el sistema |
|---|---|
| **Res. Ex. 121/2026** (04-09-2026; vigente desde su publicación en extracto, 22-09-2026 según prensa) | Tres estados de recepción: **Aceptado**, **Aceptado con reparos**, **Rechazado**. Nuevas validaciones técnicas y de negocio se activarán **por fases** según cronología que el SII publicará (a octubre de 2026 aún sin fechas). El modelo de estados de la API debe contemplar los reparos y permitir corregirlos en documentos posteriores |
| **Instructivo sobre validaciones de DTE (junio 2026)** | Primera etapa: nuevos campos para impuesto específico a combustibles (IEC) e ILA/IABA: `<TIEBase>`, `<TIEVariable>` dentro de `<ImptoReten>` en encabezado; `<TpoImpD>`, `<TasaImpD>`, `<IEBase>`, `<IEVariable>` en detalle, con validaciones de consistencia detalle/encabezado. Aún no aparecen en el XSD de 2026-02-19: el builder de XML debe poder incorporarlos sin reescribirse |
| **XSD `schema_dte.zip` 2026-02-19** | Validar siempre contra el paquete vigente; fijar la versión del paquete en el repositorio y tener un proceso para actualizarla |
| **Res. Ex. 144/2026** (23-10-2026, deroga la 154/2025) | Facturas y guías de despacho que amparan traslado deben indicar tipo de traslado, origen/destino, transportista y descripción de bienes. Afecta el mapeo de entregas (ODLN) desde SAP B1 |
| **Res. Ex. 36/2024** | Descripciones claras y explícitas en `NmbItem`; el SII valida calidad del texto |
| **Res. Ex. 53/2025** | Entrega impresa o digital de la boleta |
| **Res. Ex. 58/2017** | Vigencia de 6 meses de los CAF con crédito fiscal |

---

## 2. Opciones de stack para la API

| Opción | Stack | Motor DTE | Ventajas | Desventajas |
|---|---|---|---|---|
| **A** | **NestJS (TypeScript) + PostgreSQL** | Propio: `xml-crypto` (RSA-SHA1, C14N), `node:crypto` (TED), `libxmljs2` (XSD), `bwip-js` (PDF417), `pdfmake`/Puppeteer (PDF), SOAP con `soap` o `fetch` crudo | Un solo lenguaje con el backoffice web; ecosistema maduro para multiempresa (RLS, BullMQ, auditoría); contenedores Linux o Windows | No hay librería DTE madura en TS (`dty-fy` 1.0.x es reciente, con licencia no estándar): el motor se escribe desde cero (varias semanas más iteraciones en certificación) |
| **B** | **.NET 8/9 (ASP.NET Core)** | Propio: `System.Security.Cryptography.Xml` (SignedXml soporta rsa-sha1), `XmlReader` con XSD, `ZXing.Net`, `QuestPDF` | Criptografía XML y SOAP de primera clase; **mismo lenguaje que el add-on de SAP B1**; natural en clientes Windows/MSSQL | Igualmente motor propio. `SimpleSDK` (NuGet) **no sirve como motor**: es un cliente del servicio pago SimpleAPI, sin licencia declarada |
| **C** | **PHP 8.5 + LibreDTE lib-core** | Existente y mantenido (último commit 2026-11-13; trae XSD, WSDL, TED, firma, boletas REST, plantillas PDF, intercambio) | Tiempo mínimo hasta certificación; probado en producción por años | Licencia **AGPL-3.0 sin opción comercial**: al ofrecer el servicio por red hay que publicar el código del servicio; exige PHP ≥ 8.5 y equipo PHP |
| **D** | **Híbrido: A o B + LibreDTE como microservicio interno** | LibreDTE encapsulado en un contenedor "motor DTE" sin modificar (o con cambios publicados) | Arranque rápido; la AGPL queda acotada al contenedor; permite reemplazarlo por motor propio después | Dos stacks que operar; requiere revisión legal del límite de la AGPL |
| **E** | **Proveedor externo (PAC / API SaaS)**: LibreDTE SaaS, SimpleAPI, Facturacion.cl, Febos, Edicom, otros | Del proveedor | Salida al mercado más rápida; el proveedor absorbe cambios normativos | Costo por documento, dependencia, menor diferenciación; la certificación sigue siendo por RUT emisor aunque el proveedor la gestione |

**Recomendación: opción A** (NestJS + PostgreSQL) con motor propio, por tres razones: (1) el motor DTE es el activo del producto y conviene controlarlo; (2) TypeScript cubre API, backoffice y futuros portales de consulta de boletas; (3) el add-on de B1 es una pieza delgada en C# que no justifica mover toda la API a .NET. Usar **LibreDTE como implementación de referencia** (leer su código para resolver detalles de TED, C14N, codificación y mensajes del SII; no copiar código por la AGPL) y entrar al **ambiente de certificación desde la primera semana**. Si el equipo es .NET, tomar la **opción B** con los mismos módulos. Si la prioridad es facturar en menos de dos meses, arrancar con **D o E** y migrar el motor después.

---

## 3. Arquitectura propuesta (independiente del lenguaje)

```
 ERP / POS / SAP B1 add-on / Web                SII
        │  REST + webhooks                       ▲
        ▼                                        │ SOAP + upload (DTE)  /  REST (boleta)
 ┌──────────────────────────────┐        ┌───────┴────────┐
 │ API Gateway (/v1)            │        │ sii-gateway    │  token cache, reintentos,
 │ auth por empresa, idempotencia│        │ (SOAP + REST)  │  backoff 405, hosts por ambiente
 └──────────┬───────────────────┘        └───────▲────────┘
            ▼                                     │
 ┌──────────────────────────────┐        ┌───────┴────────┐
 │ dte-core (dominio puro)      │        │ envios (worker) │ cola, batch de boletas (≤50),
 │ builder XML · totales ·      │──────▶ │ outbox, polling │ estados, reparos
 │ TED · firma · XSD · PDF417   │        └────────────────┘
 └──────────┬───────────────────┘
            ▼
 PostgreSQL (multiempresa, RLS) · Redis/BullMQ · Object storage (XML firmado, PDF) · Vault/KMS (PFX)
```

**Módulos**

- `empresas`: datos del emisor (RUT, razón social, giros, actividad económica, dirección, resolución SII, ambiente certificación/producción), contactos, correo de intercambio.
- `certificados`: PFX cifrado con cifrado de sobre (KMS/Vault), vigencia, RUT del firmante, rotación. Nunca en texto plano ni en logs.
- `folios`: CAF por tipo de documento (XML, rango, fecha de autorización, vencimiento), asignación **transaccional** (`SELECT … FOR UPDATE` o secuencia por CAF), alertas por umbral y por vencimiento, anulación de folios no usados.
- `dte-core`: dominio puro sin IO: builder de XML desde una definición versionada de formato, cálculo de totales e impuestos (IVA 19 %, exentos, adicionales ILA/IEC con los nuevos campos), TED, firma XMLDSig, validación XSD, PDF417, plantillas PDF/HTML, parsers de respuestas del SII. Es el módulo con más pruebas unitarias.
- `sii-gateway`: clientes SOAP (DTE) y REST (boletas), cache de token por empresa y ambiente (DTE y boleta por separado), reintentos con backoff, circuit breaker, configuración de hosts por ambiente, registro de cada llamada.
- `envios`: emisión **sincrónica** (folio + XML + firma + PDF en menos de un segundo para que el POS imprima) y envío al SII **asíncrono** (outbox + cola): agrupar boletas (hasta 50), enviar, guardar Track ID, consultar estado con polling programado. Prioridad alta para guías y facturas que amparan traslado (deben estar recibidas por el SII antes del traslado, Res. Ex. 99/2019).
- `documentos`: XML firmado y PDF en object storage con retención legal (6 años *(verificar)*), descarga por API, enlace público de verificación/QR para boletas.
- `intercambio` (fase posterior): buzón IMAP del correo de intercambio, recepción de DTE de proveedores, generación de `RecepcionDTE`/`EnvioRecibos`/`ResultadoDTE`, registro de aceptación o reclamo.
- `webhooks` y `notificaciones`: avisar al ERP cuando cambia el estado; entrega digital de boletas al consumidor.
- `auditoría` y observabilidad: quién emitió qué, trazas por Track ID, métricas de rechazos y reparos.

**Modelo de estados de un documento**: `borrador → emitido (folio+firma) → encolado → enviado (trackid) → aceptado | aceptado con reparos | rechazado`, con el detalle de reparos por documento y la referencia al documento correctivo (nota de crédito/débito) cuando aplique.

**API (bosquejo)**

| Método y ruta | Uso |
|---|---|
| `POST /v1/empresas/{rut}/documentos` | Crear y emitir (tipo 33/34/39/41/52/56/61…), header `Idempotency-Key` |
| `GET /v1/documentos/{id}` · `/xml` · `/pdf` | Estado, XML firmado, PDF |
| `POST /v1/documentos/{id}/reenviar` | Reintentar envío al SII |
| `GET /v1/envios/{trackid}` | Estado de un envío y sus documentos |
| `POST /v1/empresas/{rut}/caf` · `GET /v1/empresas/{rut}/folios` | Cargar CAF, ver disponibilidad y vencimientos |
| `POST /v1/empresas/{rut}/certificado` | Cargar PFX (cifrado al recibirlo) |
| `POST /v1/webhooks` | Suscripción a cambios de estado |

Cada empresa define su **ambiente** (certificación o producción): el mismo código apunta a `maullin`/`apicert` o a `palena`/`api`, lo que da a los clientes de la API un sandbox real.

---

## 4. Estrategia de pruebas

| Nivel | Qué se prueba | Cómo |
|---|---|---|
| 1. Unitarias de `dte-core` | Totales y redondeos (los decimales generan reparos), codificación ISO-8859-1, TED (verificar `FRMT` con la clave pública del CAF), firma XMLDSig (verificar con el certificado), referencias, impuestos adicionales | *Golden files* de XML esperado por tipo de documento; certificados y CAF de prueba autogenerados para los tests |
| 2. Validación XSD en CI | Cada XML generado contra `DTE_v10.xsd` (2026-02-19) y `EnvioBOLETA_v11.xsd` | `libxmljs2` / `xmllint`; falla el build si no valida |
| 3. Contratos con un **mock del SII** | Flujo semilla → token → envío → estado sin tocar al SII | Levantar el OpenAPI oficial con Prism: `npx @stoplight/prism-cli mock docs/referencias-sii/openapi/sii_boleta_electronica_openapi_v1.0.5.json`; stubs SOAP (WireMock) para `CrSeed`, `GetTokenFromSeed`, `QueryEstUp` con respuestas reales anonimizadas |
| 4. Integración en **ambiente de certificación** | Envíos reales a `maullin` (DTE) y `apicert`/`pangal` (boletas), consulta de estados, lectura de reparos | Requiere empresa postulante en certificación, certificado digital real de un firmante y folios de certificación. Automatizar un *smoke test* diario; el SII elimina del ambiente a quien no registra actividad en 6 meses |
| 5. **Certificación formal** por RUT (ver 4.3) | Set de pruebas, simulación, intercambio, muestras impresas, declaración | Es la prueba de aceptación del producto; planificarla desde el inicio |
| 6. Carga y resiliencia | Límites del SII: 500 boletas/envío, recomendado 50; `405` límite excedido; token 1 h; caídas del SII | Pruebas de cola y backoff contra el mock; chaos testing del `sii-gateway` |
| 7. E2E con SAP B1 | Mapeo B1 → DTE, escritura de UDFs y adjuntos | Base de demostración localizada Chile (SAP publicó demos localizadas para 10.0 FP 2011), Service Layer de pruebas, copia de la company del cliente |

### 4.3 Checklist de certificación ante el SII

**DTE (facturas y otros)**, en `https://maullin.sii.cl/cvc/dte/certificacion_dte.html` tras postular:

1. **Set de pruebas**: el SII asigna casos; cada DTE lleva en la primera referencia el texto `SET` y el número de caso, folios de certificación, glosas exactas (con acentos), orden de líneas y tasa de IVA vigente. Los envíos deben quedar sin rechazos ni reparos.
2. **Simulación**: un envío con volumen representativo de la operación real.
3. **Intercambio de información**: envío y recepción de documentos y respuestas con otros contribuyentes.
4. **Muestras impresas**: PDF de todos los documentos del set y uno por tipo de la simulación.
5. **Declaración de cumplimiento de requisitos** → el SII registra a la empresa como emisor electrónico.

**Boleta electrónica**, proceso separado en `https://www4.sii.cl/certBolElectDteInternet/`:

1. El representante legal **solicita el set de pruebas** (revisión de 10 a 15 días hábiles).
2. Envíos de prueba por la API REST de certificación (`apicert`/`pangal`) con los casos del set.
3. Muestras de representación impresa o digital y sitio de consulta disponible.
4. **Declaración de cumplimiento**; la autorización rige desde el primer día del mes en curso.

---

## 5. Add-on e integración con SAP Business One

### 5.1 Lo que ofrece el SDK de B1 (verificado)

| Mecanismo | Qué es | Cuándo usarlo aquí |
|---|---|---|
| **UI API + DI API** (`SAPbouiCOM`, `SAPbobsCOM`, COM) | Add-on clásico en C#/.NET Framework que corre **dentro del cliente B1** (x64 en 10.0): eventos de formularios, botones, pestañas, UDFs | Experiencia integrada: validar antes de "Agregar", botón Emitir/Reenviar/Ver PDF, estado visible en la factura |
| **Service Layer** (REST/OData, HANA y **MSSQL** desde 10.0 PL01; OData v4 preferido, v3 en desuso desde FP 2108; consultas SQL desde FP 2011) | Acceso a objetos de negocio por HTTP con sesión | Integración **sin instalar nada en los clientes**: leer documentos nuevos, escribir UDFs y adjuntos. Funciona con Web Client y cloud |
| **B1if (Integration Framework)** | Flujos low-code disparados por eventos de B1 (B1i Event Sender) | Alternativa si el partner ya opera B1if; curva de aprendizaje y depuración difíciles |
| **Extensiones del Web Client** (UI API framework desde **FP 2405**, plugin de VS Code + Web Client Inspector, paquete `.mtar`) | Vistas y botones en el Web Client | Complemento cuando los usuarios trabajen en Web Client |
| **Empaquetado** | `.ard` con el Add-On Registration Data Generator (`SDK\Tools\AddOnRegDataGen`), paquete de extensión para el Extension Manager (lightweight deployment); la versión del generador debe coincidir con la del cliente | Distribución e instalación del add-on clásico |

### 5.2 Localización Chile en B1

SAP documenta para Chile: campos de **folio** (prefijo y número, asistente *Folio Number Assignment*), **RUT** (opción de más de 13 caracteres), retenciones múltiples (FP 2208) y soporte del Web Client. El marco genérico de **documentos electrónicos** (formatos EFM `.spp`, *Electronic Document Monitor*, *Generic eDoc Protocol* con B1i Event Sender o XML Connector, *Electronic Document Service*) está documentado para otras localizaciones (India, Argentina). **No encontré documentación oficial de SAP que entregue formatos DTE chilenos nativos ni conectividad con el SII para Business One**; en el mercado chileno la emisión en B1 se resuelve con add-ons de partners. Antes de diseñar, confirmar con el partner qué incluye el paquete de localización instalado en cada cliente.

### 5.3 Diseño recomendado

- **Fase 1 – worker sobre Service Layer** (puede vivir en la misma API NestJS o como servicio separado): detecta documentos nuevos (`OINV`, `ORIN`, `ODLN`) marcados para emisión, arma el payload, llama a la API y escribe el resultado en UDFs (`U_SII_TipoDTE`, `U_SII_Folio`, `U_SII_TrackId`, `U_SII_Estado`, `U_SII_Glosa`, `U_SII_XmlUrl`, `U_SII_PdfUrl`) y adjunta el PDF (`Attachments2`). Sin instalación en los puestos de trabajo; sirve para cliente Windows, Web Client y cloud.
- **Fase 2 – add-on UI API en C# delgado**: validaciones previas al "Agregar" (RUT y giro del receptor, dirección, tipo de documento SII elegido en un UDF, campos de traslado en entregas), botones Emitir / Reenviar / Ver PDF / Consultar estado y estado visible en el formulario. Toda la lógica tributaria queda en la API; el add-on sólo orquesta y muestra.
- La **API es la autoridad de folios**: el folio del CAF se escribe en los campos de folio de la localización o en UDF, nunca se numera dos veces.

**Mapeo inicial B1 → SII**

| Documento B1 | DTE | Observaciones |
|---|---|---|
| Factura de deudores (`OINV`) a empresa | 33 afecta / 34 exenta | Impuestos por código de impuesto B1 → `TasaIVA`, exentos, `ImptoReten` |
| Factura de deudores a consumidor final o venta POS | 39 boleta / 41 boleta exenta | `MedioPago`, `CorreoRecep`/`TelefonoRecep` para entrega digital; proveedor de software en el XML |
| Nota de crédito de deudores (`ORIN`) | 61 | Referencia obligatoria al documento original (`TpoDocRef`, `FolioRef`, `CodRef` 1/2/3) |
| Nota de débito | 56 | Según cómo la modele la localización o la empresa |
| Entrega (`ODLN`) | 52 guía de despacho | Nuevos datos de traslado (Res. Ex. 144/2026); enviar al SII antes del traslado |
| Factura de proveedores (`OPCH`) | Recepción de DTE de compras | Fase posterior: intercambio y aceptación/reclamo |

**Pruebas del add-on**: base demo localizada Chile, instancia de Service Layer de pruebas, copia de la company del cliente, matriz de versiones (10.0 FP, MSSQL y HANA), depuración adjuntando Visual Studio al proceso del cliente B1.

---

## 6. Roadmap sugerido

| Fase | Entregable | Duración estimada |
|---|---|---|
| 0 | Decisiones: stack (A o B), alcance de documentos, multiempresa, hosting, quién gestiona la certificación | 1 semana |
| 1 | `dte-core` + `sii-gateway` funcionando en certificación: factura 33, nota 61 y boleta 39 con TED, firma, envío y estados | 4–6 semanas |
| 2 | API pública (OpenAPI), PDF/PDF417, entrega digital, webhooks, backoffice mínimo de CAF y certificados | 3–4 semanas (en paralelo con la 1) |
| 3 | Certificación SII de la primera empresa (DTE y boleta en paralelo) | 4–8 semanas, dependiente del SII |
| 4 | Integración SAP B1: worker Service Layer → add-on UI API | 3–5 semanas |
| 5 | Guías con trazabilidad, exportación, intercambio y recepción de compras, aceptación/reclamo | según demanda |

---

## 7. Riesgos y decisiones abiertas

1. **Normativa en movimiento**: fases de la Res. 121/2026 sin fechas, nuevos campos de impuestos, XSD actualizado en 2026. Mitigación: builder dirigido por definición versionada, suscripción a novedades del SII, pruebas automáticas contra el XSD vigente.
2. **Licencia de LibreDTE (AGPL-3.0)** si se elige C o D: revisar con asesoría legal.
3. **Custodia de certificados digitales** de personas naturales: cifrado, acceso mínimo, renovación anual.
4. **Folios**: unicidad bajo concurrencia, vencimiento a 6 meses, anulación de no usados.
5. **Certificación por RUT**: cada cliente debe certificarse (o declarar cumplimiento) con tu software; definir quién acompaña el proceso.
6. **SAP B1**: diversidad de versiones (FP), bases (MSSQL/HANA) y paquetes de localización; validar con el partner antes de comprometer alcance.
7. **Datos pendientes de verificar en fuente oficial**: fecha exacta de la obligación de entrega digital (Res. 53/2025), eliminación del RVD (Res. 53/2022), plazo legal de conservación de XML.

---

## 8. Fuentes

**SII (oficiales)**
- Instructivo técnico de emisión de DTE (28-10-2021): https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf
- Instructivo técnico de boleta electrónica (28-10-2021): https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf
- OpenAPI oficial API boleta electrónica (v1.0.5): https://www4c.sii.cl/bolcoreinternetui/api/ (spec en `openapi.json`)
- Formato boleta electrónica v4.2 (08-09-2025): https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf
- Formato XML y schemas: https://www.sii.cl/servicios_online/3532-formato_xml-3811.html
- Descripción de formatos: https://www.sii.cl/servicios_online/1039-descripcion_formato-1184.html
- Instructivo técnico (índice de documentos y web services): https://www.sii.cl/factura_electronica/factura_mercado/instructivo.htm
- Web service de autenticación: https://www.sii.cl/factura_electronica/factura_mercado/autenticacion.pdf
- Envío automático (upload): https://www.sii.cl/factura_electronica/envio.pdf
- Estado de envío y de DTE: https://www.sii.cl/factura_electronica/factura_mercado/estado_envio.pdf · https://www.sii.cl/factura_electronica/factura_mercado/estado_dte.pdf
- Manual del ambiente de certificación: https://www.sii.cl/factura_electronica/factura_mercado/manual_certificacion.pdf
- Instrucciones del set de pruebas: https://www.sii.cl/factura_electronica/factura_mercado/inst_set_pruebas.pdf
- Proceso de certificación: https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm
- Certificación de boleta electrónica: https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm
- Res. Ex. 121/2026 (validaciones): https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf
- Instructivo sobre validaciones de DTE (junio 2026): https://www.sii.cl/servicios_online/docs/instructivo_sobre_validaciones_dte.pdf
- Res. Ex. 144/2026 (facturas y guías de traslado): https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso144.pdf
- Res. Ex. 53/2025 (entrega de boleta): https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso53.pdf
- Res. Ex. 58/2017 (vigencia CAF): https://www.sii.cl/documentos/resoluciones/2017/reso58.pdf
- Web service registro aceptación/reclamo (v1.2): https://www.sii.cl/factura_electronica/Webservice_Registro_Reclamo_DTE_V1.2.pdf
- Noticia SII sobre entrega digital de boletas (2025): https://www.sii.cl/noticias/2025/270225noti01aav.htm

**Librerías y proveedores**
- LibreDTE lib-core (PHP, AGPL-3.0): https://github.com/LibreDTE/libredte-lib-core
- SimpleSDK (.NET, cliente de SimpleAPI): https://www.nuget.org/packages/SimpleSDK/ · https://github.com/chilesystems/SimpleSDK
- dty-fy (npm): https://www.pkgstats.com/pkg:dty-fy
- Ejemplo de token boleta (Chilkat): https://example-code.com/java/sii_POST_boleta_electronica_token.asp
- Eliminación del RVD (secundarias): https://www.cnnchile.com/sin-categoria/sii-eliminara-la-obligacion-de-enviar-el-resumen-de-ventas-diarias/ · https://blog.tasboletaelectronica.cl/resumen-de-ventas-diarias-agosto-01
- Entrega digital de boleta 2026 (secundaria): https://www.buk.cl/novedades/finanzas/boleta-electronica-en-chile-guia-y-obligaciones

**SAP Business One**
- Working with SAP Business One Service Layer (10.0): https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf
- What's New in SAP Business One 10.0 (localización Chile, Web Client): https://help.sap.com/doc/1e4d3a635ae2433597e22263e3b2c8f4/10.0/en-US/Whats_New_EN.pdf
- SDK Help 10.0 (DI API, EFM): https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM_P.html
- Extension Registration Data Generator (lightweight deployment): https://help.sap.com/doc/011000358700000788122013e/1.1/en-US/B1_Cld_Add-On_RegData.pdf
- Extensiones del Web Client (UI API framework, FP 2405): https://learning.sap.com/courses/developing-ui-api-extensions-for-sap-business-one-web-client/exploring-the-capability-to-customize-ui-pages-in-sap-business-one-web-client
- Electronic Billing con Generic eDoc Protocol (marco EFM/EDS, India): https://help.sap.com/doc/3239b0a7c96545bdace2e1d911925da0/10.0/en-US/How_to_Work_with_Electronic_Billing.pdf
- Bases demo localizadas 10.0 FP 2011: https://blogs.sap.com/2021/01/29/localized-demo-databases-now-available-for-sap-business-one-10.0-fp-2011/
- Integración de un proveedor chileno con B1 (referencia de mercado): https://simplo.cl/herramientas/facturacion-electronica/emitir-desde/sap-business-one/
