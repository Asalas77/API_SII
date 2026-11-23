using System;
using System.Diagnostics;
using SapB1Addon.Core;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>StatusBar y MessageBox de B1.</summary>
    internal sealed class MensajesB1 : IMensajes
    {
        private readonly SAPbouiCOM.Application _app;

        public MensajesB1(SAPbouiCOM.Application app)
        {
            _app = app;
        }

        public void Estado(string texto, NivelMensaje nivel)
        {
            try
            {
                var limpio = (texto ?? "").Replace("\r", " ").Replace("\n", " ");
                if (limpio.Length > 200) limpio = limpio.Substring(0, 197) + "...";
                SAPbouiCOM.BoStatusBarMessageType tipo;
                switch (nivel)
                {
                    case NivelMensaje.Exito: tipo = SAPbouiCOM.BoStatusBarMessageType.smt_Success; break;
                    case NivelMensaje.Advertencia: tipo = SAPbouiCOM.BoStatusBarMessageType.smt_Warning; break;
                    case NivelMensaje.Error: tipo = SAPbouiCOM.BoStatusBarMessageType.smt_Error; break;
                    default: tipo = SAPbouiCOM.BoStatusBarMessageType.smt_None; break;
                }
                _app.StatusBar.SetText(limpio, SAPbouiCOM.BoMessageTime.bmt_Short, tipo);
            }
            catch (Exception e)
            {
                Trace.TraceWarning("StatusBar.SetText falló: " + e.Message);
            }
        }

        public void Aviso(string titulo, string texto)
        {
            try
            {
                var cuerpo = string.IsNullOrEmpty(titulo) ? texto : titulo + "\n\n" + texto;
                // MessageBox de B1 (modal dentro del cliente). Máximo ~ 500 caracteres cómodos.
                if (cuerpo.Length > 1500) cuerpo = cuerpo.Substring(0, 1497) + "...";
                _app.MessageBox(cuerpo, 1, "Aceptar", "", "");
            }
            catch (Exception e)
            {
                Trace.TraceWarning("MessageBox falló: " + e.Message);
            }
        }
    }

    internal sealed class AbridorArchivosWindows : IAbridorArchivos
    {
        public void Abrir(string ruta)
        {
            // UseShellExecute abre el PDF con la aplicación asociada del usuario.
            Process.Start(new ProcessStartInfo(ruta) { UseShellExecute = true });
        }
    }
}
