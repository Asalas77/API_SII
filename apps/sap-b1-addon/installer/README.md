# Instalación del add-on SII en SAP Business One 10.0

Este directorio solo contiene instrucciones: **no hay binarios ni `.ard` generados** (el `.ard` depende de la versión de B1 de cada cliente y se genera con la herramienta del SDK). Todo lo de aquí está escrito sin acceso a un B1 real: los nombres de pantallas y campos de las herramientas de SAP pueden variar según el parche (PL/FP); verifique cada paso en un ambiente de prueba antes de producción.

## 1. Compilar el add-on

Necesita el SDK de B1 instalado (carpeta con `Interop.SAPbouiCOM.dll` e `Interop.SAPbobsCOM.dll`) y .NET Framework 4.8 (o el targeting pack vía NuGet, que el proyecto trae).

```powershell
cd apps\sap-b1-addon
dotnet build SapB1Addon.sln -c Release -p:SapB1SdkDir="C:\Program Files\SAP\SAP Business One SDK\Lib"
```

Salida: `src\SapB1Addon.UI\bin\Release\net48\` con `SapB1Addon.exe`, `SapB1Addon.Core.dll`, `System.Text.Json.dll` y sus dependencias (`System.Memory`, `System.Buffers`, `System.Runtime.CompilerServices.Unsafe`, `System.Text.Encodings.Web`, `System.Threading.Tasks.Extensions`, `Microsoft.Bcl.AsyncInterfaces`, `System.ValueTuple`, etc.) y las DLL de interop. **Plataforma x64**: B1 10.0 es de 64 bits.

Para la distribución, copie **toda** esa carpeta (no solo el `.exe`) a un directorio de instalación, por ejemplo `C:\Program Files\SII\SapB1Addon\` en cada puesto, o a un recurso compartido de red que Extension Manager use como origen.

## 2. Generar el `.ard` con AddOnRegDataGen

`AddOnRegDataGen.exe` viene con el SDK (típicamente `C:\Program Files\SAP\SAP Business One SDK\Tools\AddOnRegDataGen\`). Use **la versión que acompaña a la versión de B1 del cliente**: un `.ard` generado con una herramienta de otra versión puede ser rechazado.

Datos a cargar (los nombres de campos son aproximados):

| Campo | Valor |
|---|---|
| Add-on name | `SII - Facturacion electronica` |
| Partner namespace | un identificador propio del partner, p. ej. `SII.DTE` *(único; no lo reutilice entre add-ons)* |
| Add-on version | la de `AssemblyVersion` del proyecto |
| Platform | **x64 / 64-bit** *(marque la casilla de 64 bits)* |
| Client | Windows Desktop client |
| Add-on executable (EXE) | `SapB1Addon.exe` |
| Installer / ruta de origen | carpeta de instalación del punto 1 (el EXE y sus DLL) |
| Argumentos de línea de comandos | ninguno: B1 pasa la cadena de conexión de la UI API como primer argumento |
| Startup / Auto-start | automático al iniciar sesión (`Auto-start`/`Always`) una vez probado |
| Compatibilidad de versión B1 | `10.0` y el rango de FP/PL que haya validado |
| Compatibilidad de BD | marque MSSQL y/o HANA según el cliente (el add-on no usa SQL específico de motor, salvo una consulta de solo lectura con identificadores entre comillas dobles) |

Guarde el archivo como `SapB1Addon.ard`. **No lo versione en git** (está en `.gitignore`): se genera por cliente y versión.

## 3. Despliegue con Extension Manager (B1 10.0)

1. Inicie sesión en B1 (cliente de escritorio) con un usuario con autorización de administración de add-ons.
2. *Administración > Add-ons > Extension Manager* (en 10.0, *Administración > Gestión de extensiones*). Pestaña *Add-ons disponibles/Registrar*.
3. **Registrar**: cargue el `.ard`. B1 copia el origen y registra el add-on para la company o para todas (decida: la configuración del add-on se guarda **por company y por usuario de Windows**).
4. **Asignar** el add-on a las companies y a los puestos/usuarios que corresponda y marque *Instalar* (sólo la primera vez en cada puesto: B1 descarga la carpeta al directorio local de add-ons).
5. Reinicie el cliente o pulse *Iniciar*. En el menú *Módulos* debe aparecer **SII**.
6. Cada usuario de Windows que emita debe abrir *Módulos > SII > Configuración* una vez: URL de la API, RUT emisor y API key. La clave se cifra con DPAPI para ese usuario de Windows en ese equipo (si cambia de equipo o de usuario de Windows hay que volver a ingresarla).

Desinstalar: Extension Manager > *Desinstalar*. Los datos de configuración quedan en `%APPDATA%\SapB1Addon\` y se borran a mano.

## 4. Requisitos previos en la company

- Los UDF `U_SII_*` deben existir: se crean con el worker (`cd apps/sap-b1-worker && npm run instalar-udfs`), que es idempotente. El add-on **no crea UDF**; si falta alguno lo informa en la barra de estado al escribirlo.
- Carpeta de anexos configurada en B1 (*Administración > Inicialización del sistema > Configuración general > Rutas*) si se quiere adjuntar el PDF.
- API de DTE accesible por HTTPS desde cada puesto y una API key con los permisos `documentos.emitir`, `documentos.leer`, `envios.crear` y `envios.leer`, limitada al RUT de la company (ver `apps/api/src/auth/README.md`).
- Si la API usa una CA propia, instale esa CA en el almacén de certificados de Windows de cada puesto (el add-on no desactiva nunca la verificación TLS).

## 5. Depuración durante el desarrollo

Sin `.ard`: abra el cliente B1, abra `SapB1Addon.sln` en Visual Studio (como administrador si B1 corre elevado), defina `SapB1SdkDir` (variable de entorno `SAPB1_SDK_DIR` antes de abrir VS, o en `Directory.Build.props` local) y pulse F5 sobre `SapB1Addon.UI`: con el depurador adjunto y sin argumentos se usa la cadena de conexión de desarrollo del SDK. Detalle en el README del add-on.
