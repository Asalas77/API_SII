# Autenticación y autorización

Los clientes de la API son máquinas (worker de SAP Business One, ERPs), así que se autentican con **API keys**, no con usuarios y contraseña.

## Credenciales

- **API key**: `sk_<test|live>_<prefijo>_<secreto>` (prefijo de 10 hex, secreto de 32 bytes en base64url). `test`/`live` sale de `SII_AMBIENTE` (`certificacion`/`produccion`) y es informativo. Se muestra completa **una sola vez**, en la respuesta de `POST /v1/api-keys`. En la tabla `api_keys` solo se guarda el prefijo (para buscarla) y el SHA-256 del secreto completo; la comparación usa `timingSafeEqual`.
- **Clave admin bootstrap**: variable opcional `API_ADMIN_KEY` (≥ 32 caracteres, ver `.env.example`). Concede todos los permisos sobre todas las empresas; sirve para crear empresas y las primeras API keys. Se compara con `timingSafeEqual`. Sin la variable, no existe.
- Se envía como `Authorization: Bearer <clave>` o `X-API-Key: <clave>`. Sin credencial o con una inválida/revocada/expirada: **401** con `WWW-Authenticate: Bearer` (mismo mensaje en todos los casos).

## Autorización

Dos guards globales (`APP_GUARD`, en este orden):

1. `AuthGuard` autentica y deja en la request un `Principal { tipo, apiKeyId?, permisos, todasLasEmpresas, empresas[] }`. `@Publico()` lo omite (`GET /`, `GET /health`).
2. `PermisosGuard` exige **todos** los permisos de `@RequierePermisos(...)` (403) y, en rutas con `:rut`, que el principal tenga acceso a esa empresa (403). **Fail-closed**: un endpoint no público sin `@RequierePermisos` se deniega, incluso al admin.

Permisos atómicos (`permisos.ts`, único lugar donde se definen; el código nunca consulta nombres de rol): `empresas.crear`, `empresas.leer`, `empresas.editar`, `certificados.gestionar`, `cafs.gestionar`, `folios.leer`, `documentos.emitir`, `documentos.leer`, `envios.crear`, `envios.leer`, `libros.generar`, `libros.leer`, `recepcion.recibir`, `recepcion.leer`, `recepcion.responder`, `recepcion.configurar`, `api_keys.gestionar`. `POST /envios/:id/consultar` pide `envios.leer`; `POST /documentos/:id/consultar-estado` y `POST /empresas/:rut/documentos/consultar-estados` piden `documentos.leer`. Libros electrónicos (IECV y guías): `libros.generar` para generar (`POST /empresas/:rut/libros/{ventas,compras,guias}`), enviar (`POST /libros/:id/enviar`); `libros.leer` para listar, leer, bajar el XML y consultar el estado (`POST /libros/:id/consultar`). Recepción de DTE de proveedores (`src/recepcion`): `recepcion.recibir` (subir un EnvioDTE, sondear el buzón), `recepcion.leer` (listar y descargar DTE y envíos recibidos, `consultar-sii`), `recepcion.responder` (aceptar, rechazar, recibo de mercaderías, `registrar-sii`, enviar acuses) y `recepcion.configurar` (buzón de correo).

## Aislamiento por empresa

Cada key tiene `todas_las_empresas` o una lista `empresas` de RUT normalizados (`76086428-5`, sin puntos ni ceros a la izquierda; se guardan así en una columna `text[]`, sin FK, porque la key puede existir antes que la empresa).

- Rutas con `:rut`: el guard responde **403** si la empresa no está entre las permitidas.
- Recursos por id (`/documentos/:id`, `/xml`, `/pdf`, `/envios/:id` por UUID o track id, `/envios/:id/consultar`): la regla vive en los servicios (`principal.ts`: `asegurarAccesoEmpresa`, `asegurarRecursoDeEmpresa`; `EmpresasService.idsPermitidos`). Si el recurso es de otra empresa se responde **404**, igual que si no existiera. Los servicios exigen el principal (o su `AccesoEmpresas`) como parámetro obligatorio.
- Una key sin `todasLasEmpresas` que crea una empresa (`empresas.crear`) recibe acceso a ella automáticamente.

## Gestión de keys (`api_keys.gestionar`)

- `POST /v1/api-keys` `{ nombre, permisos[], empresas[] | todasLasEmpresas, expiraEn? }` → 201 con `clave`.
- `GET /v1/api-keys` → prefijo, nombre, permisos, empresas, estado (`activa|revocada|expirada`), último uso. Nunca secretos ni hash.
- `DELETE /v1/api-keys/:id` → 204; revocación blanda (`activa=false`, `revocada_en`), idempotente.
- **Anti-escalada**: una key no admin solo puede crear keys con permisos y empresas que ella misma tiene (403 `ESCALADA_DE_PRIVILEGIOS`), y solo ve/revoca las keys contenidas en su alcance (otras responden 404).
- `ultimo_uso_en` se actualiza sin bloquear la petición y como mucho una vez por minuto por clave.
