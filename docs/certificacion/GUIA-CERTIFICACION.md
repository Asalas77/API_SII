# Guía de certificación ante el SII (paso a paso)

Todo se ejecuta desde `apps/api/` con Postgres arriba y las migraciones aplicadas (`npm run migration:run`). La API corre con `npm run start:dev` (puerto 3000; los ejemplos usan `$B=http://localhost:3000/v1`). Estrategia general de pruebas: `docs/diseno/10-estrategia-de-pruebas.md`. Todas las llamadas requieren una API key: defina `API_ADMIN_KEY` en `apps/api/.env` (`openssl rand -base64 48`) y en la consola `K="Authorization: Bearer <su clave>"`. Los ejemplos `curl` usan `-H "$K"`.

## 1. Prerrequisitos en el SII (fuera de esta API)

1. Postular a emisor de factura electrónica en certificación (sii.cl, usuario administrador) y declarar el software.
2. Obtener el certificado digital del firmante (PFX) y, en el ambiente de certificación (maullin.sii.cl), descargar los **CAF de certificación** de cada tipo que se probará (33, 34, 52, 56, 61; 39 y 41 para boletas).
3. Anotar el **número y la fecha de resolución** publicados para su empresa en el ambiente de certificación (en certificación el número suele ser 0).
4. Descargar el **set de pruebas** (texto) desde el menú de certificación.

## 2. Configurar la empresa (ambiente certificación)

```bash
curl -H "$K" -X POST $B/empresas -H 'content-type: application/json' -d '{
  "rut":"76086428-5","razonSocial":"MI EMPRESA SPA","giro":"Servicios informáticos",
  "actecos":[620200],"direccion":"Av. Providencia 1234","comuna":"Providencia","ciudad":"Santiago",
  "nroResolucionSii":0,"fechaResolucionSii":"2026-01-15","ambienteSii":"certificacion"}'
```

`PATCH $B/empresas/76086428-5` corrige datos, resolución, ambiente o `proveedorSoftware: {"rut":"11111111-1"}` (boletas). La razón social, giro y dirección deben coincidir con los registrados en el SII.

## 3. Cargar certificado y CAF

```bash
curl -H "$K" -X POST $B/empresas/76086428-5/certificados -F archivo=@firmante.pfx -F password='********'
curl -H "$K" -X POST $B/empresas/76086428-5/cafs -F archivo=@FoliosSII7608642853320261119.xml   # uno por tipo
curl -H "$K" $B/empresas/76086428-5/folios
```

El PFX y su contraseña quedan cifrados (AES-256-GCM con `CERTIFICADOS_MASTER_KEY`; use una clave propia, no la de desarrollo). Si el certificado no trae el RUT del titular en el SAN, agregue `-F rutFirmante=12345678-5`. El CAF se cifra en reposo y se rechaza si su RUT no es el de la empresa. Los CAF de certificación del SII son reales (firmados por el SII): los CAF de prueba del repositorio no sirven ante el SII.

## 4. Correr el set de pruebas

Guarde el set como `set.txt` (o escríbalo en JSON, ver `apps/api/src/certificacion/README.md`).

**Simulado (siempre primero):** emite en una transacción que se revierte, no envía nada ni consume folios.

```bash
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --simular --salida ./salida-set
```

Revise las advertencias del parseo, los XML (`<caso>_T33_F1.xml`), los PDF y `EnvioDTE.xml` (se valida contra el XSD). Compare los montos con los que espera el set.

**Real:**

```bash
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt
```

Emite un DTE por caso (con `SET` / `CASO nnnn-n` como primera referencia), arma un único sobre en el orden del set y lo envía; imprime el **TRACK ID**. Repetir el comando no duplica documentos (claves `set-<atención>-<caso>`) ni reenvía los ya enviados. Si el SII acepta con reparos o rechaza un documento, corríjalo y emítalo de nuevo con otro folio (el SII rechaza folios duplicados): cambie `--clave` para forzar documentos nuevos.

