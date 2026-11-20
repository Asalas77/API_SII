# XSD de libros electrónicos

Extraídos de los paquetes oficiales (`docs/referencias-sii/xsd/schema_iecv_LibroCV_v10.zip` y `schema_lgd_LibroGuia_v10.zip`; origen en `docs/referencias-sii/README.md`). No se modifican, salvo el caso descrito abajo.

| Archivo | Uso |
| --- | --- |
| `LibroCV_v10.xsd` | Libro de compras y ventas (IECV): `LibroCompraVenta`. Importa `xmldsignature_v10.xsd` (`ds:Signature`) y `LceCoCertif_v10.xsd` (libros contables, que a su vez incluye `LceCal_v10.xsd` y `LceSiiTypes_v10.xsd`). |
| `LibroGuia_v10.xsd` | Libro de guías de despacho: `LibroGuia`. Original del SII, sin cambios. |
| `LibroGuia_v10_ds.xsd` | **Copia modificada** de `LibroGuia_v10.xsd`. Es la que usa `validarXsd(xml, 'LibroGuia')`. |
| `xmldsignature_v10.xsd`, `LceCal_v10.xsd`, `LceCoCertif_v10.xsd`, `LceSiiTypes_v10.xsd` | Dependencias de `LibroCV_v10.xsd`. |

## Por qué existe `LibroGuia_v10_ds.xsd`

`LibroGuia_v10.xsd` **no importa** `xmldsignature_v10.xsd`: declara la firma como un tipo propio (`SiiDte:SignatureType`), de modo que su elemento `Signature` debe estar en el namespace `http://www.sii.cl/SiiDte`. Todo el resto de los documentos del SII (DTE, EnvioDTE, LibroCompraVenta) lleva la firma XMLDSig estándar (`http://www.w3.org/2000/09/xmldsig#`), que es la que produce `firmarXml` y la que se usa también en el libro de guías. Con el XSD original, un libro de guías firmado así falla solo por eso (comprobado): `Element '{http://www.w3.org/2000/09/xmldsig#}Signature': This element is not expected. Expected is ( {http://www.sii.cl/SiiDte}Signature )`.

Cambios mínimos de la copia (el resto del archivo es idéntico):

1. se declara `xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` en `xs:schema`;
2. se agrega `<xs:import namespace="http://www.w3.org/2000/09/xmldsig#" schemaLocation="xmldsignature_v10.xsd"/>`;
3. `<xs:element name="Signature" type="SiiDte:SignatureType">` pasa a `<xs:element ref="ds:Signature">` (igual que `LibroCV_v10.xsd`).

**Supuesto no verificable contra el SII real:** que el SII acepte la firma en el namespace `xmldsig#` en el libro de guías (lo hace en los demás documentos). Si en certificación lo rechazara por schema (estado RSC), habría que generar la firma en el namespace SiiDte para ese libro y validar con el XSD original.
