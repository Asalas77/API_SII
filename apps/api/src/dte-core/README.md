# dte-core

Núcleo criptográfico y XML para DTE y boletas electrónicas del SII. Dominio puro: sin decoradores de NestJS ni red. Todo se exporta desde `index.ts` (excepto `testing/`, que se importa explícitamente).

## Contenido

| Carpeta | Qué hace |
| --- | --- |
| `caf/` | `parsearCaf`, `folioEnRango`, `cafVigente`, `claveCafCoincide` (firma/verifica un dato con el par del CAF). `xmlCaf` conserva el `<CAF>` textual del archivo. Vencimiento = autorización + 6 meses (`mesesVigencia` parametrizable). |
| `ted/` | `generarTed` y `verificarTed`. |
| `firma/` | `firmarXml` (por `ID`), `firmarDocumentoCompleto` (`URI=""`, semilla de autenticación), `verificarFirmaXml` y `crearFirmadorSii` (adaptador `{ firmarXml(xml, idReferencia?) }` para el gateway; sin id firma el documento completo). |
| `xml/` | `escaparXml`, `aIso88591`, `desdeIso88591`, `formatearFechaSii`, `formatearTimestampSii`, RUT (`formatearRut`, `calcularDv`, `validarDv`, `validarRut`, `separarRut`). |
| `xsd/` | `validarXsd(xml, 'DTE'|'EnvioDTE'|'EnvioBOLETA'|'RespSII'|'RespuestaEnvioDTE'|'EnvioRecibos'|'LibroCV'|'LibroGuia')` con `libxml2-wasm`; validadores cacheados. |
| `libros/` | `construirLibroCompraVenta` y `construirLibroGuias`: libros electrónicos IECV y de guías de despacho (ver abajo). |
| `certificado/` | `cargarPfx` (node-forge): PEM de certificado y clave (PKCS#8), CN, vigencia, RUT del SAN. |
| `exportacion/` | Documentos de exportación 110, 111 y 112 (`construirDteExportacion`, totales decimales, validaciones) y `tablas/` con los códigos de Aduana (ver sección Exportación). |
| `testing/` | Solo pruebas: `generarCertificadoPrueba`, `generarPfxPrueba`, `generarCafPrueba`, `documentoExportacionDePrueba`. |

## Decisiones

- **Encoding**: los documentos al SII van en ISO-8859-1. `aIso88591` antepone `<?xml version="1.0" encoding="ISO-8859-1"?>` (reemplazando otra declaración) y convierte; caracteres fuera de Latin-1 se sustituyen por equivalentes (comillas tipográficas, guiones, `…`, etc.) o por `?`.
- **TED**: orden fijo `RE, TD, F, FE, RR, RSR, MNT, IT1, CAF, TSTED`, sin espacios entre tags. `RSR` e `IT1` se truncan a 40 caracteres *antes* de escapar. En texto solo se escapan `& < >` (el TED se firma textualmente y viaja en el PDF417). `FRMT` = RSA-SHA1 (PKCS#1 v1.5) sobre los bytes ISO-8859-1 del string exacto `<DD>…</DD>`, base64. `verificarTed` extrae `<DD>` textualmente, sin re-serializar.
- **Firma**: C14N 1.0 (`REC-xml-c14n-20010315`), `rsa-sha1`, digest `sha1`, único transform `enveloped-signature`, `Reference URI="#ID"` (o `URI=""` en `firmarDocumentoCompleto`, que conserva textualmente declaración y saltos del XML: la semilla queda en las 2 líneas que exige el SII). `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` sin prefijo, último hijo de la raíz. `KeyInfo` = `KeyValue/RSAKeyValue(Modulus,Exponent)` + `X509Data/X509Certificate` (orden exigido por `xmldsignature_v10.xsd`), generado con `getKeyInfoContent`. `verificarFirmaXml` verifica *todas* las `Signature` del documento (p. ej. SetDTE + cada DTE) con el certificado embebido; no valida la cadena de confianza del certificado.
- **XSD**: carpeta por `SII_XSD_DIR` o búsqueda hacia arriba de `resources/sii/xsd` desde `import.meta.dirname` (funciona desde `src/` y `dist/`). Se usa la URL `file://` del XSD como base para resolver `include`/`import`.
- **Fechas**: `formatearFechaSii`/`formatearTimestampSii` usan `America/Santiago` (Intl), sin zona en el string.

## Constructores

`documento/` y `envio/` arman los XML a partir de un modelo tipado. Todo es dominio puro y reutiliza `generarTed`, `firmarXml`, `aIso88591`, etc.

| Archivo | Qué hace |
| --- | --- |
| `documento/tipos.ts` | `DocumentoDte` (`idDoc`, `emisor`, `receptor`, `detalle[]`, `descuentosRecargos[]`, `referencias[]`, `impuestosAdicionales[]`) y `TotalesDte`. |
| `documento/totales.ts` | `calcularTotales(doc)`, montos enteros en CLP. |
| `documento/construir-dte.ts` | `construirDte(doc, { caf, certificado, fechaFirma?, validarVigenciaCaf? })` -> `{ xmlFirmado, xmlIso, ted, idDocumento, totales }`. |
| `envio/envio.ts` | `construirEnvioDte` y `construirEnvioBoleta` (sobre + `Caratula` + firma de `SetDoc`). |
| `testing/documentos-prueba.ts` | Solo pruebas: `cafDePrueba`, `documentoDePrueba`. |

### Totales

- Redondeo: mitades hacia arriba, con aritmética entera para IVA y neto (sin errores de coma flotante). `MontoItem = round(cantidad * precio) - descuento` (el descuento % se redondea sobre el bruto de la línea).
- Facturas/notas/guías (33, 56, 61, 52): `MntNeto` = afectos, `MntExe` = exentos (`IndExe=1`), `TasaIVA=19`, `IVA = round(MntNeto*0,19)`, `MntTotal = MntNeto + MntExe + IVA + impuestos adicionales`.
- Boletas (39, 41): precios con IVA incluido. `MntTotal` = suma de líneas (± globales); `MntNeto = round(afecto/1,19)`, `IVA = afecto - MntNeto` (v4.2: `MntNeto`/`IVA` obligatorios en afecta, no se informan en exenta; `IndMntNeto` no se usa).
- 34 y 41: todo exento, sin `MntNeto`/`TasaIVA`/`IVA`. Totales en cero no se informan (excepto `MntTotal`).
- Descuentos/recargos globales: se calculan sobre la suma de líneas de su base (afecta, o exenta con `exento: true`) de forma independiente, no encadenada.
- `impuestosAdicionales` solo suma al total (no modela retenciones ni `IVANoRet`).

### Orden de tags (XSD oficial)

- `DTE_v10.xsd`: `Encabezado(IdDoc, Emisor, Receptor, Totales)`, `Detalle*`, `DscRcgGlobal*`, `Referencia*`, `TED`, `TmstFirma`, `Signature`. Emisor: `RUTEmisor, RznSoc, GiroEmis, Telefono, CorreoEmisor, Acteco(1-4), CdgSIISucur, DirOrigen, CmnaOrigen, CiudadOrigen`. En `IdDoc`, `MedioPago` va antes de `FchVenc`.
- `EnvioBOLETA_v11.xsd`: emisor con `RznSocEmisor`, `GiroEmisor` (sin `Acteco`, que se rechaza); `IndServicio` obligatorio (por defecto 3); `FchVenc` va antes de `MedioPago` (1 a 5); la `Referencia` no tiene `FchRef`; `Receptor` admite el RUT genérico `66666666-6`.
- El `<DTE>` declara `xmlns` y `xmlns:xsi`, igual que el sobre, para que la canonización (y la firma) sea idéntica dentro y fuera del sobre.
- Texto: se sanea a Latin-1 antes de firmar, se trunca al máximo del XSD (`NmbItem` 80, `RznSoc` 100, `GiroEmis` 80, `GiroRecep` 40, comuna/ciudad 20, etc.) y se escapa.

### Límites (de los XSD)

| Concepto | Máximo |
| --- | --- |
| `Detalle` en DTE (33/34/52/56/61) | 60 |
| `Detalle` en boletas (39/41) | 1000 |
| `DscRcgGlobal` / `Referencia` | 20 / 40 |
| `Acteco` | 4 |
| DTE por `EnvioDTE` | 2000 |
| Boletas por `EnvioBOLETA` | 500 (recomendado: 50 por envío, constante `BOLETAS_POR_SOBRE_RECOMENDADO`) |

### Validaciones de negocio (`ErrorValidacionDte`)

Folio fuera del rango del CAF, CAF de otro tipo o de otro emisor, DV de RUT incorrecto, boleta con `Acteco`, factura sin `Acteco`, notas 56/61 sin referencia al documento (una referencia `SET` no cuenta) o sin `codRef`, 33/39 sin ítems afectos, RUT genérico fuera de boletas, exceso de líneas, fechas mal formadas.

### Vigencia del CAF y proveedor de software

- `construirDte` rechaza (`ErrorValidacionDte`) un CAF vencido a la `fechaEmision` del documento, solo para `TIPOS_CAF_CON_VENCIMIENTO` (33, 56, 61: crédito fiscal, 6 meses, Res. Ex. 58/2017). Boletas, 34 y 52 no vencen. `validarVigenciaCaf: false` lo desactiva. El alcance exacto por tipo sigue marcado "verificar" en la documentación del proyecto.
- `proveedorSoftware` (`{ rut, dv, razonSocial? }`): en boletas emite `<RUTProvSW>` entre `Receptor` y `Totales`. El XSD solo define `RUTProvSW` (no hay razón social), así que `razonSocial` no se emite; se ignora en tipos que no son boleta.

### Sobres

`construirEnvioDte`/`construirEnvioBoleta` insertan cada DTE firmado textualmente (solo se quita la declaración XML), agrupan `SubTotDTE` por tipo y firman `SetDoc`. `rutReceptor` por defecto es `60803000-K` (SII); en intercambio se pasa el RUT del cliente. El tipo de cada DTE se lee del texto de `IdDoc/TipoDTE`.

## Libros electrónicos (`libros/`)

Dominio puro (sin Nest ni red). Formatos: `docs/referencias-sii/pdf/SII_Formato_IECV_Libros_Compra_Venta.pdf` (v2.2) y `SII_Formato_Libro_Guias_Despacho.pdf` (v1.0); XSD en `resources/sii/xsd/libros/` (ver su README). Ambos reciben datos tipados, calculan los resúmenes, arman el XML, **firman `EnvioLibro` por su `ID`** (`firmarXml`, RSA-SHA1, igual que el resto) y devuelven `{ xml, xmlIso, idEnvio, resumenPeriodo, resumenSegmento, ... }`. El llamador valida con `validarXsd(xmlIso, 'LibroCV' | 'LibroGuia')` (la API lo hace siempre antes de guardar).

| Función | Raíz XML | Resumen |
| --- | --- | --- |
| `construirLibroCompraVenta({ caratula, detalle, resumenesAdicionales?, documentosPeriodo?, factorProporcionalidad?, certificado, fechaFirma?, idEnvio? })` | `LibroCompraVenta` | `TotalesPeriodo`/`TotalesSegmento` por tipo de documento (y tipo de impuesto). |
| `construirLibroGuias({ caratula, detalle, guiasPeriodo?, certificado, ... })` | `LibroGuia` | Guías de venta, anuladas, modificadas y `TotTraslado` por tipo de operación (2 a 7). |

### Reglas implementadas

- **Carátula**: `TipoLibro` MENSUAL/ESPECIAL/RECTIFICA; ESPECIAL exige `FolioNotificacion` (en el set: 1 ventas, 2 compras); RECTIFICA exige `CodAutRec`; PARCIAL exige `NroSegmento`. El libro de guías solo admite ESPECIAL y siempre `FolioNotificacion`.
- **Tipos de envío**: TOTAL = resumen de período + detalle; PARCIAL = resumen de segmento + detalle; FINAL = solo resumen de período (se calcula con `detalle`, que se entiende como todo el período, y no se emite); AJUSTE = resumen de segmento **con signo** (`operacion: 2` elimina y resta) + resumen de período calculado desde `documentosPeriodo` / `guiasPeriodo` (obligatorio) + detalle.
- **Totales por tipo**: `TotDoc` cuenta todos los documentos incluidos los anulados; los montos de **folios anulados** (`anulado: true`, solo tipo y folio en el detalle) no se suman; contadores opcionales (`TotOp*`, `TotAnulado`) se omiten en cero. Las **notas de crédito se informan en positivo en su propia fila** (así lo pide el formato); `saldo` (informativo) las resta (60, 61, 112).
- **Montos del detalle (compras y ventas)**: `montoTotal` = exento + neto + IVA recuperable + IVA uso común + IVA no recuperable (por código 1, 2, 3, 4, 9) + otros impuestos con crédito + impuestos sin derecho a crédito + depósito de envases − IVA retenido (total y parcial) − crédito empresa constructora. Si se informa y no cuadra se rechaza; si se omite se calcula. `montoIva` por defecto = `round(neto * tasa)` con tasa 19 (informe 0 si el IVA es todo de uso común o no recuperable). Activo fijo (`montoNetoActivoFijo`, `ivaActivoFijo`) e IVA fuera de plazo/propio/terceros son informativos (ya están incluidos en neto e IVA).
- **Compras**: `factorProporcionalidad` (0,001 a 99,999) agrega `FctProp` (3 decimales) y `TotCredIVAUsoComun = round(factor * IVA uso común)` a cada tipo con IVA de uso común.
- **Ventas**: boletas y demás tipos "solo resumen" (35, 38, 39, 41, 105, 500, 501, 919, 920, 922, 924) no van en el detalle; se pasan en `resumenesAdicionales` y salen solo en el resumen de período.
- **Guías**: `TpoOper` 1 venta (exige RUT del receptor; debería informar la factura asociada), 2 a 7 traslados no venta; `Anulado` 1 folio anulado antes del envío (sin más datos), 2 anulada después, 3 recibida parcialmente (`montoModificado`). `TotGuiaVenta`/`TotMntGuiaVta` excluyen anuladas.
- Texto: saneado a Latin-1, truncado (razón social 50) y escapado; salida ISO-8859-1.

### No cubierto (por ahora)

Libros contables (CAL/COCERTIF), liquidaciones y liquidaciones-factura (`Liquidaciones`, montos negativos), `Ley18211` como monto (solo `TpoImp` 2), tabacos, pasajes (`PsjNac`/`PsjInt`), impuesto a vehículos, `MntNoFact`/`MntPeriodo`, factor de impuesto adicional (`FctImpAdic`/`TotCredImp`) y tipos de cambio (500/501). `LibroGuia` se valida con una copia del XSD que importa `xmldsig` (ver `resources/sii/xsd/libros/README.md`). Los estados de proceso propios de libros en el SII no figuran en el PDF de QueryEstUp; se reutiliza la clasificación de estados de envío.

### Pendientes

Liquidaciones, factura de compra (46), retenciones y `IVANoRet`, `SubTotInfo`, `Comisiones`, `OtraMoneda`, ítem espectáculo/`InfoTicket` de boletas.

## Res. Ex. SII 144/2026: guías y facturas que amparan traslado

Vigente desde el 2026-11-01 (GDT y ATT opcionales hasta el 2027-05-01). Código: `documento/traslado.ts` (validación y normalización, pura) y `construir-dte.ts` (XML). Pruebas: `documento/traslado.spec.ts`. Documentación oficial consultada: `docs/referencias-sii/README.md` (sección "Res. Ex. 144/2026").

### Exigencia del bloque `traslado` en toda guía 52

Desde el 2026-11-01 toda guía de despacho debe informar sus datos de transporte. Con `EXIGIR_TRASLADO_GUIAS=true` (por defecto; opción `exigirTrasladoGuias` de `construirDte`, que en el núcleo vale `false` si no se indica) un 52 sin bloque `traslado` se rechaza con 422 `DOCUMENTO_INVALIDO`, `errors[0].campo = traslado` y un mensaje que cita la Res. Ex. SII 144/2026 y lo que falta (categoría y, según ella, transportista, chofer, patente, fecha de salida y destino). Con el bloque presente rigen las validaciones por categoría (autogestionado exige todo, tercerizado admite diferidos, régimen especial su mínimo). Las facturas 33/34 no cambian: el bloque sigue siendo opcional y con `retiroComprador` no se exige; `complementar-traslado` tampoco cambia (sus guías siempre llevan bloque). Excepción: el set de pruebas del SII no trae transporte, por lo que `ejecutarSet` emite sus guías con la opción interna `omitirExigenciaTraslado` de `DocumentosService.emitir` (no existe en el DTO HTTP). Con `EXIGIR_TRASLADO_GUIAS=false` se emite sin transporte (solo migraciones o pruebas).

### Estado del XSD oficial (2026-11-22)

El `DTE_v10.xsd` vigente del SII (2026-02-19, idéntico al que se descarga hoy de `.../factura_mercado/schema_dte.zip`) **solo enumera `IndTraslado` 1 a 9**. Sí trae, en el lugar correcto, `Transporte` (`Patente` y `PatenteCarro` texto de hasta 8, `RUTTrans` tipo RUT, `Chofer` con `RUTChofer` tipo RUT y `NombreChofer` de hasta 30, `DirDest`, `CmnaDest`, `CiudadDest`, `Aduana`, `FchSalida`, `HraSalida`, `FchLlegada`) entre `Receptor` y `Totales`, y `RUTOtr` en `Referencia` (entre `FolioRef` y `FchRef`). El formato v2.5 (2026-02) cita la Res. 154/2025, no la 144. **No hay XSD ni manual publicados para `IndTraslado` 10-12, para "Diferido"/"Sin Dato" ni para el ATT.** Por eso:

- `IndTraslado` 10 (GDT), 11 y 12 están implementados pero **deshabilitados** (`PERMITIR_INDTRASLADO_RES144=false` por defecto; opción `permitirIndTrasladoRes144` de `construirDte`): rechazo 422 con `errors[0].campo = idDoc.indTraslado` y la explicación. Con `true` el XML se arma, pero no valida contra el XSD vigente (la prueba `traslado.spec.ts` lo fija: el único error es `IndTraslado`) y el SII lo rechazaría hasta que publique el XSD; entonces basta reemplazar `resources/sii/xsd` y activar la variable.
- Falta (no inventado): XSD con 10-12, representación oficial de "Diferido"/"Sin Dato" en campos tipo RUT/fecha, formato del ATT (resolutivo 10°) y el mapeo `IndTraslado` -> `TpoOper` del libro de guías para 8-12 (el formato del libro solo define 1 a 7; ver `libros-desde-documentos.ts`).

### Bloque `traslado` (`DocumentoDte.traslado`)

`categoria` (`autogestionado` | `tercerizado` | `regimen_especial`), `origen` (por defecto la dirección del emisor; va a `Emisor/DirOrigen`/`CmnaOrigen`), `destino`, `fechaSalida`, `horaSalida?`, `fechaLlegada?`, `transportista.rut`, `chofer {rut, nombre}`, `patente`, `patenteCarro?`, `diferido[]`/`sinDato[]` (campos: `transportista`, `choferRut`, `choferNombre`, `patente`, `patenteCarro`, `fechaSalida`), `retiroComprador`, `descripcionProlongado`, `motivoSinPrecio`. Además `idDoc.indTraslado` (1 a 12), `DetalleDte.peso`/`volumen` (el formato no tiene campo por ítem: van en `DscItem`) y `ReferenciaDte.rutOtroContribuyente` (`RUTOtr`). Sin bloque `traslado` el documento se emite como antes (necesario para el set de certificación, que no trae datos de transporte).

### Reglas (`normalizarTraslado`; errores en español con el campo, p. ej. `traslado.chofer.rut: ...`)

- Solo 33, 34 y 52 (no boletas: resolutivo 14°; no notas). `categoria` e `idDoc.indTraslado` (en guías) obligatorios.
- **autogestionado**: transportista, RUT y nombre del chofer, patente y fecha de salida, origen y destino obligatorios; no admite diferido/sinDato.
- **tercerizado**: cada uno de los cinco datos anteriores se informa o se marca diferido/sinDato; origen y destino obligatorios. Informar un valor y marcarlo a la vez es error.
- **regimen_especial** (resolutivo 11°): basta fecha de emisión, tipo de traslado, dirección de origen y la descripción del ítem. La excepción no vale fuera de zona primaria: no es verificable aquí.
- **retiroComprador** (resolutivo 15°): solo facturas, sin ningún dato de transporte.
- **GDT (`indTraslado` 10)**: categoría tercerizado, al menos una referencia a un documento tributario (idealmente con `rutOtroContribuyente`), cantidad y precio del ítem opcionales (detalle mínimo; resolutivo 6°). `cantidad` solo se puede omitir aquí.
- **11/12**: `fechaLlegada` (no anterior a la salida) y `descripcionProlongado` obligatorios.
- **Precio** (guías): 1, 2, 3, 9 y 11 llevan precio; 4-8 y 12 pueden omitirlo con `motivoSinPrecio`.
- `rutOtroContribuyente`: RUT válido, distinto del emisor, solo si `tipoDocRef` es tributario (`TIPOS_DOC_TRIBUTARIOS`, SUPUESTO).
- Formatos: RUT con DV y cuerpo entre 100.000 y 99 millones (formato DTE v2.5); nombre del chofer hasta 30 caracteres (error, no se trunca); patente normalizada (mayúsculas, sin espacios/puntos/guiones) con patrón `AB1234`, `BCDF12`, `ABC12`, `ABC123` o `AB123` (SUPUESTO: el SII solo fija "texto de hasta 8"); fechas entre 2003-04-01 y 2050-12-31; hora `HH:MM[:SS]`.

### "Diferido" / "Sin Dato" (resolutivo 4°; SUPUESTO, sin respaldo oficial del formato)

`Patente`, `PatenteCarro` y `NombreChofer` son texto en el XSD y llevan el literal `Diferido` o `Sin Dato`. `RUTTrans`, `RUTChofer` (y por tanto todo `Chofer`, que exige RUT) y `FchSalida` no admiten texto: el elemento se omite. En todos los casos se agrega a `DscItem` de la primera línea "Datos de traslado pendientes (Res. Ex. SII 144/2026): RUT chofer: DIFERIDO; ..." para dejar constancia expresa en el documento; la representación impresa lee ese texto. El traslado queda `pendiente` (`traslado_pendiente`) y se completa con una guía posterior que lo referencia, una GDT o el ATT (`POST /v1/documentos/{id}/complementar-traslado`, ver `src/documentos/README.md`). Lo mismo con el traslado prolongado ("Traslado prolongado: ... Fecha estimada de llegada: ...") y el motivo de la ausencia de precio ("Sin precio unitario: ..."), que se agregan a `DscItem`.

### No cubierto

Registro de Guías de Despacho (anular una guía reemplazada: es manual en el sitio del SII, no hay web service en el alcance), informar el modelo operacional de transporte (resolutivo 16°, aplicativo web del SII), excepciones de courier/postales (resolutivo 12°) y el envío del ATT.

## Exportación: 110 Factura, 111 Nota de débito y 112 Nota de crédito de exportación

Código: `exportacion/` (`tipos.ts`, `totales.ts`, `construir.ts`, `tablas/`); `construirDte` despacha a `construirDteExportacion` cuando `idDoc.tipoDte` es 110, 111 o 112 y exige el bloque `DocumentoDte.exportacion`. Pruebas: `exportacion/construir.spec.ts` (XML válido contra `DTE_v10.xsd`, firma, TED, sobre `EnvioDTE` junto a una 33, validaciones, redondeo). Fuentes: `DTE_v10.xsd` (elemento `Exportaciones`, hermano de `Documento` y `Liquidacion`; **el XSD manda**), `SII_Formato_DTE_v2.5_2026-02.pdf` (secciones de exportación y obligatoriedad por tipo), `SII_Instructivo_Emision_DTE_2021-10-28.pdf` (TED), `SII_Manual_Muestras_Impresas.pdf`, `SII_Formato_IECV_Libros_Compra_Venta.pdf`.

### Estructura del XML

`<DTE><Exportaciones ID="F{folio}T{tipo}">` con `Encabezado` (`IdDoc` con `TipoDespacho`, `IndServicio`, `FmaPago`, `FmaPagExp`, `FchCancel`...; `Emisor` con `Acteco` obligatorio; `Receptor` con `RUTRecep` **55555555-5**, `RznSocRecep`, `Extranjero(NumId, Nacionalidad, IdAdicRecep)`, `GiroRecep`, `DirRecep`...; `Transporte/Aduana` con los 26 campos del formato; `Totales(TpoMoneda, MntExe, MntTotal)` en la moneda de la operación y `OtraMoneda(TpoMoneda "PESO CL", TpoCambio, MntExeOtrMnda, MntTotOtrMnda)` con el equivalente en pesos), `Detalle`, `DscRcgGlobal`, `Referencia`, `TED`, `TmstFirma`. La firma referencia `#F{folio}T{tipo}` (el `ID` va en `Exportaciones`). Sin `IVA`, `MntNeto` ni impuestos: el monto exento es el total.

### Montos y redondeo (aritmética decimal exacta con BigInt)

- Cantidad y precio: hasta 6 decimales (`Dec12_6Type`). `MontoItem = round4(cantidad x precio) - descuentos` (4 decimales, mitades hacia arriba; el descuento % se redondea sobre el bruto). `MntExe` = `MntTotal` = suma de líneas menos/más descuentos y recargos globales, hasta 4 decimales (decimal 18,4 en el XSD).
- `DescuentoPct` hasta 2 decimales; `DescuentoMonto` por línea es **entero** (el XSD lo tipa `MntImpType`, entero positivo; la validación lo informa); `ValorDR` global hasta 2 decimales y mínimo 0,01 (`Dec16_2Type`); `TotClauVenta` hasta 2 decimales; `MntFlete`/`MntSeguro` hasta 4 y > 0; pesos hasta 2 decimales.
- Equivalente en pesos: `round(MntTotal x TpoCambio)` entero (mitades hacia arriba), tipo de cambio de 0,0001 a 999999,9999 pesos por unidad de moneda, informado igual en `MntExeOtrMnda` y `MntTotOtrMnda`. Más de los decimales admitidos en un dato de entrada se rechaza (no se redondea en silencio).
- **TED**: `RR` 55555555-5, `RSR` razón social del receptor (40) y `MNT` = **monto en pesos enteros** (`MntTotOtrMnda`). El Instructivo de Emisión define `MNT` como "Monto Total del DTE en pesos chilenos, en notación decimal entera (sin decimales)"; el XSD solo exige un decimal de hasta 4 decimales, así que no hay confirmación de si el SII compara contra pesos o contra la moneda de la operación. SUPUESTO: pesos; si el SII exigiera la moneda, cambiar `monto: t.montoTotalPesos` en `construirDteExportacion`. La misma cifra (pesos) es la que usa `getEstDte` (`MontoDte`, "Monto Total del DTE", numérico de hasta 15 posiciones) y las columnas `monto_exento`/`monto_total` de `documentos`; la moneda, el tipo de cambio y el total en moneda extranjera van en `moneda`, `tipo_cambio` y `monto_moneda`.

### Validaciones (`ErrorValidacionDte` con `campo`; mensajes en español)

- Receptor: RUT 55555555-5 obligatorio (`receptor.rut`), razón social, dirección en la factura 110 (formato: obligatorio), `exportacion.extranjero.nacionalidad` obligatoria (el formato la declara opcional; este proyecto la exige) con código de la tabla de países de Aduana.
- Moneda: glosa de `TipMonType` del XSD, distinta de `PESO` y `PESO CL`; tipo de cambio y decimales.
- Ítems siempre exentos (`IndExe 1`; SUPUESTO: el formato permite omitirlo). Sin impuestos adicionales, sin `traslado` de la Res. 144 (los datos de transporte van en `exportacion.aduana`), sin `indTraslado`, sin `medioPago` numérico. Hasta 60 líneas, 20 descuentos y 40 referencias.
- `indServicio` (3 servicios, 4 hotelería, 5 transporte terrestre internacional, 6 servicios prestados y utilizados en el extranjero) o vacío para bienes. Reglas de obligatoriedad de la factura 110 (tabla del formato v2.5): `codigoPaisReceptor` siempre; modalidad, cláusula y total de cláusula salvo `indServicio` 3, 4 o 5; vía de transporte salvo hotelería (4); para bienes además total de bultos, país de destino y **puertos de embarque y desembarque** (el formato v2.5 los marca opcionales y su texto dice "obligatorio excepto indicador servicio 4"; el Manual de Muestras Impresas exige imprimirlos cuando hay transporte de mercaderías, y se exigen). En 111/112 todo `aduana` es opcional.
- `fechaCancelacion` obligatoria con forma de pago de exportación 32 (anticipo). Bultos: hasta 10 tipos, deben sumar `totalBultos`; `totalItems` debe coincidir con el detalle; unidad obligatoria junto a tara, peso bruto y peso neto; neto no mayor que bruto.
- 111/112: al menos una referencia a 110, 111 o 112 con `codRef` 1, 2 o 3 (la referencia `SET` no cuenta). Una factura referencia como máximo un DUS (807) y una Carta de Porte (811).
- **Cláusula y `TotClauVenta`**: el formato solo dice que es "el valor total de la exportación a pagar por el importador según la cláusula de venta (no incluye comisiones ni otros gastos deducibles en el exterior)"; no define una coherencia numérica con la cláusula (FOB, CIF...) ni con el total del documento, de modo que solo se valida que sea > 0 con 2 decimales. Queda a cargo del emisor.
- Tablas de Aduana (`validarTablasAduana`, por defecto `true`): país, puerto, vía, modalidad, cláusula, forma de pago y tipo de bulto contra `exportacion/tablas`; las unidades de medida solo por formato (tabla parcial). Ver `docs/referencias-aduana/README.md`.
- CAF: 110-112 no están en `TIPOS_CAF_CON_VENCIMIENTO` (SUPUESTO: no vencen, como el 34; la Res. Ex. 58/2017 cita facturas afectas y notas 56/61).

### Resto del sistema

`TIPOS_DTE` incluye 110-112 (carga de CAF, folios, listados); el sobre `EnvioDTE` los admite en el mismo envío que 33/34/52/56/61 (`SubTotDTE` por tipo, validado contra `EnvioDTE_v10.xsd`) y viajan por el upload normal; la recepción de proveedores no los considera (no se reciben facturas de exportación). Representación impresa: factura de exportación en español, formato carta, con moneda, tipo de cambio, equivalente en pesos, datos de Aduana con glosas, sin copia cedible (el Manual de Muestras Impresas solo exige cedible en 33, 34, 52, 46 y 43). Libro de ventas: `TpoDoc` 110/111/112 con montos en pesos (`MntExe`/`MntTotal` = equivalente en pesos, sin IVA), `RUTDoc` 55555555-5 y `Extranjero(NumId, Nacionalidad)`; la nota 112 con `codRef` 1 informa `TpoDocRef`/`FolioDocRef`; los ajustes de tipo de cambio 500/501 del formato IECV no se generan. Set de certificación: ver `docs/certificacion/GUIA-CERTIFICACION.md` (solo JSON).

## Probar

```
cd apps/api
npx vitest run src/dte-core
npx oxlint --type-aware src/dte-core
npx tsc --noEmit -p tsconfig.json
```

`integracion.spec.ts` arma un DTE completo (TED + firma) y lo valida contra `DTE_v10.xsd`, incluyendo el viaje por ISO-8859-1.

## Pendientes / a revisar

- El CAF de prueba tiene `FRMA` aleatorio (no tenemos la clave del SII): no sirve contra el SII real. `parsearCaf` no verifica `FRMA` (requiere la clave pública del SII por `IDK`).
- Validar la firma/KeyInfo contra el ambiente de certificación del SII (formato exacto de `KeyInfo` y espacios en blanco).
- Los CAF reales usan claves RSA de 1024 bits; los tests usan 2048 (el código es agnóstico al tamaño).
- Sin soporte de certificados no RSA ni de PFX con cadena intermedia como salida (solo se retorna el certificado del firmante).
