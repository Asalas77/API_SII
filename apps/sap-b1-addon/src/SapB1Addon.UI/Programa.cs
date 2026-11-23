using System;
using System.Diagnostics;
using System.Windows.Forms;

namespace SapB1Addon.UI
{
    /// <summary>
    /// Punto de entrada del add-on. B1 lo lanza como proceso externo y le pasa la cadena de conexión de
    /// la UI API en <c>args[0]</c> (Extension Manager / .ard). Para depurar desde Visual Studio sin
    /// ese argumento se usa la variable de entorno <c>SAPB1_ADDON_CONNECTION</c> o, como último recurso,
    /// la cadena de desarrollo del SDK (ver <see cref="CadenaDesarrollo"/>).
    /// </summary>
    internal static class Programa
    {
        /// <summary>
        /// Cadena de conexión de desarrollo que usan los ejemplos del SDK de B1 cuando el add-on se ejecuta
        /// desde el IDE: conecta con el cliente B1 abierto en la misma sesión de Windows. SUPUESTO: valor
        /// tomado de la documentación/ejemplos del SDK (no verificado aquí); en producción nunca se usa.
        /// </summary>
        private const string CadenaDesarrollo =
            "0030002C0030002C00530041005000420044005F00440061007400650076002C0050004C006F006D0056004900490056";

        [STAThread]
        private static int Main(string[] args)
        {
            Trace.Listeners.Add(new DefaultTraceListener());
            SAPbouiCOM.Application app;
            try
            {
                var cadena = args.Length > 0 && !string.IsNullOrWhiteSpace(args[0])
                    ? args[0]
                    : Environment.GetEnvironmentVariable("SAPB1_ADDON_CONNECTION");
                if (string.IsNullOrWhiteSpace(cadena))
                {
                    if (!Debugger.IsAttached)
                    {
                        MessageBox.Show("Este add-on debe ser lanzado por SAP Business One (Extension Manager).", "Add-on SII", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return 2;
                    }
                    cadena = CadenaDesarrollo;
                }
                var gui = new SAPbouiCOM.SboGuiApi();
                gui.Connect(cadena);
                app = gui.GetApplication(-1);
            }
            catch (Exception e)
            {
                Trace.TraceError("No se pudo conectar con la UI API: " + e);
                MessageBox.Show("No se pudo conectar con SAP Business One: " + e.Message, "Add-on SII", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            Aplicacion aplicacion;
            try
            {
                aplicacion = new Aplicacion(app);
                aplicacion.Iniciar();
            }
            catch (Exception e)
            {
                Trace.TraceError("Error al iniciar el add-on: " + e);
                try
                {
                    app.StatusBar.SetText("Add-on SII: error al iniciar: " + e.Message, SAPbouiCOM.BoMessageTime.bmt_Short, SAPbouiCOM.BoStatusBarMessageType.smt_Error);
                }
                catch (Exception)
                {
                    // sin barra de estado
                }
                return 1;
            }

            // Bucle de mensajes: mantiene vivo el proceso y entrega los eventos COM de B1 hasta Salir().
            Application.Run();
            aplicacion.Dispose();
            return 0;
        }
    }
}
