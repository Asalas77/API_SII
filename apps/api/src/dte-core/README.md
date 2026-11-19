# dte-core

Núcleo criptográfico y XML para DTE y boletas electrónicas del SII. Dominio puro: sin decoradores de NestJS ni red. Todo se exporta desde `index.ts` (excepto `testing/`, que se importa explícitamente).

## Contenido

| Carpeta | Qué hace |
| --- | --- |
| `caf/` | `parsearCaf`, `folioEnRango`, `cafVigente`, `claveCafCoincide` (firma/verifica un dato con el par del CAF). `xmlCaf` conserva el `<CAF>` textual del archivo. Vencimiento = autorización + 6 meses (`mesesVigencia` parametrizable). |
| `ted/` | `generarTed` y `verificarTed`. |
| `firma/` | `firmarXml` (por `ID`), `firmarDocumentoCompleto` (`URI=""`, semilla de autenticación), `verificarFirmaXml` y `crearFirmadorSii` (adaptador `{ firmarXml(xml, idReferencia?) }` para el gateway; sin id firma el documento completo). |
| `xml/` | `escaparXml`, `aIso88591`, `desdeIso88591`, `formatearFechaSii`, `formatearTimestampSii`, RUT (`formatearRut`, `calcularDv`, `validarDv`, `validarRut`, `separarRut`). |
| `xsd/` | `validarXsd(xml, 'DTE'|'EnvioDTE'|'EnvioBOLETA'|'RespSII'|'RespuestaEnvioDTE')` con `libxml2-wasm`; validadores cacheados. |
| `certificado/` | `cargarPfx` (node-forge): PEM de certificado y clave (PKCS#8), CN, vigencia, RUT del SAN. |
| `testing/` | Solo pruebas: `generarCertificadoPrueba`, `generarPfxPrueba`, `generarCafPrueba`. |

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

### Pendientes

Guía de despacho con datos de traslado (Res. 144/2026: `Transporte`, `IndTraslado` ampliado), exportación, liquidaciones, factura de compra (46), retenciones y `IVANoRet`, `SubTotInfo`, `Comisiones`, `OtraMoneda`, ítem espectáculo/`InfoTicket` de boletas.

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