## 5. Consultar estados

El SII tarda unos minutos (~10) en procesar.

```bash
curl -H "$K" $B/empresas/76086428-5/envios                 # lista con ids
curl -H "$K" -X POST $B/envios/<id-o-trackid>/consultar    # consulta al SII y actualiza envío y documentos
curl -H "$K" $B/documentos/<id>                            # estado: aceptado | aceptado_con_reparos | rechazado
```

Estados de envío finales: EPR, RPR, RCH, RCO, RFR, RSC, RCT, RPT, VOF. En boletas se obtiene el detalle por documento (reparos en `documentos.reparos`); en DTE el SII solo informa conteos por tipo, y si un tipo tiene resultados mezclados la API consulta automáticamente `getEstDte` de cada documento de ese tipo.

### Estado de cada documento

Para ver qué dice el SII de un documento en particular (`getEstDte` en DTE; estado de boleta en 39/41), solo si ya fue enviado:

```bash
curl -H "$K" -X POST $B/documentos/<id>/consultar-estado   # { documento, estadoSii, glosaSii, esFinal, descripcionEstado, advertencia? }
# Todos los documentos "enviado" de la empresa (opcional: {"documentoIds":[...],"limite":100}; máx. 200)
curl -H "$K" -X POST $B/empresas/76086428-5/documentos/consultar-estados
curl -H "$K" $B/documentos/<id>                            # incluye estadoSii, glosaSii, consultadoSiiEn
```

DOK/TMD/TMC/MMD/MMC/AND/ANC -> `aceptado`; FNA/EMP -> `rechazado`; FAN -> `anulado`; DNK (datos no coinciden) y FAU (no recibido) no cambian el estado y devuelven una `advertencia`. Un error del SII responde 502/503 sin modificar el documento. Tabla completa en `apps/api/src/documentos/README.md`. Cuando el set esté aceptado, avise en el sitio del SII ("reportar set de pruebas para revisión").

## 6. Muestras impresas

`GET $B/documentos/<id>/pdf?cedible=true` (carta, con timbre PDF417; `formato=termica80` para boletas). Genere una muestra por tipo de documento (33, 34, 52, 56, 61, 39, 41), imprímalas y envíelas según el Manual de Muestras Impresas (`docs/referencias-sii/pdf/SII_Manual_Muestras_Impresas.pdf`). Complete `nroResolucionSii` y `fechaResolucionSii` para que la leyenda sea correcta.

Configure antes la unidad del SII, el logo y (opcional) la URL de verificación; se aplican a todos los PDF de la empresa:

```bash
# Unidad del SII (se imprime "S.I.I. - SANTIAGO CENTRO"; null la borra)
curl -H "$K" -H "Content-Type: application/json" -X PATCH $B/empresas/76086428-5   -d '{"unidadSii":"Santiago Centro"}'

# URL de verificación (opcional; marcadores {id} {tipo} {folio} {rutEmisor}, http/https)
curl -H "$K" -H "Content-Type: application/json" -X PATCH $B/empresas/76086428-5   -d '{"urlVerificacion":"https://mi-dominio.cl/verificar/{rutEmisor}/{tipo}/{folio}"}'

# Logo: PNG o JPEG, máx. 300 KB (se valida por contenido, no por extensión)
curl -H "$K" -X PUT $B/empresas/76086428-5/logo -F "archivo=@logo.png"
curl -H "$K" $B/empresas/76086428-5/logo -o logo-guardado.png   # verificar
curl -H "$K" -X DELETE $B/empresas/76086428-5/logo               # quitar
```

`GET $B/empresas/76086428-5` informa `unidadSii`, `urlVerificacion` y `tieneLogo`.

## 7. Libros electrónicos del set (IEV, IEC y guías)

