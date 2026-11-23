using System;
using System.Collections.Generic;
using System.Linq;
using SapB1Addon.Core;
using SapB1Addon.Core.Controladores;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.UI.Formularios
{
    /// <summary>
    /// Formulario simple "SII &gt; Configuración": URL de la API, RUT emisor, API key y opciones.
    /// La API key se muestra enmascarada, no se rellena nunca con el valor guardado y se persiste
    /// cifrada con DPAPI (ver <c>AlmacenConfiguracionDpapi</c>).
    /// </summary>
    internal sealed class FormularioConfiguracion
    {
        public const string Uid = "SII_CFG";
        public const string BotonGuardar = "SII_cfgGuardar";
        public const string BotonCerrar = "SII_cfgCerrar";

        private const string DsUrl = "dsUrl", DsRut = "dsRut", DsClave = "dsClave", DsEnviar = "dsEnviar", DsAdjuntar = "dsAdjuntar", DsAuto = "dsAuto", DsExentos = "dsExentos", DsContado = "dsContado";

        private readonly SAPbouiCOM.Application _app;
        private readonly IAlmacenConfiguracion _almacen;
        private readonly IMensajes _mensajes;

        public FormularioConfiguracion(SAPbouiCOM.Application app, IAlmacenConfiguracion almacen, IMensajes mensajes)
        {
            _app = app;
            _almacen = almacen;
            _mensajes = mensajes;
        }

        public void Abrir()
        {
            try
            {
                var existente = _app.Forms.Item(Uid);
                existente.Select();
                return;
            }
            catch (Exception)
            {
                // no está abierto: se crea
            }

            var cp = (SAPbouiCOM.FormCreationParams)_app.CreateObject(SAPbouiCOM.BoCreatableObjectType.cot_FormCreationParams);
            cp.BorderStyle = SAPbouiCOM.BoFormBorderStyle.fbs_Fixed;
            cp.UniqueID = Uid;
            cp.FormType = Uid;
            var form = _app.Forms.AddEx(cp);
            form.Title = "SII - Configuración";
            form.Left = 350;
            form.Top = 120;
            form.ClientWidth = 470;
            form.ClientHeight = 270;

            var c = _almacen.Cargar();
            int y = 15;
            Fila(form, "URL de la API", DsUrl, 254, y, c.ApiUrl, false); y += 24;
            Fila(form, "RUT emisor", DsRut, 12, y, c.RutEmpresa, false); y += 24;
            Fila(form, "API key", DsClave, 254, y, "", true);
            Texto(form, "lblClave", string.IsNullOrEmpty(c.ApiKey) ? "(obligatoria)" : "(guardada: deje vacío para conservarla)", 130, y + 18, 320);
            y += 42;
            Fila(form, "Códigos exentos", DsExentos, 100, y, string.Join(",", c.CodigosExentos), false); y += 24;
            Fila(form, "Grupos pago contado", DsContado, 100, y, string.Join(",", c.GruposPagoContado), false); y += 28;
            Casilla(form, "chkEnviar", "Enviar al SII al emitir", DsEnviar, y, c.EnviarAlEmitir); y += 20;
            Casilla(form, "chkAdjuntar", "Adjuntar el PDF al documento", DsAdjuntar, y, c.AdjuntarPdf); y += 20;
            Casilla(form, "chkAuto", "Emitir al agregar (documentos PENDIENTE)", DsAuto, y, c.EmitirAlAgregar); y += 30;

            Boton(form, BotonGuardar, "Guardar", 130, y);
            Boton(form, BotonCerrar, "Cerrar", 220, y);
            form.Visible = true;
        }

        /// <summary>Atiende los botones del formulario; devuelve true si el evento era suyo.</summary>
        public bool ManejarClic(string formUid, string itemUid)
        {
            if (formUid != Uid) return false;
            var form = _app.Forms.Item(Uid);
            if (itemUid == BotonCerrar)
            {
                form.Close();
                return true;
            }
            if (itemUid != BotonGuardar) return false;

            var actual = _almacen.Cargar();
            var nueva = new ConfiguracionAddon
            {
                ApiUrl = Leer(form, DsUrl).Trim(),
                RutEmpresa = Leer(form, DsRut).Trim(),
                ApiKey = Leer(form, DsClave).Trim(),
                CodigosExentos = Separar(Leer(form, DsExentos)),
                GruposPagoContado = Separar(Leer(form, DsContado)).Select(x => int.TryParse(x, out var n) ? (int?)n : null).Where(n => n.HasValue).Select(n => n!.Value).ToList(),
                EnviarAlEmitir = Leer(form, DsEnviar) == "Y",
                AdjuntarPdf = Leer(form, DsAdjuntar) == "Y",
                EmitirAlAgregar = Leer(form, DsAuto) == "Y",
                ExigirDatosReceptor = actual.ExigirDatosReceptor,
                TimeoutSegundos = actual.TimeoutSegundos,
            };
            if (nueva.ApiKey.Length == 0) nueva.ApiKey = actual.ApiKey; // vacío = conservar la guardada
            var errores = VerificadorConfiguracion.Errores(nueva);
            if (errores.Count > 0)
            {
                _mensajes.Aviso("SII - Configuración", "No se guardó:\n" + string.Join("\n", errores.Select(e => "- " + e)));
                return true;
            }
            _almacen.Guardar(nueva);
            _mensajes.Estado("SII - Configuración guardada (la API key quedó cifrada en su perfil de Windows).", NivelMensaje.Exito);
            form.Close();
            return true;
        }

        private static List<string> Separar(string texto) =>
            texto.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

        private static string Leer(SAPbouiCOM.Form form, string ds) => form.DataSources.UserDataSources.Item(ds).Value ?? "";

        private static void Texto(SAPbouiCOM.Form form, string uid, string texto, int left, int top, int ancho)
        {
            var it = form.Items.Add(uid, SAPbouiCOM.BoFormItemTypes.it_STATIC);
            it.Left = left;
            it.Top = top;
            it.Width = ancho;
            ((SAPbouiCOM.StaticText)it.Specific).Caption = texto;
        }

        private static void Fila(SAPbouiCOM.Form form, string etiqueta, string ds, int largo, int top, string valor, bool clave)
        {
            Texto(form, "lbl" + ds, etiqueta, 10, top, 115);
            form.DataSources.UserDataSources.Add(ds, SAPbouiCOM.BoDataType.dt_LONG_TEXT, largo);
            var it = form.Items.Add("ed" + ds, SAPbouiCOM.BoFormItemTypes.it_EDIT);
            it.Left = 130;
            it.Top = top;
            it.Width = 320;
            var ed = (SAPbouiCOM.EditText)it.Specific;
            ed.DataBind.SetBound(true, "", ds);
            if (clave) ed.IsPassword = true;
            form.DataSources.UserDataSources.Item(ds).Value = valor;
        }

        private static void Casilla(SAPbouiCOM.Form form, string uid, string titulo, string ds, int top, bool valor)
        {
            form.DataSources.UserDataSources.Add(ds, SAPbouiCOM.BoDataType.dt_SHORT_TEXT, 1);
            var it = form.Items.Add(uid, SAPbouiCOM.BoFormItemTypes.it_CHECK_BOX);
            it.Left = 130;
            it.Top = top;
            it.Width = 320;
            var chk = (SAPbouiCOM.CheckBox)it.Specific;
            chk.Caption = titulo;
            chk.ValOn = "Y";
            chk.ValOff = "N";
            chk.DataBind.SetBound(true, "", ds);
            form.DataSources.UserDataSources.Item(ds).Value = valor ? "Y" : "N";
        }

        private static void Boton(SAPbouiCOM.Form form, string uid, string titulo, int left, int top)
        {
            var it = form.Items.Add(uid, SAPbouiCOM.BoFormItemTypes.it_BUTTON);
            it.Left = left;
            it.Top = top;
            it.Width = 80;
            ((SAPbouiCOM.Button)it.Specific).Caption = titulo;
        }
    }
}
