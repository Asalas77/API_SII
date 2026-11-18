# 13. Glosario

Términos del SII de Chile y del proyecto. Cuando un término tiene una pieza de código asociada, se indica entre paréntesis (ruta relativa a la raíz del repositorio). Los datos tomados de fuentes secundarias en `docs/01-opciones-arquitectura-y-pruebas.md` están marcados "(verificar)".

## 1. Términos del SII y de la normativa

| Término | Significado |
|---|---|
| **SII** | Servicio de Impuestos Internos de Chile. Autoridad que autoriza folios, recibe los documentos y los valida |
| **DTE** | Documento Tributario Electrónico: factura, guía, nota de crédito o débito, etc. XML firmado según `DTE_v10.xsd` (`apps/api/resources/sii/xsd/DTE_v10.xsd`) |
| **Boleta electrónica** | DTE de venta a consumidor final (tipos 39 y 41). Tiene su propio sobre (`EnvioBOLETA_v11.xsd`), su propia API REST y su propio proceso de certificación |
| **CAF** | Código de Autorización de Folios. XML entregado por el SII con el rango de folios autorizados por tipo de documento, la clave privada RSA del CAF y la firma del SII. Los de documentos con crédito fiscal vencen a los 6 meses (Res. Ex. 58/2017). Tabla `cafs`; parseo en `apps/api/src/dte-core/caf/caf.ts` |
| **FRMA (del CAF)** | Firma del SII sobre el CAF. Se verifica con la clave pública del SII identificada por `IDK`; el proyecto aún no la verifica |
| **Folio** | Número correlativo de un documento, único por emisor y tipo, tomado del rango de un CAF y nunca reutilizado. Lo asigna `FoliosService` (`apps/api/src/folios/folios.service.ts`) |
| **TED** | Timbre Electrónico del DTE. Bloque `<TED>` con `<DD>` (RUT emisor, tipo, folio, fecha, receptor, monto, primer ítem, CAF, timestamp) y `<FRMT>`, firma RSA-SHA1 hecha con la clave privada del CAF. Se codifica en PDF417 en la representación impresa. Código en `apps/api/src/dte-core/ted/ted.ts` |
| **FRMT** | Firma del timbre: RSA-SHA1 sobre los bytes ISO-8859-1 del string exacto `<DD>…</DD>`, en base64 |
| **PDF417** | Código de barras 2D en que se imprime el TED. Planificado (no hay generador todavía) |
| **XMLDSig** | Firma digital XML. El SII exige firma enveloped con `rsa-sha1`, digest `sha1` y canonicalización C14N 2001 |
| **C14N** | Canonicalización XML. Se usa la versión 1.0 (`REC-xml-c14n-20010315`) |
| **EnvioDTE** | Sobre XML que agrupa uno o más DTE (hasta 2000) de tipos distintos de boleta, con `Carátula` y `SetDTE` firmado. Se sube por `DTEUpload`. Constructor: `construirEnvioDte` |
| **EnvioBOLETA** | Sobre de boletas (39 y 41), hasta 500 por envío (recomendado 50). Se envía por la API REST. Constructor: `construirEnvioBoleta` |
| **Carátula** | Encabezado del sobre: RUT emisor, RUT de quien envía, RUT receptor (`60803000-K` es el del SII), fecha y número de resolución, y los `SubTotDTE` (cantidad por tipo) |
| **SetDTE / SetDoc** | Elemento del sobre que contiene los DTE y sobre el que se aplica la firma del sobre |
| **SubTotDTE** | Resumen por tipo de documento (cantidad) dentro de la carátula |
| **RUT / DV** | Rol Único Tributario y su dígito verificador (módulo 11; puede ser `K`). Utilidades `calcularDv`, `validarRut`, `formatearRut` en `apps/api/src/dte-core/xml/xml.util.ts`. En la BD, `rut` es `integer` y `dv` es `char(1)` |
| **RUT genérico `66666666-6`** | RUT del receptor de una boleta cuando no se identifica al cliente; sólo válido en boletas |
| **Track ID** | Identificador que devuelve el SII al recibir un envío (10 dígitos en DTE; 15 dígitos en boletas, según `docs/01-…`). Permite consultar el estado. Columna `track_id` en `documentos` y `envios` |
| **Semilla** | Valor aleatorio que entrega el SII para autenticarse (vale 2 minutos en boletas). Se firma y se canjea por un token |
| **Token** | Credencial de sesión con el SII (1 hora en boletas), enviada como `Cookie: TOKEN=…`. El de boletas y el de DTE son distintos. Caché en `apps/api/src/sii-gateway/comun/http.ts` |
| **PFX / P12** | Archivo con el certificado digital y la clave privada del firmante, protegido con contraseña. Se carga con `cargarPfx` y se guarda cifrado (`certificados.pfx_cifrado`) |
| **Firmante** | Persona natural autorizada por el representante legal para firmar DTE; su certificado lo emite una entidad acreditada por el SII |
| **maullin** | Host de **certificación** de los servicios DTE (`https://maullin.sii.cl`: SOAP de semilla, token y estados, y upload) |
| **palena** | Host de **producción** de los servicios DTE (`https://palena.sii.cl`) |
| **apicert** | Host de **certificación** de la API REST de boletas (`https://apicert.sii.cl/recursos/v1`) |
| **api (api.sii.cl)** | Host de **producción** de la API REST de boletas (`https://api.sii.cl/recursos/v1`) |
| **pangal / rahue** | Hosts temporales para el `POST /boleta.electronica.envio` en certificación (pangal) y producción (rahue) |
| **Ambiente** | `certificacion` o `produccion`; se define por empresa (`empresas.ambiente_sii`) y por envío (`envios.ambiente_sii`) |
| **Certificación** | Proceso por RUT para ser autorizado como emisor: set de pruebas, simulación, intercambio, muestras impresas y declaración de cumplimiento (DTE); proceso aparte para boletas |
| **Set de pruebas** | Casos asignados por el SII durante la certificación; cada DTE lleva en la primera referencia el texto `SET` y el número de caso. Una referencia `SET` no cuenta como referencia a un documento en notas 56/61 |
| **Simulación** | Etapa de certificación con un envío de volumen representativo de la operación real |
| **Intercambio** | Etapa de certificación y práctica de envío y recepción de DTE entre contribuyentes; respuestas `RecepcionDTE`, `EnvioRecibos`, `ResultadoDTE` |
| **Muestras impresas** | Representaciones impresas (PDF) que se revisan en la certificación según el Manual de Muestras Impresas |
| **Estados de un envío** | Códigos del SII para un envío (para boletas, según `docs/01-…`: `REC, EPR, CRT, FOK, PRD, RCH, RCO, VOF, RFR, RPR, RPT, RSC, SOK, RCT`) |
| **Aceptado con reparos** | Estado de un documento aceptado por el SII con observaciones (`RPR` en el canal de boletas). Con la Res. Ex. 121/2026 los estados de recepción son Aceptado, Aceptado con reparos y Rechazado. Enum `aceptado_con_reparos`; columna `documentos.reparos` (jsonb) |
| **Reparo** | Observación del SII sobre un documento aceptado; debe corregirse en documentos posteriores o con una nota |
| **Rechazado** | Documento no aceptado; el folio queda consumido y hay que corregir y volver a emitir con otro folio |
| **RCOF / RVD** | Reporte de Consumo de Folios, hoy Resumen de Ventas Diarias de boletas. Dejó de ser obligatorio el 1 de agosto de 2022 (Res. Ex. 53/2022; fuente secundaria, verificar). No está en el alcance |
| **IECV / libros** | Información Electrónica de Compras y Ventas (libros de compra y venta). Aparece en el proceso de certificación; no está en el alcance del proyecto |
| **Registro de Compras y Ventas (RCV)** | Registro del SII que se alimenta de los DTE recibidos y emitidos |
| **REGISTRORECLAMODTE** | Web service del SII (`ws1`/`ws2.sii.cl`) para que el receptor registre aceptación o reclamo (acciones `ACD, RCD, ERM, RFP, RFT`) dentro de 8 días. Planificado |
| **Correo de intercambio** | Casilla registrada en el SII para recibir DTE de proveedores y respuestas. Columna `empresas.correo_intercambio` |
| **Resolución SII** | Número y fecha de la resolución que autoriza al contribuyente como emisor (`nro_resolucion_sii`, `fecha_resolucion_sii`); van en la carátula |
| **ACTECO** | Código de actividad económica; hasta 4 por emisor (`empresas.actecos`, tipo `int[]`). Obligatorio en facturas y prohibido en boletas |
| **GiroEmis / GiroEmisor** | Giro del emisor (máx. 80 caracteres); en boletas el campo se llama `GiroEmisor` y `RznSocEmisor` |
| **IVA** | Impuesto al Valor Agregado, tasa de 19 % (`TasaIVA=19`) |
| **Impuestos adicionales / específicos** | ILA, IABA, IEC (combustibles), etc. Hoy sólo se suman al total; los campos nuevos de 2026 (`TIEBase`, `TpoImpD`…) están planificados |
| **MntNeto / MntExe / IVA / MntTotal** | Montos del encabezado: neto afecto, exento, IVA y total |
| **IndExe** | Indicador de ítem exento (`IndExe=1`) |
| **IndServicio** | Indicador de servicio en boletas; obligatorio, por defecto 3 |
| **IdDoc** | Bloque del encabezado con tipo, folio, fecha de emisión y condiciones |
| **DscRcgGlobal** | Descuentos o recargos globales del documento |
| **Referencia / CodRef** | Referencia a otro documento; en notas 56/61 es obligatoria, con código de referencia (anula, corrige texto, corrige montos) |
| **RutProvSW / RznSocProvSW** | Datos del proveedor de software exigidos en boletas v4.2 |
| **Res. Ex. 121/2026** | Resolución que introduce tres estados de recepción y validaciones por fases (cronología por publicar) |
| **Res. Ex. 144/2026** | Resolución sobre guías y facturas que amparan traslado (tipo de traslado, origen y destino, transportista, bienes) |
| **ISO-8859-1** | Codificación (Latin-1) obligatoria de los documentos al SII. Utilidades `aIso88591` y `desdeIso88591` |
| **CLP** | Los montos del modelo son enteros en pesos chilenos; no se manejan decimales |

