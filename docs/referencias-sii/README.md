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

## OpenAPI

`openapi/sii_boleta_electronica_openapi_v1.0.5.json`: especificación oficial "API SII - V1" (versión 1.0.5) de la API REST de
boleta electrónica, obtenida de https://www4c.sii.cl/bolcoreinternetui/api/openapi.json. Sirve para generar clientes y para
levantar un mock (por ejemplo con Prism) en pruebas. Contiene un carácter de control inválido en una descripción: al
parsear con un lector estricto hay que tolerar control characters.
