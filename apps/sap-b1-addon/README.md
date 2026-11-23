# sap-b1-addon

Add-on delgado (**fase 2**) para SAP Business One 10.0 (cliente de escritorio, x64) en C#: botones y validaciones dentro de B1 que llaman a la misma API `/v1` que el worker (`apps/sap-b1-worker`). Diseño: [`docs/diseno/14-integracion-sap-b1.md`](../../docs/diseno/14-integracion-sap-b1.md).

**Estado: implementado en código, sin compilar ni probar contra un B1 real.** El núcleo (`SapB1Addon.Core`) sí compila y está probado con fakes (115+ pruebas). La capa SAP (`SapB1Addon.UI`) se escribió sin el SDK de SAP en la máquina: nunca se compiló contra `Interop.SAPbouiCOM`/`Interop.SAPbobsCOM`.

## Arquitectura

| Proyecto | Destino | Contenido |
|---|---|---|
| `src/SapB1Addon.Core` | netstandard2.0, sin referencias a SAP | Modelos, RUT, mapeo documento → cuerpo de emisión (port 1:1 de `mapeador.ts`), validador, cliente HTTP de la API, traducción de estados, controladores (Emitir, Reenviar, Ver PDF, Consultar estado, Validar) escritos contra puertos: `IDocumentoB1`, `IEscritorUdf`, `IMensajes`, `IAbridorArchivos`, `IAdjuntadorPdf`, `IAlmacenConfiguracion` |
| `src/SapB1Addon.UI` | net48, x64, exe | Adaptadores reales: UI API (eventos, menú, botones, formulario de configuración), DI API (lectura de documentos, escritura de UDF, adjuntos), DPAPI para la API key |
| `tests/SapB1Addon.Core.Tests` | net11.0, xUnit | Fakes de los puertos y una API `/v1` simulada con `HttpMessageHandler` |

Las llamadas HTTP son síncronas hacia el hilo de B1 (se ejecutan en el pool y se espera el resultado), de modo que toda la DI API se usa en el hilo de la UI. Durante la llamada el cliente B1 queda bloqueado hasta la respuesta o el timeout (30 s por defecto).

## Compatibilidad con el worker

Mismos UDF `U_SII_*`, mismos estados (`PENDIENTE`, `ENVIANDO`, `EMITIDO`, `ENVIADO`, `ACEPTADO`, `REPAROS`, `RECHAZADO`, `ERROR`), misma clave de idempotencia `b1:{rutEmpresa}:{objType}:{DocEntry}` y mismas reglas de mapeo (si difieren, manda el worker). Diferencias deliberadas:

- Validación más estricta antes de emitir: facturas 33/34 exigen giro, dirección y comuna del receptor (`ExigirDatosReceptor`, desactivable; el worker solo advierte).
- `Emitir` escribe `ENVIANDO` + `U_SII_IdemKey` antes de llamar a la API, así el worker no toma el documento si estaba `PENDIENTE`. Si queda `ENVIANDO` por un fallo transitorio, el reintento (del add-on o de la conciliación del worker) usa la misma clave: nunca hay folio doble.
- Un documento con folio o en estado `EMITIDO`/`ENVIADO`/`ACEPTADO`/`REPAROS`/`RECHAZADO` **no se reemite** (botón deshabilitado y error claro); se corrige con una nota de crédito/débito.
- El envío al SII es opcional en el add-on (`EnviarAlEmitir`); si el worker corre con `ENVIAR_AUTOMATICAMENTE=true` puede dejarse desactivado y el worker envía y da seguimiento. Si ambos envían, la API responde 409 y el add-on sincroniza el estado.

El worker sigue siendo el respaldo y la conciliación: documentos `PENDIENTE` o `ENVIANDO` que el usuario no emitió con el add-on los toma el worker.

## Qué hace en B1

- Botones en los formularios de documento: **SII Validar / Emitir / Reenviar / Estado / PDF**, y una etiqueta con estado y folio. Misma funcionalidad en el menú *Módulos > SII*.
- `FormDataEvent ADD` (BeforeAction): valida y bloquea el "Agregar" con `BubbleEvent = false` **solo** si el documento está marcado para el SII (`U_SII_Estado = PENDIENTE` o `U_SII_TipoDTE` informado). Un fallo técnico al leer el formulario no bloquea.
- Opcional `EmitirAlAgregar`: tras agregar un documento `PENDIENTE` lo emite solo.
- *SII > Configuración*: URL de la API, RUT emisor, API key, códigos exentos, grupos de pago contado y opciones.

