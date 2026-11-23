# intercambio

Intercambio de información entre contribuyentes (etapa "Intercambio" de la certificación del SII). Dominio puro: sin NestJS ni red. Reutiliza `dte-core` (firma, TED, XSD, Latin-1). Todo se exporta desde `index.ts`.

Referencias: `docs/referencias-sii/pdf/SII_Formato_Intercambio_IC.pdf` (respuesta a DTE), `SII_Formato_Recibos_Ley19983.pdf` (recibos) y los XSD `RespuestaEnvioDTE_v10.xsd`, `recibos/EnvioRecibos_v10.xsd` + `Recibos_v10.xsd`. Los XSD mandan sobre los PDF.

## Flujo en la certificación (paso a paso)

1. El SII (o la contraparte) envía por correo un `EnvioDTE` a la casilla de intercambio registrada del contribuyente. *(Buzón IMAP implementado en `src/recepcion`.)*
2. `analizarEnvioRecibido(xml, receptor, historial?, metadatos?)` decodifica (ISO-8859-1, o UTF-8 si lo declara), valida XSD (`EnvioDTE`/`EnvioBOLETA`), verifica firma del sobre y de cada DTE, verifica cada TED con la clave pública del CAF incrustado (`RSAPK`), compara RUT receptor y detecta repetidos. Devuelve `AnalisisEnvio` con estado del envío y de cada DTE.
3. `construirRecepcionEnvio(analisis, datos)` -> `RespuestaDTE/RecepcionEnvio` (acuse de recibo del envío, con `RecepcionDTE` por documento). Se envía al emisor (`RutRecibe`) por correo.
4. Tras la revisión comercial, `construirResultadoDte(resultados, datos)` -> `RespuestaDTE/ResultadoDTE` (aceptado 0, con discrepancias 1, rechazado 2). Ayuda: `resultadoDesdeAnalisis`.
5. Para facturas/guías, `construirEnvioRecibos(documentos, datos)` -> `EnvioRecibos` (Ley 19.983). Ayuda: `documentoRecibidoDesdeAnalisis`.
6. Se guardan `claveEnvio` y los DTE aceptados como historial para detectar repetidos en el siguiente análisis.

Cada constructor devuelve `{ xml, xmlIso }`: `xmlIso` (Buffer ISO-8859-1 con declaración) es lo que se envía.

## Códigos de estado (de las enumeraciones del XSD)

`EstadoRecepEnv`: 0 envío recibido conforme, 1 error de schema, 2 error de firma, 3 RUT receptor no corresponde, 90 archivo repetido, 91 archivo ilegible, 99 otros.
`EstadoRecepDTE`: 0 recibido OK, 1 error de firma, 2 error en RUT emisor, 3 error en RUT receptor, 4 DTE repetido, 99 otros.
`EstadoDTE` (resultado comercial): 0 aceptado OK, 1 aceptado con discrepancias, 2 rechazado. `CodRchDsc` es un entero negativo de 3 dígitos (opcional).
Constantes y glosas en `estados.ts`.

### Orden de verificación y decisiones

Envío (se detiene en la primera falla): ilegible (91) -> schema (1) -> firma del sobre (2) -> RUT receptor de la carátula (3) -> repetido por `SetDTE/@ID` + RUT emisor del historial (90). Raíz distinta de `EnvioDTE`/`EnvioBOLETA` se informa como 1.

DTE: firma (1) -> TED (1) -> RUT emisor válido y igual al de la carátula (2) -> RUT receptor (3) -> repetido en historial o dentro del envío (4) -> datos del TED (`RE`, `TD`, `F`, `MNT`) distintos a los del DTE (99).

- Un DTE rechazado **no** cambia el estado del envío (queda en 0 y el rechazo va en `RecepcionDTE`, como permite el formato). Si el sobre falla (2/3) igual se calcula el detalle por DTE en `dtes`, pero `construirRecepcionEnvio` lo informa tal cual.
- Una firma sólo se acepta si además su `Reference` apunta al elemento esperado (`#SetDTE/@ID` para el sobre, `#Documento/@ID` para cada DTE).
- El TED inválido se informa como `EstadoRecepDTE` 1 (es una firma electrónica, la del CAF) con el detalle en la glosa.
- Un mismo DTE dos veces en un sobre lo rechaza el XSD (`Documento/@ID` duplicado) -> envío 1.
- Glosa = la del XSD, más `: detalle` (máx. 256).
- `RespuestaDTE` es una `choice`: o `RecepcionEnvio*` o `ResultadoDTE*`, nunca ambos. `IdRespuesta`, `CodEnvio` y `NroDetalles` son enteros positivos (el PDF admite 0, el XSD no). `Digest` = `DigestValue` de la firma del sobre y `EnvioDTEID` = `SetDTE/@ID`.
- Para un archivo ilegible (91) no hay RUT emisor: hay que pasar `datos.rutRecibe`.

## Firmas anidadas en `EnvioRecibos`

```
EnvioRecibos
  SetRecibos ID="SetRecibos"
    Caratula
    Recibo                      (uno por documento)
      DocumentoRecibo ID="R1T33F1"
      Signature  -> Reference #R1T33F1   (firma individual del recibo)
    Recibo ...
  Signature      -> Reference #SetRecibos (cubre Caratula y todos los Recibo, con sus firmas)
```

Cada `Recibo` se firma primero suelto (`<Recibo xmlns xmlns:xsi version="1.0">`) y se inserta textualmente en el set, que luego se firma. `xmlns` y `xmlns:xsi` se declaran en ambos niveles para que la canonización de `DocumentoRecibo` sea idéntica suelto y anidado (misma técnica que `<DTE>` dentro de `EnvioDTE`). `verificarFirmaXml` del documento completo verifica las 3 firmas (2 recibos + set); los tests también verifican cada `Recibo` por separado.

La `Declaracion` es el texto fijo del XSD (`DECLARACION_LEY_19983`, sin tildes y con "Art. 4," / "Art. 5"): cualquier variación invalida el documento. Tipos admitidos en `DocType` del XSD de recibos: 33, 34, 46, 52, 56, 61.

## Probar

```
cd apps/api
npx vitest run src/intercambio
npx oxlint --type-aware src/intercambio
npx tsc --noEmit -p tsconfig.json
```

## Pendientes

- ~~Buzón IMAP/SMTP, persistencia del historial, `CodEnvio` e `IdRespuesta`, registro de aceptación/reclamo ante el SII~~: implementados en `src/recepcion` (ver su README). Allí no se usa `historial.envios` (el `SetDTE/@ID` suele ser siempre `SetDoc`; se deduplica por SHA-256 del archivo y por `(emisor, tipo, folio)` de cada DTE).
- No se verifica `FRMA` del CAF (requiere la clave pública del SII por `IDK`, igual que `dte-core`) ni la cadena de confianza de los certificados.
- Sin tratamiento de `Exportaciones`/`Liquidacion` más allá de leer su encabezado; las boletas (`EnvioBOLETA`) se analizan pero no se intercambian entre contribuyentes.
- Validar contra el ambiente de certificación del SII el formato exacto (espacios, `KeyInfo`) de las respuestas y recibos.
