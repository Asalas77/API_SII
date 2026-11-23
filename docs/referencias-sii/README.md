# Referencias oficiales SII (descargadas el 2026-11-13)

Material público descargado desde sii.cl para trabajar sin conexión. **El XSD es la fuente de verdad**
cuando el PDF de formato esté desactualizado. Verificar periódicamente en el sitio del SII:
https://www.sii.cl/servicios_online/3532-formato_xml-3811.html

## PDF

| Archivo | Qué es | Origen |
|---|---|---|
| `SII_Instructivo_Emision_DTE_2021-10-28.pdf` | Instructivo técnico de emisión de DTE: CAF, TED, XML, firma, PDF417, intercambio | https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf |
| `SII_Instructivo_Emision_Boleta_Electronica_2021-10-28.pdf` | Instructivo técnico boleta electrónica: canal REST, TLS 1.2, 500 boletas/envío, trackid 15 dígitos | https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf |
| `SII_Formato_Boleta_Electronica_v4.2_2025-09-08.pdf` | Formato boleta electrónica v4.2 (campos, obligatoriedad, impresión) | https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf |
| `SII_Formato_DTE_v2.0_2014-09-30.pdf` | Formato DTE publicado en "Descripción de formato" (versión 2014; el XSD 2026 manda) | https://www.sii.cl/servicios_online/docs/formato_dte.pdf |
| `SII_WS_Autenticacion_CrSeed_GetTokenFromSeed.pdf` | Web service de autenticación (semilla + token) para DTE | https://www.sii.cl/factura_electronica/factura_mercado/autenticacion.pdf |
| `SII_Envio_Automatico_DTE_Upload_2003.pdf` | Envío automático por upload (`/cgi_dte/UPL/DTEUpload`, cookie TOKEN, User-Agent) | https://www.sii.cl/factura_electronica/envio.pdf |
| `SII_WS_Estado_Envio_QueryEstUp.pdf` | Web service consulta estado de envío | https://www.sii.cl/factura_electronica/factura_mercado/estado_envio.pdf |
| `SII_WS_Estado_DTE_QueryEstDte.pdf` | Web service consulta estado de un DTE | https://www.sii.cl/factura_electronica/factura_mercado/estado_dte.pdf |
| `SII_Manual_Ambiente_Certificacion.pdf` | Manual del ambiente de certificación (etapas) | https://www.sii.cl/factura_electronica/factura_mercado/manual_certificacion.pdf |
| `SII_Instrucciones_Set_de_Pruebas.pdf` | Cómo construir los DTE del set de pruebas | https://www.sii.cl/factura_electronica/factura_mercado/inst_set_pruebas.pdf |
| `SII_Res_Ex_121_2026_Validaciones_DTE.pdf` | Res. Ex. 121 (04-09-2026): nuevas validaciones, estados aceptado / con reparos / rechazado | https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf |
| `SII_Instructivo_Validaciones_DTE_2026-06.pdf` | Instructivo sobre validaciones de DTE (junio 2026) con nuevos campos de impuestos | https://www.sii.cl/servicios_online/docs/instructivo_sobre_validaciones_dte.pdf |
| `SII_Formato_IECV_Libros_Compra_Venta.pdf` | Formato de la Información Electrónica de Compras y Ventas (IECV, v2.2 2011): carátula, resumen de segmento/período, detalle, códigos de documento e impuestos | https://www.sii.cl/factura_electronica/formato_iecv.pdf |
| `SII_Formato_Libro_Guias_Despacho.pdf` | Formato del Libro de Guías de Despacho Electrónicas (v1.0, 2003) | https://www.sii.cl/factura_electronica/formato_lgd.pdf |
| `SII_Res_Ex_144_2026_Facturas_Guias_Traslado.pdf` | Res. Ex. 144 (23-10-2026): exigencias en facturas y guías que amparan traslado; deroga la 154/2025 | https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso144.pdf |
| `SII_Formato_DTE_v2.5_2026-02.pdf` | Formato DTE v2.5 (2026-02, 54 págs.), el vigente a 2026-11-22. Describe `IndTraslado` 1-9, `Transporte` (`Patente`, `PatenteCarro`, `RUTTrans`, `Chofer`, `DirDest`...), `FchSalida`/`HraSalida`/`FchLlegada` y `RUTOtr`; cita la Res. 154/2025 (derogada por la 144). NO menciona `IndTraslado` 10-12, "Diferido"/"Sin Dato", GDT ni ATT | https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf (enlazado desde https://www.sii.cl/servicios_online/3532-descripcion_formato-3811.html) |

## XSD

| Archivo | Contenido |
|---|---|
| `schema_dte_2026-02-19.zip` | `DTE_v10.xsd`, `EnvioDTE_v10.xsd`, `SiiTypes_v10.xsd`, `xmldsignature_v10.xsd` (archivos fechados 2026-02-19) |
| `schema_envio_bol_EnvioBOLETA_v11.zip` | `EnvioBOLETA_v11.xsd` (2024-12-05) + `xmldsignature_v10.xsd` |
| `schema_ic_RespuestaEnvioDTE_v10.zip` | Intercambio entre contribuyentes (`RespuestaEnvioDTE_v10.xsd`) |
| `schema_resp_RespSII_v10.zip` | Respuesta del SII a envíos automáticos (`RespSII_v10.xsd`) |
| `schema_iecv_LibroCV_v10.zip` | Libros de compras y ventas (`LibroCV_v10.xsd`) y sus dependencias (`LceCoCertif_v10.xsd`, `LceCal_v10.xsd`, `LceSiiTypes_v10.xsd`, `xmldsignature_v10.xsd`) |
| `schema_lgd_LibroGuia_v10.zip` | Libro de guías de despacho (`LibroGuia_v10.xsd`) |

Origen: https://www.sii.cl/factura_electronica/factura_mercado/ (`schema_dte.zip`, `schema_envio_bol.zip`, `schema_ic.zip`, `schema_resp.zip`).
Los libros vienen de https://www.sii.cl/factura_electronica/schema_iecv.zip (`schema_iecv_LibroCV_v10.zip`) y https://www.sii.cl/factura_electronica/schema_lgd.zip (`schema_lgd_LibroGuia_v10.zip`). Sus XSD están extraídos en `apps/api/resources/sii/xsd/libros/` (ver su README: `LibroGuia_v10.xsd` define su propia `Signature` y se usa una copia con el import de `xmldsig`).
Pendientes de descargar si se necesitan: `schema19983.zip` (recibo Ley 19.983), `ConsumoFolio_v10.xsd`.

## Registro de aceptación/reclamo de DTE (Ley 20.956)

Carpeta propia `registro-reclamo/` (descargado el 2026-11-22), usada por `apps/api/src/sii-gateway/reclamo` y `apps/api/src/recepcion`:

| Archivo | Qué es | Origen |
|---|---|---|
| `registro-reclamo/SII_Webservice_Registro_Reclamo_DTE_V1.1.pdf` | "Web Service de Consulta y Registro de Aceptación/Reclamo a DTE recibido" v1.1 (16/03/2017): `ingresarAceptacionReclamoDoc` (ACD, RCD, ERM, RFP, RFT), `listarEventosHistDoc`, `consultarDocDteCedible`, `consultarFechaRecepcionSii`, códigos de respuesta y regla de los 8 días | https://www.sii.cl/factura_electronica/Webservice_Registro_Reclamo_DTE_V1.1.pdf |
| `registro-reclamo/registroreclamodteservice_ws1.wsdl` | WSDL de producción (SOAP 1.1 rpc/literal, `https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice`) | https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice?wsdl |
| `registro-reclamo/registroreclamodteservice_ws2_cert.wsdl` | WSDL de certificación (`https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice`; la ruta lleva el sufijo `CERT`) | https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice?wsdl |
| `registro-reclamo/registroreclamodteservice.xsd2.xsd` | Tipos de la respuesta (`respuestaTo`: `codResp`, `descResp`, `listaEventosDoc*`, `rutToken`) referenciado por los WSDL | https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice.xsd2.xsd |

Nota: la URL del PDF para certificación que da el documento (`.../WSREGISTRORECLAMODTECERT/...`) se confirmó con el WSDL; el PDF no describe el formato de las fechas ni cómo se obtiene el token para este servicio (supuestos documentados en `apps/api/src/recepcion/README.md`).

## OpenAPI

`openapi/sii_boleta_electronica_openapi_v1.0.5.json`: especificación oficial "API SII - V1" (versión 1.0.5) de la API REST de
boleta electrónica, obtenida de https://www4c.sii.cl/bolcoreinternetui/api/openapi.json. Sirve para generar clientes y para
levantar un mock (por ejemplo con Prism) en pruebas. Contiene un carácter de control inválido en una descripción: al
parsear con un lector estricto hay que tolerar control characters.

## Res. Ex. 144/2026: verificación de formato y XSD (2026-11-22)

Se buscó el XSD y el formato técnico actualizados para las exigencias de la Res. Ex. 144 (guías y facturas que amparan traslado):

- `https://www.sii.cl/factura_electronica/factura_mercado/schema_dte.zip` (enlazado desde https://www.sii.cl/servicios_online/3532-formato_xml-3811.html) devuelve un zip idéntico byte a byte (SHA-256 `59429e27...b6c5bee`) a `xsd/schema_dte_2026-02-19.zip`: `DTE_v10.xsd` 2026-02-19, `IndTraslado` solo 1-9. No hay un XSD más nuevo.
- `https://www.sii.cl/factura_electronica/schema_dte.zip` (sin `factura_mercado/`) sirve una versión antigua de 2011; NO se usa.
- `https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf` (v2.5, 2026-02) es el formato más reciente publicado; se guardó como `pdf/SII_Formato_DTE_v2.5_2026-02.pdf`. `https://www.sii.cl/servicios_online/docs/formato_dte.pdf` y `.../factura_mercado/formato_dte.pdf` son versiones anteriores (2014 y 2019).
- La página del instructivo técnico (https://www.sii.cl/factura_electronica/factura_mercado/instructivo.htm) no lista un manual del Anexo de Transporte Tercerizado (ATT), ni un anexo de formato de la Res. 144. Probadas sin éxito (404): `att.pdf`, `manual_att.pdf`, `formato_att.pdf`, `formato_dte_202610.pdf`, `formato_dte_202611.pdf`, `schema_att.zip`, `schema_dte_2026.zip`.
- El Anexo de la propia resolución (página 8 del PDF, es una imagen) solo lista los tags; no define la representación de "Diferido"/"Sin Dato".

Consecuencia para el código: `IndTraslado` 10, 11 y 12 NO están en el XSD oficial y el ATT no está disponible; ver `apps/api/src/dte-core/README.md` (sección Res. Ex. 144/2026).
