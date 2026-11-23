using System;
using SapB1Addon.Core.Controladores;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.UI.Formularios
{
    /// <summary>
    /// Botones de SII agregados a los formularios de documento (133, 179, 140, 60091) y etiqueta de
    /// estado. Posiciones SUPUESTAS: fila inferior del formulario (misma altura que el botón "2"
    /// Cancelar), alineados a la derecha; si en su localización se superponen con otros botones,
    /// ajuste <see cref="Disposicion"/> o use el menú SII &gt; (misma funcionalidad).
    /// </summary>
    internal static class BotonesSii
    {
        public const string Emitir = "SII_btnEmitir";
        public const string Reenviar = "SII_btnReenviar";
        public const string Pdf = "SII_btnPdf";
        public const string Estado = "SII_btnEstado";
        public const string Validar = "SII_btnValidar";
        public const string Etiqueta = "SII_lblEstado";

        public static readonly string[] Botones = { Validar, Emitir, Reenviar, Estado, Pdf };

        private static class Disposicion
        {
            public const int AnchoBoton = 78;
            public const int Separacion = 4;
            public const int Margen = 12;
            public const int AnchoEtiqueta = 260;
            /// <summary>Item de referencia para la altura de la fila inferior (botón Cancelar de los documentos de marketing).</summary>
            public const string ItemReferencia = "2";
        }

        public static bool EsBotonSii(string? itemUid) => Array.IndexOf(Botones, itemUid) >= 0;

        public static void Agregar(SAPbouiCOM.Form form)
        {
            if (Existe(form, Emitir)) return;
            Crear(form, Validar, "SII Validar");
            Crear(form, Emitir, "SII Emitir");
            Crear(form, Reenviar, "SII Reenviar");
            Crear(form, Estado, "SII Estado");
            Crear(form, Pdf, "SII PDF");

            var et = form.Items.Add(Etiqueta, SAPbouiCOM.BoFormItemTypes.it_STATIC);
            et.Width = Disposicion.AnchoEtiqueta;
            et.AffectsFormMode = false;
            ((SAPbouiCOM.StaticText)et.Specific).Caption = "SII: sin emitir";
            Reposicionar(form);
        }

        private static bool Existe(SAPbouiCOM.Form form, string uid)
        {
            try
            {
                return form.Items.Item(uid) != null;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void Crear(SAPbouiCOM.Form form, string uid, string titulo)
        {
            var item = form.Items.Add(uid, SAPbouiCOM.BoFormItemTypes.it_BUTTON);
            item.Width = Disposicion.AnchoBoton;
            item.AffectsFormMode = false; // pulsar no pone el documento en modo "Actualizar"
            ((SAPbouiCOM.Button)item.Specific).Caption = titulo;
        }

        /// <summary>Alinea botones y etiqueta a la derecha de la fila inferior (también al redimensionar).</summary>
        public static void Reposicionar(SAPbouiCOM.Form form)
        {
            var referencia = form.Items.Item(Disposicion.ItemReferencia);
            int top = referencia.Top;
            int alto = referencia.Height;
            int total = Botones.Length * (Disposicion.AnchoBoton + Disposicion.Separacion);
            int left = form.ClientWidth - total - Disposicion.Margen;
            foreach (var uid in Botones)
            {
                var it = form.Items.Item(uid);
                it.Top = top;
                it.Height = alto;
                it.Left = left;
                left += Disposicion.AnchoBoton + Disposicion.Separacion;
            }
            var et = form.Items.Item(Etiqueta);
            et.Top = top + 2;
            et.Height = alto;
            et.Left = Math.Max(0, form.ClientWidth - total - Disposicion.Margen - Disposicion.AnchoEtiqueta - 8);
        }

        /// <summary>Habilita/deshabilita los botones según el estado y actualiza la etiqueta.</summary>
        public static void Refrescar(SAPbouiCOM.Form form, CabeceraDocumento c)
        {
            var d = Disponibilidad.De(c);
            form.Items.Item(Validar).Enabled = d.Validar;
            form.Items.Item(Emitir).Enabled = d.Emitir;
            form.Items.Item(Reenviar).Enabled = d.Reenviar;
            form.Items.Item(Estado).Enabled = d.ConsultarEstado;
            form.Items.Item(Pdf).Enabled = d.VerPdf;

            string texto;
            var estado = (c.SiiEstado ?? "").Trim();
            if (string.IsNullOrEmpty(estado)) texto = "SII: sin emitir";
            else
            {
                texto = "SII: " + estado;
                if (c.SiiFolio.HasValue) texto += "  Folio " + c.SiiFolio.Value;
                if (estado == EstadoSii.Error && !string.IsNullOrWhiteSpace(c.SiiGlosa))
                {
                    var g = c.SiiGlosa!.Replace("\r", " ").Replace("\n", " ").Trim();
                    texto += "  " + (g.Length > 40 ? g.Substring(0, 37) + "..." : g);
                }
            }
            ((SAPbouiCOM.StaticText)form.Items.Item(Etiqueta).Specific).Caption = texto;
        }
    }
}