El SII exige, además del sobre de documentos, el **Libro de Ventas** (con los documentos del set reportado: facturas, notas de crédito y de débito) y el **Libro de Compras** (con los documentos recibidos que entrega el set de compras). Formato: `docs/referencias-sii/pdf/SII_Formato_IECV_Libros_Compra_Venta.pdf`; instrucciones: `SII_Instrucciones_Set_de_Pruebas.pdf`, secciones III y IV. En ambos la carátula es: **TipoLibro ESPECIAL, TipoEnvio TOTAL**, mismo **período tributario** que los documentos del set, y **FolioNotificacion 1 (ventas) y 2 (compras)**. Se firman con el certificado y se suben por el mismo upload de DTE (`/cgi_dte/UPL/DTEUpload`); el estado se consulta con `QueryEstUp` como un envío. Permisos de la API key: `libros.generar` y `libros.leer`.

```bash
P=2026-11                      # período de los documentos del set

# Libro de Ventas desde los documentos emitidos en el período (33, 34, 56, 61; ESPECIAL no incluye boletas)
curl -H "$K" -X POST $B/empresas/76086428-5/libros/ventas -H 'content-type: application/json'   -d "{\"periodo\":\"$P\",\"tipoLibro\":\"ESPECIAL\",\"tipoEnvio\":\"TOTAL\",\"folioNotificacion\":1}"

# Libro de Compras: los documentos del set de compras se envían en el JSON (con DTE recibidos en la base, ver sección 8: "desdeRecibidos":true)
curl -H "$K" -X POST $B/empresas/76086428-5/libros/compras -H 'content-type: application/json' -d '{
  "periodo":"2026-11","tipoLibro":"ESPECIAL","tipoEnvio":"TOTAL","folioNotificacion":2,"factorProporcionalidad":0.6,
  "documentos":[
    {"tipoDoc":30,"folio":234,"fechaDoc":"2026-11-05","rutProveedor":"96792430-K","razonSocial":"Proveedor SA","montoNeto":12000},
    {"tipoDoc":33,"folio":32,"fechaDoc":"2026-11-06","rutProveedor":"96792430-K","montoNeto":9000,"montoIva":0,"ivaUsoComun":1710},
    {"tipoDoc":33,"folio":33,"fechaDoc":"2026-11-06","rutProveedor":"96792430-K","montoNeto":5000,"montoIva":0,"ivaNoRecuperable":[{"codigo":1,"monto":950}]},
    {"tipoDoc":34,"folio":9,"fechaDoc":"2026-11-07","rutProveedor":"96792430-K","montoExento":6000},
    {"tipoDoc":60,"folio":451,"fechaDoc":"2026-11-08","rutProveedor":"96792430-K","montoNeto":1000,"tipoDocRef":30,"folioDocRef":234}]}'

# Revisar, descargar, enviar y consultar (el id sale de la respuesta de cada POST)
curl -H "$K" $B/empresas/76086428-5/libros
curl -H "$K" $B/libros/<id>/xml -o LibroVentas.xml
curl -H "$K" -X POST $B/libros/<id>/enviar                 # sube al SII; devuelve trackId
curl -H "$K" -X POST $B/libros/<id>/consultar              # QueryEstUp; actualiza estado
```

También puede enviar al generar con `"enviar": true`. Un libro ya enviado no se reenvía (409); si el envío falló (`estado: ERR`) se puede repetir con `/enviar`. En compras, `montoTotal` se calcula (neto + exento + IVA + uso común + no recuperable + otros impuestos); si lo informa y no cuadra, se rechaza (422). `montoIva` es el IVA **recuperable**: si todo el IVA es de uso común o no recuperable, informe `montoIva: 0`. Los tipos 30 y 33, etc. usan la codificación del formato (sección 4.2: 30 factura, 33 factura electrónica, 34 exenta electrónica, 60/61 notas de crédito, 55/56 notas de débito).

