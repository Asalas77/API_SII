# sii-gateway

Clientes HTTP hacia el SII de Chile. Son clases puras (sin decoradores Nest); el integrador las envuelve en un módulo. Todo se exporta desde `index.ts`.

## Endpoints cubiertos

| Cliente | Método | Endpoint |
|---|---|---|
| `BoletaApiClient` | `obtenerSemilla` | `GET {base}/boleta.electronica.semilla` |
| | `obtenerToken` | `POST {base}/boleta.electronica.token` (XML firmado, 2 líneas exactas) |
| | `enviarBoletas` | `POST {baseEnvio}/boleta.electronica.envio` (multipart, `Cookie: TOKEN=`) |
| | `consultarEstadoEnvio` | `GET {base}/boleta.electronica.envio/{rut}-{dv}-{trackid}` |
| | `consultarEstadoBoleta` | `GET {base}/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado?...` |
| `DteSiiClient` | `obtenerSemilla` | SOAP `getSeed` en `/DTEWS/CrSeed.jws` |
| | `obtenerToken` | SOAP `getToken` (`pszXml` escapado) en `/DTEWS/GetTokenFromSeed.jws` |
| | `enviarDte` | `POST /cgi_dte/UPL/DTEUpload` (multipart) |
| | `consultarEstadoEnvio` | SOAP `getEstUp` en `/DTEWS/QueryEstUp.jws` |
| | `consultarEstadoDte` | SOAP `getEstDte` en `/DTEWS/QueryEstDte.jws` |

Hosts (`ambientes.ts`): DTE `maullin.sii.cl` (certificación) / `palena.sii.cl` (producción); boleta `apicert.sii.cl` / `api.sii.cl`. El envío de boletas puede ir a los hosts temporales `pangal.sii.cl` / `rahue.sii.cl` con `usarHostEnvioAlternativo: true`.

Límite del SII: máximo 500 boletas por envío (recomendado 50). No se valida aquí; es responsabilidad del dominio. Tras un envío conviene esperar ~10 minutos antes de consultar estados.

## Inyección del firmador

```ts
const cliente = new BoletaApiClient({
  ambiente: 'certificacion',
  rutEmpresa: '76123456', dvEmpresa: '7',
  rutUsuario: '8315495', dvUsuario: '0',
  firmador, // objeto con firmarXml(xml: string, idReferencia?: string): string
});
```

`FirmadorXml` se define en `comun/firmador.ts`; la implementación real es `crearFirmadorSii({ certificadoPem, clavePrivadaPem })` de `dte-core` (`firma/firmador-sii.ts`): con `idReferencia` firma el elemento por `ID`, sin él firma el documento completo. `firma-real.spec.ts` prueba los clientes con esa firma real. Para el token se invoca `firmarXml(xml)` sin `idReferencia` (firma del documento completo, `URI=""`) y debe usar rsa-sha1, c14n 2001 y enveloped-signature. `fetchImpl` es inyectable (por defecto `globalThis.fetch`).

Los strings XML se codifican según el encoding declarado en el prólogo (ISO-8859-1 o UTF-8); un `Buffer` se envía tal cual.

## Estados de consulta DTE

`consultarEstadoEnvio` (`getEstUp`) y `consultarEstadoDte` (`getEstDte`) devuelven además `descripcionEstado` y `esFinal` (`dte/estados.ts`, exportados `clasificarEstadoEnvioDte`/`clasificarEstadoDte`). Envío: finales EPR, RPR, RCH, RCO, RCT, RFR, RSC, RPT, VOF; en curso REC, SOK, CRT, FOK, PDR/PRD. Documento: DOK, DNK, FNA, FAN, EMP, TMD, TMC, MMD, MMC, AND, ANC finales; FAU (no recibido) no es final. Códigos de error de consulta (-1 a -14, 001-003) y estados desconocidos: `esFinal: false`. Los códigos RPR/RCH/RCO/RPT/VOF/REC/PRD vienen de la API de boletas, no del PDF de QueryEstUp (que solo lista RSC, SOK, CRT, RFR, FOK, PDR, RCT, EPR).

## Caché de token

Por (tipo boleta|dte, ambiente, rutEmpresa), en memoria del proceso, TTL por defecto 50 minutos (`cacheToken: { ttlMs, almacen, ahora }`; `false` la desactiva). Las peticiones concurrentes de token se deduplican. Ante 401 (o STATUS 5 del upload, o ESTADO 001/002/003 en consultas DTE) se invalida, se renueva una sola vez y se repite la operación. El token de boletas y el de DTE son distintos y no se mezclan.

## Política de reintentos

Backoff exponencial (`reintentos: { maxIntentos = 3, esperaBaseMs = 500, factor = 2, esperar }`; `maxIntentos` cuenta el primer intento). Se reintenta HTTP 405 (límite excedido), 5xx y errores de red. No se reintenta 400, 401 (salvo la renovación de token), 404 ni otros 4xx.

## Errores (`comun/errores.ts`)

`SiiError` (base) con `SiiAutenticacionError` (401 / ESTADO ≠ 00), `SiiLimiteExcedidoError` (405), `SiiPeticionInvalidaError` (400), `SiiNoEncontradoError` (404), `SiiServidorError` (5xx), `SiiRedError` (fallo de fetch) y `SiiEnvioDteError` (STATUS ≠ 0 del upload, con `status`, `glosa`, `errores[]`).

## Supuestos no confirmados en los PDF

- Los PDF solo traen WSDL rpc/encoded; los envelopes SOAP se arman sin namespace de método (`<getEstUp>...`), tal como se pidió. Si el SII exigiera `xmlns:m` en la operación, hay que ajustarlo en `DteSiiClient.consulta`.
- `getEstUp`: se usan los nombres del WSDL (`RutCompania`, `DvCompania`, `TrackId`, `Token`) con el RUT de la empresa, en lugar de `RutConsultante/DvConsultante` mencionados en el brief. `getEstDte` usa `RutConsultante/DvConsultante` (usuario) y `RutCompania/DvCompania` (emisor).
- Además del parámetro `Token` se envía `Cookie: TOKEN=` en las consultas SOAP (el PDF indica el token en el header).
- Estados de error de consulta con códigos negativos (-3, -4, ...) se devuelven como `estado`/`glosa` sin lanzar excepción; solo 001/002/003 se tratan como token inválido.
- El STATUS 5 del upload ("no autenticado") se mapea a `SiiAutenticacionError` y dispara renovación de token.
- El upload DTE también se reintenta ante 405/5xx; un reenvío duplicado lo rechaza el SII como envío repetido.

## Pendientes

- `QueryEstDteAv` (consulta avanzada de estado).
- WS de aceptación/reclamo (`ws1/ws2.sii.cl`, REGISTRORECLAMODTE) y consulta de eventos.
- Catálogos `globales/boleta.electronica.*`.
- Respeto de las cabeceras `X-Retry-After` / `X-RateLimit-*`.
- Verificar contra certificación real (maullin / apicert) los formatos de respuesta.