## Requisitos

- SAP Business One 10.0 x64, cliente de escritorio (MSSQL o HANA). SDK de B1 (carpeta `Lib` con `Interop.SAPbouiCOM.dll` e `Interop.SAPbobsCOM.dll`).
- UDF instalados con el worker: `cd apps/sap-b1-worker && npm run instalar-udfs` (idempotente). **El add-on no crea UDF.**
- Permisos del usuario de B1: leer facturas, notas de crédito, entregas y socios; actualizar esos documentos (campos de usuario); crear anexos si se adjunta el PDF.
- API key con `documentos.emitir`, `documentos.leer`, `envios.crear`, `envios.leer`, limitada a la empresa.

## Compilar y probar

Sin el SDK de SAP (cualquier máquina con .NET SDK):

```powershell
cd apps\sap-b1-addon
dotnet build SapB1Addon.sln     # SapB1Addon.UI se omite con un mensaje
dotnet test  SapB1Addon.sln
```

Con el SDK (compila también la capa SAP):

```powershell
dotnet build SapB1Addon.sln -c Release -p:SapB1SdkDir="C:\Program Files\SAP\SAP Business One SDK\Lib"
```

(o defina la variable de entorno `SAPB1_SDK_DIR`). Si `SapB1SdkDir` no está definida, `SapB1Addon.UI` queda como biblioteca vacía y emite un aviso. Despliegue: [`installer/README.md`](installer/README.md).

## Depurar

1. Abra el cliente B1 e inicie sesión.
2. Abra la solución en Visual Studio con `SAPB1_SDK_DIR` definida y ponga `SapB1Addon.UI` como proyecto de inicio (x64). Con el depurador adjunto y sin argumentos usa la cadena de conexión de desarrollo; también acepta `SAPB1_ADDON_CONNECTION`.
3. Alternativa: con el add-on ya lanzado por Extension Manager, *Depurar > Asociar al proceso* `SapB1Addon.exe`.

## Seguridad

- La API key se guarda cifrada con DPAPI (`ProtectedData`, ámbito usuario actual, entropía propia) en `%APPDATA%\SapB1Addon\apikey.<company>.bin`. Nunca en texto plano, ni en una tabla de B1, ni en el JSON de configuración (la propiedad es `[JsonIgnore]`).
- La clave solo viaja en `Authorization: Bearer`. Mensajes, glosas, logs y excepciones pasan por un redactor que la sustituye por `***` (hay pruebas para ello).
- TLS: verificación estándar de Windows; no existe opción para saltársela (CA propia: instalarla en el almacén de Windows).
- El PDF se guarda con nombre generado por el add-on (`DTE_{tipo}_{folio}.pdf`) en `%TEMP%\SapB1Addon`, nunca con el nombre que sugiera el servidor.
- Los handlers capturan todas las excepciones para no tumbar B1; las consultas SQL de solo lectura usan únicamente enteros.

## Supuestos no verificables sin un B1 real

- Tipos de formulario: 133 factura de deudores, 179 nota de crédito, 140 entrega, 60091 factura de reserva (ObjType 13). 65300 (anticipo, ObjType 203) no se habilita.
- Matriz de líneas con UID `"38"`; campos de línea de DBDataSource (`PriceBefDi`, `PriceAfVAT`, `DiscPrcnt`, `VatGroup`, `VatPrcnt`, `unitMsr`, `FreeTxt`, `BaseType`, `BaseEntry`), fechas `yyyyMMdd`.
- Botones: fila inferior alineada a la derecha usando el item `"2"` como referencia de altura; pueden superponerse con otros botones según la localización (constantes en `BotonesSii.Disposicion`; el menú SII es la alternativa).
- Menú *Módulos* UID `"43520"`; menú *Actualizar* `"1304"` para refrescar el formulario tras escribir UDF.
- Firmas de eventos (`ItemEvent`, `MenuEvent`, `FormDataEvent` con `out bool BubbleEvent`), `et_FORM_DATA_ADD` con `BusinessObjectInfo.Type` = ObjType y `ObjectKey` con `<DocEntry>`.
- DI API: `FederalTaxID` como RUT, `County` como comuna, `Attachments2` con carpeta de anexos configurada, UDF en documentos cerrados puede fallar.
- Cadena de conexión de desarrollo del SDK (en `Programa.cs`).
- `Extension Manager`/`AddOnRegDataGen`: nombres de campos aproximados.