## 2. Términos técnicos y del proyecto

| Término | Significado |
|---|---|
| **API SII** | Nombre del proyecto y del paquete (`apps/api`; respuesta de `GET /` con `nombre: 'api-sii'`) |
| **dte-core** | Núcleo de dominio puro: CAF, TED, firma, XSD, XML, PFX, totales, constructores (`apps/api/src/dte-core`) |
| **sii-gateway** | Adaptador con los clientes HTTP del SII: `BoletaApiClient` y `DteSiiClient` (`apps/api/src/sii-gateway`) |
| **FirmadorXml** | Interfaz que el gateway usa para firmar la semilla: `firmarXml(xml, idReferencia?)` (`apps/api/src/sii-gateway/comun/firmador.ts`) |
| **GestorToken** | Caché de tokens por tipo, ambiente y RUT de empresa, con TTL y deduplicación (`apps/api/src/sii-gateway/comun/http.ts`) |
| **Tenant / empresa** | Cada emisor (un RUT) es un inquilino lógico; toda tabla de negocio lleva `empresa_id` |
| **Idempotency-Key / clave de idempotencia** | Clave que enviará el cliente para que reintentar una emisión no duplique el documento. Columna `documentos.clave_idempotencia` (único parcial por empresa) |
| **Bloqueo pesimista** | `SELECT … FOR UPDATE`; evita que dos transacciones tomen el mismo folio |
| **Advisory lock** | Bloqueo de PostgreSQL por clave (`pg_advisory_xact_lock`); se usa al registrar CAF |
| **Outbox** | Patrón que guarda en la misma transacción la orden de envío para publicarla luego en una cola. Planificado |
| **RLS** | Row Level Security de PostgreSQL; aislamiento por tenant a nivel de fila. Planificado |
| **Clave maestra** | `CERTIFICADOS_MASTER_KEY`: 32 bytes en base64 con que se cifran los PFX (AES-256-GCM) |
| **GCM** | Modo de cifrado autenticado de AES; el tag detecta alteraciones |
| **ADR** | Registro de decisión de arquitectura (`12-decisiones-adr.md`) |
| **Golden file** | Archivo de salida esperada contra el que se compara el XML generado |
| **BullMQ** | Biblioteca de colas sobre Redis prevista para el envío asíncrono. Planificado |
| **SAP B1 / Service Layer / UI API** | SAP Business One; Service Layer es su API REST y UI API/DI API son sus SDK COM. Integración planificada (fase 4) |
| **UDF** | User Defined Field de SAP B1; sirve para guardar folio y estado en los documentos de B1 |
| **ODLN** | Tabla de entregas de SAP B1; origen de las guías de despacho |