**Libro de guías de despacho** (no forma parte del set; solo si el SII lo solicita por notificación): `POST $B/empresas/76086428-5/libros/guias` con `{"periodo":"2026-11","folioNotificacion":<folio de la notificación>}` arma el libro con las guías (52) del período (`IndTraslado` 1 = venta, 5 = traslado interno, etc.).

**Desde la herramienta del set** (usa los documentos del set recién emitidos y el JSON de compras de `apps/api/src/certificacion/README.md`):

```bash
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --simular --libros --compras compras.json --salida ./salida-set
npm run certificacion:set -- --empresa 76086428-5 --archivo set.txt --libros --compras compras.json --enviar-libros
```

El modo simulado escribe `LibroVentas.xml` y `LibroCompras.xml` (validados contra el XSD) sin guardar nada. El modo real los guarda (consulte `GET $B/empresas/.../libros`) y con `--enviar-libros` los sube; envíelos después de que el SII haya recibido el sobre del set. Revise los datos del set de compras antes de enviar: el formato textual de ese set no está publicado y por eso se toma de un JSON.

## 8. Intercambio de información entre contribuyentes (recepción de DTE)

En esta etapa el SII le **envía** un set de DTE (un `EnvioDTE` con varios documentos, algunos con errores deliberados) y usted debe **responder**: (1) el acuse técnico `RecepcionEnvio`, (2) la aprobación o rechazo comercial `ResultadoDTE` por cada documento y (3) el `EnvioRecibos` (recibo de mercaderías, Ley 19.983). Formatos: `docs/referencias-sii/pdf/SII_Formato_Intercambio_IC.pdf` y `SII_Formato_Recibos_Ley19983.pdf`; lógica pura en `apps/api/src/intercambio/README.md`, módulo operativo en `apps/api/src/recepcion/README.md`. Permisos de la API key: `recepcion.recibir`, `recepcion.leer`, `recepcion.responder` y `recepcion.configurar`.

Requisitos: empresa con **certificado activo** (firma las respuestas) y, para recibir por correo, el correo de intercambio registrado en el SII apuntando al buzón que configure abajo (`correoIntercambio` de la empresa se informa como contacto en las respuestas).

```bash
E=76086428-5

# (a) Recibir por subida del archivo (el XML del set de intercambio que le envió el SII)
curl -H "$K" -X POST $B/empresas/$E/recepcion -F archivo=@set_intercambio.xml
#  -> 201 con el resumen por DTE (estado 0 = recibido OK; 1 firma/TED, 2 RUT emisor, 3 RUT receptor, 4 repetido, 99 otros),
#     y estadoRecepcion del envío (0, 1 schema, 2 firma, 3 RUT receptor, 91 ilegible). El mismo archivo otra vez -> 200 sin duplicar.
#     Un sobre con errores también se registra (con su código) y genera igualmente su acuse.

# (b) o por correo: configurar el buzón IMAP/SMTP y revisar ahora (el sondeo automático requiere BUZON_CORREO_HABILITADO=true)
curl -H "$K" -X PUT $B/empresas/$E/buzon-correo -H 'content-type: application/json' -d '{
  "imapHost":"imap.midominio.cl","usuario":"intercambio@midominio.cl","password":"***","carpetaProcesados":"Procesados",
  "smtpHost":"smtp.midominio.cl","smtpPuerto":587,"smtpRemitente":"intercambio@midominio.cl","intervaloSegundos":300}'
curl -H "$K" -X POST $B/empresas/$E/buzon-correo/sondear     # procesa los XML adjuntos y responde el acuse por SMTP

# Revisar lo recibido
curl -H "$K" "$B/empresas/$E/envios-recibidos"
curl -H "$K" "$B/empresas/$E/dte-recibidos?estado=pendiente"
curl -H "$K" $B/envios-recibidos/<idEnvio>/recepcion-envio -o RecepcionEnvio.xml        # (1) acuse del envío
curl -H "$K" $B/envios-recibidos/<idEnvio>/enviar-acuse -X POST -H 'content-type: application/json' -d '{"destinatario":"correo-del-emisor@x.cl"}'

# (2) Respuesta comercial de cada DTE (el id sale de dte-recibidos). Rechazar exige glosa (Ley 19.983).
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/aceptar  -H 'content-type: application/json' -d '{"enviarCorreo":true}'
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/aceptar  -H 'content-type: application/json' -d '{"reparos":true,"glosa":"Precio distinto al pactado"}'
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/rechazar -H 'content-type: application/json' -d '{"glosa":"Mercadería no solicitada","codigoRechazo":-101}'
curl -H "$K" $B/dte-recibidos/<idDte>/resultado-dte -o ResultadoDTE.xml

# (3) Recibo de mercaderías (solo 33, 34, 46, 52, 56 y 61; una sola vez; no procede si el DTE fue rechazado)
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/recibo-mercaderias -H 'content-type: application/json'   -d '{"recinto":"Bodega central, Santiago","rutFirma":"12345678-5"}'
curl -H "$K" $B/dte-recibidos/<idDte>/envio-recibos -o EnvioRecibos.xml
```

