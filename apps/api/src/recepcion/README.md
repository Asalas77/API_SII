# recepcion

Recepción de DTE de proveedores (compras) e intercambio de información entre contribuyentes. Es la capa operativa (NestJS + base de datos + correo + SII) sobre la lógica pura de `src/intercambio/` (análisis del `EnvioDTE`, `RecepcionEnvio`, `ResultadoDTE`, `EnvioRecibos`). Paso a paso para la certificación: `docs/certificacion/GUIA-CERTIFICACION.md`, sección 8.

## Flujo

```
EnvioDTE del proveedor ──(upload multipart | correo IMAP)──▶ RecepcionService.recibirParaEmpresa
   1. SHA-256 del archivo ya existe para la empresa?  ─ sí ─▶ 200, resultado previo, nada se duplica
   2. certificado activo (422 si falta: sin él no hay acuse firmado)
   3. analizarEnvioRecibido(...)  → estado del envío (0,1,2,3,91...) y de cada DTE (0,1,2,3,4,99)
   4. construirRecepcionEnvio(...) firmado con el certificado de la empresa (acuse técnico)
   5. una transacción: envios_recibidos (XML original) + dte_recibidos (solo los DTE con estado 0)
   6. correo: acuse por SMTP al remitente (si el buzón tiene SMTP)
Respuesta comercial:   /aceptar | /rechazar → ResultadoDTE firmado y validado contra el XSD
                       /recibo-mercaderias   → EnvioRecibos (Ley 19.983) firmado y validado
Registro en el SII:    /registrar-sii (ACD|RCD|ERM|RFP|RFT) y /consultar-sii → WS RegistroReclamoDTE
Libro de compras:      POST /empresas/:rut/libros/compras {desdeRecibidos:true}
```

## Endpoints (todos bajo `/v1`)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `POST /empresas/:rut/recepcion` | `recepcion.recibir` | Multipart (`archivo` XML, máx. 5 MB; opcional `remitente`, `enviarCorreo`). 201 al registrar, 200 si el archivo ya estaba (mismo SHA-256). Un sobre rechazado (schema, firma, otro receptor, ilegible) también se registra y se informa. |
| `GET /empresas/:rut/dte-recibidos?periodo=AAAA-MM&estado=&rutEmisor=&pagina=&porPagina=` | `recepcion.leer` | Paginado (`datos` + `paginacion{pagina,porPagina,total,paginas}`). `periodo` filtra por fecha de **emisión**. `estado`: `pendiente`, `aceptado`, `aceptado_con_reparos`, `rechazado`. |
| `GET /empresas/:rut/envios-recibidos` | `recepcion.leer` | Envíos recibidos (paginado), sin el XML original. |
| `GET /envios-recibidos/:id`, `/xml`, `/recepcion-envio` | `recepcion.leer` | Detalle; XML original byte a byte; acuse `RecepcionEnvio`. |
| `POST /envios-recibidos/:id/enviar-acuse` | `recepcion.responder` | Envía el acuse por SMTP (`destinatario` o el remitente del envío). |
| `GET /dte-recibidos/:id`, `/xml`, `/pdf`, `/resultado-dte`, `/envio-recibos` | `recepcion.leer` | Detalle, XML del DTE (la firma sigue verificando), PDF (mismo generador que los emitidos; sin tipos 43/46) y las respuestas generadas. |
| `POST /dte-recibidos/:id/aceptar` `{reparos?, glosa?, enviarCorreo?, destinatario?}` | `recepcion.responder` | `ResultadoDTE` con `EstadoDTE` 0 (o 1 con `reparos`, que exige `glosa`). 409 si ya se respondió. |
| `POST /dte-recibidos/:id/rechazar` `{glosa, codigoRechazo?, ...}` | `recepcion.responder` | `EstadoDTE` 2; `glosa` obligatoria (Ley 19.983). `codigoRechazo`: entero de -1 a -999. |
| `POST /dte-recibidos/:id/recibo-mercaderias` `{recinto, rutFirma, ...}` | `recepcion.responder` | `EnvioRecibos` firmado; tipos 33, 34, 46, 52, 56, 61; una vez por DTE; no procede si fue rechazado. |
| `POST /dte-recibidos/:id/registrar-sii` `{accion}` | `recepcion.responder` | `ingresarAceptacionReclamoDoc`. |
| `POST /dte-recibidos/:id/consultar-sii` | `recepcion.leer` | `listarEventosHistDoc` + `consultarFechaRecepcionSii` + `consultarDocDteCedible`; actualiza `plazo_reclamo_hasta` con la fecha real. |
| `GET\|PUT\|DELETE /empresas/:rut/buzon-correo` | `recepcion.configurar` | Configuración IMAP/SMTP. La contraseña nunca se devuelve (`tienePassword`). |
| `POST /empresas/:rut/buzon-correo/sondear` | `recepcion.recibir` | Revisa el buzón ahora. |

