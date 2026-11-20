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

Estados de envío finales: EPR, RPR, RCH, RCO, RFR, RSC, RCT, RPT, VOF. En boletas se obtiene el detalle por documento (reparos en `documentos.reparos`); en DTE el SII solo informa conteos por tipo (un resultado mixto queda `enviado`: revíselo en el portal de certificación). Cuando el set esté aceptado, avise en el sitio del SII ("reportar set de pruebas para revisión").

## 6. Muestras impresas

`GET $B/documentos/<id>/pdf?cedible=true` (carta, con timbre PDF417; `formato=termica80` para boletas). Genere una muestra por tipo de documento (33, 34, 52, 56, 61, 39, 41), imprímalas y envíelas según el Manual de Muestras Impresas (`docs/referencias-sii/pdf/SII_Manual_Muestras_Impresas.pdf`). Complete `nroResolucionSii` y `fechaResolucionSii` para que la leyenda sea correcta.

## 7. Qué sigue

1. **Libros IEV/IECV** del set (ventas y compras): pendiente de implementar.
2. **Simulación**: el SII pide emitir documentos de un "set de simulación" con datos propios del contribuyente (mismo flujo, vía `POST /documentos` y `POST /envios`).
3. **Intercambio entre contribuyentes** (`src/intercambio`: recepción, acuse/recibos, respuestas) y **muestras impresas** aprobadas.
4. **Declaración de cumplimiento** de requisitos técnicos y paso a producción: cambiar `ambienteSii` a `produccion` (exige certificado activo), cargar CAF de producción y certificado definitivo.

## 8. Antes de producción

Claves API propias por integración (no usar la clave de administración en producción), clave maestra propia y rotación, almacenamiento de XML en object storage, RLS multiempresa, respaldos y monitoreo (ver `docs/diseno/08-seguridad.md` y `11-operacion-y-despliegue.md`). Verifique contra maullin/apicert los formatos de respuesta reales: los clientes se probaron solo con respuestas simuladas.