Cada respuesta se valida contra su XSD antes de guardarse (`RespuestaEnvioDTE_v10`, `EnvioRecibos_v10`) y se firma con el certificado de la empresa. Con `"enviarCorreo": true` se envía por SMTP al remitente del envío (o a `destinatario`); si el correo falla, la respuesta queda guardada y descargable y el error se informa en `correo.error`. **Cómo se entregan las respuestas al SII en la etapa de certificación** (carga en la página de certificación o correo a la casilla que indique el SII) lo define el SII en el set: descargue los XML con los comandos de arriba y entréguelos como indique; esa parte no está automatizada ni verificada aquí.

### Aceptación y reclamo ante el SII (Ley 20.956)

Además de responder al emisor, el receptor tiene **8 días corridos desde la recepción del DTE en el SII** para reclamar o acusar recibo; pasado el plazo se presume la entrega. La API lo registra en el web service `RegistroReclamoDTE` (certificación: `ws2.sii.cl/WSREGISTRORECLAMODTECERT`, producción: `ws1.sii.cl/WSREGISTRORECLAMODTE`; solo opera sobre tipos 33, 34 y 43, y el certificado debe ser del representante legal o de un usuario autorizado de la empresa receptora).

```bash
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/consultar-sii                # eventos, fecha real de recepción en el SII, cedibilidad; recalcula el plazo
curl -H "$K" -X POST $B/dte-recibidos/<idDte>/registrar-sii -H 'content-type: application/json' -d '{"accion":"ACD"}'
# ACD acepta contenido | RCD reclama contenido | ERM otorga recibo de mercaderías | RFP reclamo falta parcial | RFT reclamo falta total
```

El plazo mostrado antes de `consultar-sii` es una **estimación** (recepción propia + 8 días, `plazoConfirmadoSii: false`); `consultar-sii` lo reemplaza con la fecha real. Vencido el plazo la API responde 422 `PLAZO_VENCIDO` (también para ERM, según el PDF del SII) sin llamar al SII. Un conflicto de estado (reclamar un DTE aceptado, acusar recibo de uno reclamado, evento repetido) responde 409 `SII_REGISTRO_CONFLICTO` con la descripción del SII.

**Libro de compras desde lo recibido:** `POST $B/empresas/$E/libros/compras` con `{"periodo":"2026-11","desdeRecibidos":true}` arma el detalle con los DTE recibidos **aceptados** (con o sin reparos) cuya fecha de emisión cae en el período (las guías 52 se omiten: van en su libro). La entrada con `documentos` (sección 7) sigue funcionando; no se pueden mezclar.

## 9b. Guías de despacho con datos de traslado (Res. Ex. SII 144/2026)

