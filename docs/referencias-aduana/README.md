# Referencias de Aduana (tablas de códigos de exportación)

Los documentos de exportación (110 factura, 111 nota de débito, 112 nota de crédito) llevan códigos de las tablas del
Servicio Nacional de Aduanas (país, puerto, vía de transporte, modalidad y cláusula de venta, forma de pago, tipo de
bulto, unidad de medida). El formato DTE v2.5 las nombra ("tabla de países de Aduana", "tabla publicada en www.aduana.cl")
sin reproducirlas.

## Fuente obtenida

| Archivo | Origen | Fecha |
|---|---|---|
| `Aduana_Anexo51_Compendio_Normas_2026-11-23.html` | **Compendio de Normas Aduaneras, Anexo 51 "Tabla de Códigos"**, página oficial https://www.aduana.cl/compendio-de-normas-anexo-51/aduana/2009-11-19/163937.html (índice general: https://www.aduana.cl/anexos-compendio-de-normas-aduaneras/aduana/2007-02-20/102819.html). Incluye las resoluciones que la modificaron hasta la Res. 1172 de 28.03.2025 (puertos) | 2026-11-23 |
| `html-a-texto.mjs`, `generar-tablas.mjs` | Scripts de un solo uso (Node, sin dependencias) con los que se extrajeron las tablas del HTML: `node html-a-texto.mjs <html> anexo51.txt` y `node generar-tablas.mjs <carpeta-salida> <SiiTypes_v10.xsd>` (leen el texto intermedio y tienen números de línea de esa versión de la página: si Aduana la cambia hay que ajustarlos) | 2026-11-23 |

Las tablas quedaron como datos tipados en `apps/api/src/dte-core/exportacion/tablas/*.ts` (generadas, con la fuente en el encabezado):

| Archivo | Anexo | Filas | Notas |
|---|---|---|---|
| `paises.ts` | 51-9 Países | 233 | código (3 dígitos) y nombre; `abreviatura` cuando el Anexo la indica. Chile = 997 |
| `puertos.ts` | 51-11 Puertos | 352 | agrupados por región y país/tipo tal como los publica el Anexo; puertos chilenos 901 y siguientes |
| `vias-transporte.ts` | 51-13 Vías de transporte | 9 | 1 marítima, 4 aérea, 5 postal, 6 ferroviaria, 7 carretera, 8 oleoductos, 9 tendido eléctrico, 10 otra, 11 courier/aéreo (no existen 2 ni 3) |
| `monedas.ts` | 51-20 Monedas | 51 | código, nombre, abreviatura y país de Aduana (`MONEDAS_ADUANA`) **y** las 40 glosas que enumera el XSD del SII (`GLOSAS_MONEDA_XSD`, de `SiiTypes_v10.xsd`, tipo `TipMonType`) |
| `clausulas-venta.ts` | 51-21 Cláusulas de compraventa | 9 | 1 CIF, 2 CFR, 3 EXW, 4 FAS, 5 FOB, 6 sin cláusula, 7 FCA, 8 otra (el Anexo agrupa aquí CPT, CIP, DPU y DAP), 9 DDP |
| `modalidades-venta.ts` | 51-26 Modalidad de venta | 5 | 1 a firme, 2 bajo condición, 3 consignación libre, 4 consignación con mínimo a firme, 9 sin pago |
| `formas-pago.ts` | 51-22 Formas de pago | 38 | incluye 32 = pago anticipado a la fecha de embarque (el formato exige `FchCancel`) y 21 = sin pago |
| `tipos-bulto.ts` | 51-23 Tipo de bulto | 108 | código (hasta 3 dígitos), descripción y glosa |
| `unidades-medida.ts` | 51-24 Unidades de medida | 11 | **Parcial**: ver abajo |

## Lo que falta o es parcial

- **Unidades de medida (`CodUnidMedTara`, `CodUnidPesoBruto`, `CodUnidPesoNeto`)**: el Anexo 51-24 no trae una tabla "código - unidad"; solo la lista por partida arancelaria con la "sigla a indicar en la declaración" (`SIGLA-CÓDIGO`, p. ej. `U-10`, `LT-09`) y la regla general (kilogramo = `KN`, código 06). Se incluyeron únicamente las unidades que aparecen ahí (11). Cualquier otro código (p. ej. tonelada) **no tiene fuente descargada**: por eso la API valida las unidades solo por formato (entero positivo de hasta 2 dígitos), no contra la tabla.
- **Monedas**: el XSD del SII solo acepta 40 glosas (`DOLAR USA`, `EURO`, `PESO CL`, ..., `OTRAS MONEDAS`); muchas monedas de la tabla de Aduana (yuan, baht, real, ...) no tienen glosa en el XSD y deben informarse como `OTRAS MONEDAS`. La validación de `TpoMoneda` usa la enumeración del XSD. El código numérico de Aduana de una moneda no viaja en el DTE.
- **Puertos y países**: la API los valida contra estas tablas (`validarTablasAduana`, por defecto `true`); si Aduana agrega un código nuevo antes de actualizar el repositorio se puede desactivar o regenerar la tabla.
- **Otras tablas del Anexo 51** (aduanas, almacenistas, regímenes, compañías transportadoras, emisores de sello, etc.) no se usan en el DTE y no se importaron.
- No se obtuvo el SET de pruebas de exportación (es un archivo que el SII entrega en el ambiente de certificación; `SII_Instrucciones_Set_de_Pruebas.pdf` no lo describe).
