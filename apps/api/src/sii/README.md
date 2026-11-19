# sii

`SiiModule` conecta `sii-gateway` con los datos de cada empresa.

- `SiiClienteFactory.certificadoActivo(empresaId)`: descifra el PFX y su contraseña (`CifradoService`), lo abre con `cargarPfx`; 422 `CERTIFICADO_INVALIDO` si no hay certificado activo o está vencido.
- `SiiClienteFactory.paraEmpresa(empresa, ambiente?)`: `{ boleta: BoletaApiClient, dte: DteSiiClient, certificado }` con `crearFirmadorSii`, el ambiente `empresas.ambiente_sii` (o el indicado, p. ej. el del envío que se consulta) y el RUT del firmante como usuario.
- Token `SII_FETCH`: el `fetch` que usan los clientes (por defecto `globalThis.fetch`). En pruebas se sustituye con `.overrideProvider(SII_FETCH).useValue(...)`; `src/testing/sii-simulado.ts` imita los endpoints del SII.

Los clientes se crean por llamada (el PFX no se mantiene en memoria); la caché de tokens del gateway es del proceso.