El set de pruebas del SII no trae datos de transporte, así que la herramienta del set (`npm run certificacion:set`, `ejecutarSet`) emite sus guías sin bloque `traslado` **aunque `EXIGIR_TRASLADO_GUIAS=true`** (por defecto): pasa la opción interna `omitirExigenciaTraslado` al servicio de emisión, que no existe en la API HTTP. Cualquier otra guía de la empresa en certificación (las reales también se prueban aquí) sí debe traer el bloque `traslado`; sin él responde 422 `DOCUMENTO_INVALIDO` (campo `traslado`). Para las guías reales (vigentes desde el 2026-11-01) use el bloque `traslado`; `$B` y `$K` como arriba:

```bash
# Autogestionada: todos los datos (origen por defecto = dirección de la empresa)
curl -H "$K" -X POST $B/empresas/76086428-5/documentos -H 'content-type: application/json' -d '{
  "idDoc": {"tipoDte": 52, "indTraslado": 1},
  "receptor": {"rut": "12345678-5", "razonSocial": "CLIENTE LTDA", "giro": "Comercio", "direccion": "Calle Falsa 123", "comuna": "Santiago"},
  "detalle": [{"nombre": "Cemento 25 kg", "cantidad": 10, "unidad": "UN", "precioUnitario": 5000, "peso": {"valor": 250, "unidad": "KG"}}],
  "traslado": {"categoria": "autogestionado",
    "destino": {"direccion": "Los Leones 99", "comuna": "Ñuñoa", "ciudad": "Santiago"},
    "fechaSalida": "2026-11-23", "horaSalida": "09:30",
    "transportista": {"rut": "76543210-3"}, "chofer": {"rut": "11222333-9", "nombre": "Juan Pérez Soto"},
    "patente": "BCDF12", "patenteCarro": "AB1234"}}'

# Tercerizada: lo que no se conoce se informa Diferido; la guía queda trasladoPendiente=true
#   ... "traslado": {"categoria": "tercerizado", "destino": {...},
#        "diferido": ["transportista","choferRut","choferNombre","patente","fechaSalida"]}

# Listar las pendientes y complementarlas con una guía posterior que referencia a la original
curl -H "$K" "$B/empresas/76086428-5/documentos?trasladoPendiente=true"
curl -H "$K" -X POST $B/documentos/<id>/complementar-traslado -H 'content-type: application/json' -d '{
  "traslado": {"transportista": {"rut": "76543210-3"}, "chofer": {"rut": "11222333-9", "nombre": "Juan Pérez Soto"},
               "patente": "BCDF12", "fechaSalida": "2026-11-23"}}'

# Factura retirada por el comprador (sin datos de transporte)
#   ... {"idDoc": {"tipoDte": 33}, ..., "traslado": {"retiroComprador": true}}
```

`IndTraslado` 10 (GDT), 11 y 12 responden 422 mientras `PERMITIR_INDTRASLADO_RES144=false` (el XSD oficial del SII aún no los enumera; ver `apps/api/src/dte-core/README.md`). La guía reemplazada debe anularse a mano en el Registro de Guías de Despacho del sitio del SII.

## 9. Qué sigue

1. **Simulación**: el SII pide emitir documentos de un "set de simulación" con datos propios del contribuyente (mismo flujo, vía `POST /documentos` y `POST /envios`).
2. **Muestras impresas** aprobadas (sección 6).
3. **Declaración de cumplimiento** de requisitos técnicos y paso a producción: cambiar `ambienteSii` a `produccion` (exige certificado activo), cargar CAF de producción y certificado definitivo.

## 10. Antes de producción

Claves API propias por integración (no usar la clave de administración en producción), clave maestra propia y rotación, almacenamiento de XML en object storage, respaldos y monitoreo (ver `docs/diseno/08-seguridad.md` y `11-operacion-y-despliegue.md`). Verifique contra maullin/apicert los formatos de respuesta reales: los clientes se probaron solo con respuestas simuladas.