## 3. Tipos de documento

La columna "Soportado hoy" indica si `construirDte` (`apps/api/src/dte-core/documento/tipos.ts`, tipo `TipoDte`) lo construye.

| Código | Documento | Canal de envío | Soportado hoy |
|---|---|---|---|
| 33 | Factura electrónica (afecta a IVA) | DTE (`EnvioDTE`) | Sí |
| 34 | Factura no afecta o exenta electrónica | DTE | Sí (todo exento, sin `MntNeto`/`IVA`) |
| 39 | Boleta electrónica | Boleta (`EnvioBOLETA`, REST) | Sí (precios con IVA incluido) |
| 41 | Boleta exenta electrónica | Boleta | Sí (todo exento) |
| 43 | Liquidación-factura electrónica | DTE | No (planificado) |
| 46 | Factura de compra electrónica | DTE | No (planificado) |
| 52 | Guía de despacho electrónica | DTE | Sí, sin datos de traslado de la Res. Ex. 144/2026 |
| 56 | Nota de débito electrónica | DTE | Sí (exige referencia y `codRef`) |
| 61 | Nota de crédito electrónica | DTE | Sí (exige referencia y `codRef`) |
| 110 | Factura de exportación electrónica | DTE | No (planificado) |
| 111 | Nota de débito de exportación electrónica | DTE | No (planificado) |
| 112 | Nota de crédito de exportación electrónica | DTE | No (planificado) |

Los códigos 43, 110, 111 y 112 no figuran en el código; se incluyen para delimitar lo que queda fuera. Tipos de documento referenciados (`TpoDocRef`) que aparecen en el modelo: `33`, `61`, `801` (orden de compra), `SET` (caso del set de pruebas); según `apps/api/src/dte-core/documento/tipos.ts`.