Un recurso de otra empresa responde 404 (igual que si no existiera); una ruta con `:rut` ajeno, 403. Con `enviarCorreo: true` la validación del SMTP y del destinatario ocurre **antes** de guardar la respuesta (422 `SMTP_NO_CONFIGURADO` / `SIN_DESTINATARIO`); si el envío falla después, la respuesta queda guardada y el error va en `correo.error`.

## Datos

Migración `1795600000000-Recepcion` (RLS ENABLE + FORCE por `empresa_id`, política estándar):

- `envios_recibidos`: origen (`upload`/`correo`), remitente, nombre del archivo, `xml` (bytea, tal cual llegó), `hash_sha256` (único por empresa = deduplicación), `codigo_envio` (`CodEnvio`, de la secuencia `seq_codigo_envio_recibido`), emisor, `fecha_firma` (`TmstFirmaEnv`), `estado_recepcion` (`EstadoRecepEnv`), glosa, `xml_recepcion_envio`, `resumen_dtes` (jsonb con **todos** los DTE del sobre, también los rechazados), `respuesta_enviada_en`.
- `dte_recibidos`: solo los DTE con `EstadoRecepDTE` 0 (los rechazados quedan en `resumen_dtes`, para que el emisor pueda reenviar el corregido sin chocar con la unicidad). Montos, `otros_impuestos` (jsonb), XML individual, `estado_comercial`, `glosa`, `xml_resultado_dte`, `xml_envio_recibos`, plazo (abajo), `acuse_recibo_mercaderias`, `registro_sii` (jsonb: historial de acciones intentadas y último listado de eventos). Único `(empresa_id, rut_emisor, tipo_dte, folio)`.
- `buzones_correo`: uno por empresa; contraseñas IMAP/SMTP cifradas con `CifradoService` (AES-256-GCM), nunca se devuelven; `ultimo_sondeo_en`, `ultimo_error`.
- Secuencia `seq_id_respuesta_intercambio` para el `IdRespuesta` de los `ResultadoDTE`.

### Deduplicación

- **Archivo**: SHA-256 de los bytes tal cual llegaron. El mismo archivo (por subida o por correo) devuelve el resultado previo (200 / `repetido: true`) sin escribir nada; una carrera entre dos recepciones simultáneas se resuelve con el índice único.
- **DTE**: `(emisor, tipo, folio)` por empresa; si llega en otro sobre se informa `EstadoRecepDTE` 4 en el acuse y no se duplica.
- **No** se usa `SetDTE/@ID` + RUT emisor (la protección de `analizarEnvioRecibido` con `historial.envios`): casi todos los emisores usan siempre `SetDoc`, así que se rechazarían todos sus envíos tras el primero.

### Plazo de reclamo (`plazo.ts`)

`plazo_reclamo_hasta` = fecha-hora de recepción en el SII + 8 días corridos (192 h). Al recibir el sobre no se conoce esa fecha, así que se **estima con la recepción propia** (`plazo_confirmado_sii = false`), que es igual o posterior a la del SII (el emisor envía al SII y después por correo); por eso la estimación nunca vence antes que el plazo real. `consultar-sii` lee `consultarFechaRecepcionSii`, recalcula con la fecha real y deja `plazo_confirmado_sii = true`. Si ya venció (por la estimación o por la fecha real) `registrar-sii` responde 422 `PLAZO_VENCIDO` sin llamar al SII; el PDF del SII dice que pasados 8 días **no se pueden incorporar eventos** (tampoco ERM). Si el SII responde código 8 el plazo se cierra.

## Buzón de correo (IMAP/SMTP)

`PUT /empresas/:rut/buzon-correo` guarda host, puerto, usuario, contraseña, carpeta (`INBOX`), `carpetaProcesados` (opcional; si no, solo se marca leído), SMTP (`smtpHost`, `smtpPuerto`, `smtpSeguro`, usuario/contraseña propios o los de IMAP, `smtpRemitente`) e `intervaloSegundos` (60 a 86400, por defecto 300).

