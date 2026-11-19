# representacion

Representación impresa de DTE y boletas (PDF con timbre PDF417). Dominio puro: sin NestJS ni red. Se importa todo desde `index.ts`.

| Archivo | Qué hace |
| --- | --- |
| `timbre-pdf417.ts` | `generarPdf417(tedXml)` -> PNG. El TED se toma textual del XML firmado y se codifica en bytes ISO-8859-1. |
| `datos-impresion.ts` | `extraerDatosImpresion(xml, indice?)`: parsea un `<DTE>` (suelto o dentro de un sobre; string o Buffer con su encoding declarado) y devuelve el modelo a imprimir, con el nombre del documento en palabras y el TED crudo. |
| `generar-pdf.ts` | `generarPdf(xml, { formato, unidadSii, resolucion, cedible, logo, urlVerificacion })` con pdfkit (Helvetica estándar, Latin-1: tildes y ñ). `admiteCedible(tipo, indTraslado)`. |

## Parámetros del PDF417 (Instructivo de Emisión DTE, Anexo 2, A.2.5)

Byte Compaction (`binarytext`), ECL 5, no truncado, 15 columnas, X dim 0,6 pt (8,3 mils; mínimo 6,7), fila 3:1 (`rowmult: 3`), PNG a 4 px por módulo (480 dpi impreso). Tamaño típico con un CAF real (TED de ~800 bytes): ~7 x 2,5 cm (recomendado máx. 3 x 9; manual: mín. 2 x 5, máx. 4 x 9). Zona de silencio de 0,25" la deja el layout. Si el TED supera ~925 codewords el generador falla (los CAF de `dte-core/testing` usan RSA 2048 y no caben; los reales usan RSA 512/1024).

## Layout

- **Carta** (facturas 33/34, guías 52, notas 56/61): emisor arriba a la izquierda (logo máx. 110x55 pt), recuadro rojo (borde 2 pt) arriba a la derecha con R.U.T., nombre del documento y N°, `S.I.I. - <unidad>` debajo; receptor y fecha; detalle (ítem, código, descripción, cantidad, unidad, precio, descuento, valor); referencias; totales (descuentos/recargos globales, neto, exento, IVA con tasa, impuestos adicionales, total; en 34/41 solo exento y total); timbre abajo a la izquierda a >= 2 cm del borde, con "Timbre Electrónico SII", "Res. N de AAAA" y "Verifique documento: www.sii.cl". Margen >= 0,5 cm. Una sola página en el caso normal; el detalle largo pagina.
- **Térmica 80 mm** (boletas, por defecto en 39/41): recuadro centrado, emisor, fecha, receptor solo si su RUT no es genérico (66.666.666-6), detalle, totales, timbre y leyenda (más `urlVerificacion` si se entrega). Alto ajustado al contenido.
- **Cedible**: solo 33, 34 y 52 (guía con IndTraslado 1, 2, 3, 9 o sin informar). Agrega acuse de recibo (Nombre, R.U.T., Fecha, Recinto, Firma, texto Ley 19.983 / Res. Ex. SII 51) y "CEDIBLE" (guía: "CEDIBLE CON SU FACTURA"). Notas de crédito/débito y boletas ignoran `cedible`, como exige el manual.

## Normas

Instructivo de Emisión DTE (A.2.5), Formato de Boleta v4.2 (columna I, leyenda de verificación) y Manual de Muestras Impresas v3.0 (`docs/referencias-sii/pdf/SII_Manual_Muestras_Impresas.pdf`).

## Pendiente de revisar contra el Manual

- El manual pide recuadro de tipo/folio de 1,5 x 5,5 cm mínimo y 4 x 8 máximo: el de carta mide ~6,5 x ~3 cm (revisar alto con nombres largos de 3 líneas). Letras de 10 pt o más en negrita: cumple (11/12 pt).
- Tipo 46/factura de compra, liquidación, exportación y datos de traslado de guías (Res. 144/2026): no soportados (el núcleo tampoco los emite).
- Sucursales del emisor (opcional) y "Casa Matriz" no se rotulan; el giro va tal como viene en el XML (el manual pide no abreviarlo).
- Boletas: el formato térmico es una interpretación del manual de papel continuo (que para boletas "estará pronto disponible"); revisar al publicarse. Quiet zone del PDF417 térmico: cabe en el margen de la hoja (~16 pt por lado en lugar de 18).
- No hay decodificador de PDF417 en el repo: el contenido del símbolo no se verifica por lectura (solo que el PNG se genera y su tamaño).
- Archivo PDF <= 500 KB: los ejemplos pesan ~45 KB (fuentes estándar, sin incrustar).