- Solo se usan `imapflow`, `mailparser` y `nodemailer`, detrás de la interfaz `FabricaCorreo` (`correo/tipos.ts`, token `FABRICA_CORREO`); `src/testing/correo-falso.ts` es el doble en memoria de las pruebas (sin red).
- **Sondeo automático** (`SondeoBuzonService`): desactivado por defecto. Se activa con `BUZON_CORREO_HABILITADO=true` (`BUZON_CORREO_TICK_SEGUNDOS`, 30 por defecto, es cada cuánto se revisa qué buzones cumplieron su intervalo). **Nunca arranca con `NODE_ENV=test`.** Cada buzón se procesa con el contexto RLS de su sola empresa.
- Por cada mensaje no leído toma los adjuntos `.xml` y los procesa igual que la subida (`origen = 'correo'`, `remitente` = `From`), responde el acuse `RecepcionEnvio` al remitente por SMTP (si hay SMTP) y marca el mensaje leído o lo mueve a `carpetaProcesados`. Si procesar un adjunto lanza un error de infraestructura (p. ej. sin certificado) el mensaje queda sin leer y se reintenta en el siguiente ciclo. Mensajes sin adjunto XML se marcan leídos.
- Varias instancias de la API sondeando el mismo buzón no duplican datos (la deduplicación por hash lo absorbe); a lo más se enviaría dos veces el acuse.

## Registro ante el SII (`src/sii-gateway/reclamo`)

Cliente SOAP `RegistroReclamoClient` (comparte el token y su caché con `DteSiiClient`; `SiiClienteFactory.paraEmpresa(...).reclamo`). Documentación oficial descargada en `docs/referencias-sii/registro-reclamo/` (PDF v1.1, WSDL de certificación y producción, XSD de la respuesta). Verificado contra el WSDL: SOAP 1.1 `rpc/literal`, namespace `http://ws.registroreclamodte.diii.sdi.sii.cl`, operaciones `ingresarAceptacionReclamoDoc`, `listarEventosHistDoc`, `consultarDocDteCedible`, `consultarFechaRecepcionSii`, `getVersion`; endpoint de certificación `https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice` (la ruta **no** es la de producción), producción `https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice`.

Mapeo de los códigos de `ingresarAceptacionReclamoDoc` (PDF): 0 OK; 1-4 datos inválidos → 422 `SII_DATOS_INVALIDOS`; 5, 6, 7, 11, 12, 13, 19 conflictos de estado → 409 `SII_REGISTRO_CONFLICTO`; 8 → 422 `PLAZO_VENCIDO`; 9, 10, 18 → 422 `SII_DOCUMENTO_NO_REGISTRADO`; 14, 17 → 422 `SII_ACCION_NO_AUTORIZADA`; otros (-1...) → 502 `SII_ERROR`. Toda acción intentada queda en `registro_sii.acciones`, con éxito o sin él.

## Supuestos no verificables contra el SII real

- **Autenticación del WS de reclamos**: el PDF solo remite al flujo semilla/token (`autenticacion.pdf`); se envía el token del flujo DTE (el del ambiente de la empresa: maullin/palena) en `Cookie: TOKEN=...`, igual que en el upload. Si el SII exigiera otro host de semilla para `ws1`/`ws2`, es un cambio local en `RegistroReclamoClient`.
- **Formato de fechas** de `consultarFechaRecepcionSii` y de `fechaEvento`: el PDF no lo especifica; se espera `dd-mm-yyyy HH:MM:SS` en hora de Chile (también se tolera `dd/mm/yyyy` e ISO, `parsearFechaRecepcionSii`). Si no se entiende, el plazo no se actualiza y el texto original queda en `registro_sii`.
- **`codResp`**: el PDF lista un "1: Acción completada OK" que choca con "1: Rut emisor erróneo"; se trata 0 como éxito y 1 solo si la descripción dice "completada".
- **Tipos**: el servicio solo cita 33, 34 y 43; el resto (46, 52, 56, 61...) responde 422 `TIPO_NO_ADMITIDO` sin llamar al SII. Tampoco existe recibo de mercaderías para el 43.
- **Quién puede registrar**: el PDF exige representante legal o usuario autorizado de la empresa receptora; si el certificado de la empresa no lo es, el SII responderá 14/17 (422 `SII_ACCION_NO_AUTORIZADA`).
- **Formato exacto de las respuestas** (espacios, `KeyInfo`) y la **entrega de las respuestas al SII en la certificación** (carga en su página o correo a una casilla) no se validaron contra el ambiente real; los XML pasan los XSD oficiales y la verificación de firma local.
- **Hora de recepción en el SII** vs. recepción propia para el plazo (ver arriba).
- **Libro de compras**: el período se toma de la **fecha de emisión**; no se aplican reglas de crédito fiscal (IVA de uso común, no recuperable, activo fijo): todo `montoIva` va como recuperable. Ajústelo informando `documentos` a mano si corresponde.
- Los sobres `EnvioBOLETA` no se intercambian entre contribuyentes; si llegara uno se guardaría como recibido pero sus DTE (boletas 39/41) no admiten reclamo.

## Probar

```
cd apps/api
npx vitest run src/recepcion src/sii-gateway/reclamo
npx vitest run --config ./vitest.config.e2e.ts test/recepcion.e2e-spec.ts   # requiere Postgres (ver src/database/README.md)
```
