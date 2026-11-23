using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using SapB1Addon.Core;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Controladores;
using SapB1Addon.Core.Modelos;
using SapB1Addon.UI.Adaptadores;
using SapB1Addon.UI.Formularios;

namespace SapB1Addon.UI
{
    /// <summary>
    /// Cableado del add-on: eventos de la UI API (ItemEvent, FormDataEvent, MenuEvent, AppEvent),
    /// menú SII y creación de los controladores del núcleo con los adaptadores reales.
    /// Todo handler captura sus excepciones: una excepción no controlada en un evento puede tumbar el cliente B1.
    /// </summary>
    internal sealed class Aplicacion : IDisposable
    {
        private const string MenuRaiz = "SII_MENU";
        private const string MenuModulos = "43520"; // menú "Módulos" de B1 (SUPUESTO: UID estándar)
        private const string MenuEmitir = "SII_MNU_EMITIR";
        private const string MenuReenviar = "SII_MNU_REENVIAR";
        private const string MenuPdf = "SII_MNU_PDF";
        private const string MenuEstado = "SII_MNU_ESTADO";
        private const string MenuValidar = "SII_MNU_VALIDAR";
        private const string MenuConfig = "SII_MNU_CONFIG";

        private readonly SAPbouiCOM.Application _app;
        private readonly ConexionDi _di;
        private readonly MensajesB1 _mensajes;
        private readonly LectorDi _lector;
        private readonly EscritorUdfDi _escritor;
        private readonly AdjuntadorPdfDi _adjuntador;
        private readonly AbridorArchivosWindows _abridor = new AbridorArchivosWindows();
        private readonly HttpClient _http;
        private readonly ClienteApiSii _api;
        private readonly AlmacenCacheado _almacen;
        private readonly FormularioConfiguracion _formConfig;
        private bool _ocupado;
        private bool _saliendo;

        public Aplicacion(SAPbouiCOM.Application app)
        {
            _app = app;
            _di = new ConexionDi(app);
            _mensajes = new MensajesB1(app);
            _lector = new LectorDi(_di);
            _escritor = new EscritorUdfDi(_di);
            _adjuntador = new AdjuntadorPdfDi(_di);
            // TLS 1.2 como mínimo; la verificación del certificado queda con el valor por defecto
            // (para una CA propia, instálela en el almacén de Windows; nunca se desactiva).
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            _almacen = new AlmacenCacheado(new AlmacenConfiguracionDpapi(app.Company.DatabaseName));
            _api = new ClienteApiSii(_http, () => _almacen.Cargar());
            _formConfig = new FormularioConfiguracion(app, _almacen, _mensajes);
        }

        public void Iniciar()
        {
            _app.AppEvent += new SAPbouiCOM._IApplicationEvents_AppEventEventHandler(OnAppEvent);
            _app.ItemEvent += new SAPbouiCOM._IApplicationEvents_ItemEventEventHandler(OnItemEvent);
            _app.MenuEvent += new SAPbouiCOM._IApplicationEvents_MenuEventEventHandler(OnMenuEvent);
            _app.FormDataEvent += new SAPbouiCOM._IApplicationEvents_FormDataEventEventHandler(OnFormDataEvent);

            CrearMenu();
            AgregarBotonesAFormulariosAbiertos();
            _mensajes.Estado("Add-on SII cargado.", NivelMensaje.Exito);
            var errores = VerificadorConfiguracion.Errores(_almacen.Cargar());
            if (errores.Count > 0) _mensajes.Estado("SII: falta configurar el add-on (menú Módulos > SII > Configuración).", NivelMensaje.Advertencia);
        }

        // ------------------------------------------------------------------ controladores

        private ServiciosAddon Servicios(IDocumentoB1 doc) => new ServiciosAddon(doc, _escritor, _mensajes, _api, () => _almacen.Cargar())
        {
            Abridor = _abridor,
            Adjuntador = _adjuntador,
            CarpetaTemporal = Path.Combine(Path.GetTempPath(), "SapB1Addon"),
        };

        private void EjecutarAccion(string accion, SAPbouiCOM.Form form, int objType)
        {
            if (_ocupado)
            {
                _mensajes.Estado("SII: hay otra operación en curso.", NivelMensaje.Advertencia);
                return;
            }
            _ocupado = true;
            try
            {
                var s = Servicios(new DocumentoB1Sap(form, objType, _lector));
                // La llamada a la API bloquea el hilo de la UI hasta su respuesta o el timeout de configuración.
                switch (accion)
                {
                    case BotonesSii.Emitir: new EmitirControlador(s).Ejecutar(); break;
                    case BotonesSii.Reenviar: new ReenviarControlador(s).Ejecutar(); break;
                    case BotonesSii.Pdf: new VerPdfControlador(s).Ejecutar(); break;
                    case BotonesSii.Estado: new ConsultarEstadoControlador(s).Ejecutar(); break;
                    case BotonesSii.Validar: new ValidarControlador(s).Ejecutar(); break;
                }
                RefrescarFormulario(form, objType, recargarDatos: accion != BotonesSii.Validar && accion != BotonesSii.Pdf);
            }
            finally
            {
                _ocupado = false;
            }
        }

        /// <summary>Actualiza botones/etiqueta y, si el formulario no tiene cambios pendientes, lo recarga para mostrar los UDF nuevos.</summary>
        private void RefrescarFormulario(SAPbouiCOM.Form form, int objType, bool recargarDatos)
        {
            try
            {
                int docEntry = LectorFormulario.DocEntry(form, objType);
                if (docEntry > 0 && form.Mode == SAPbouiCOM.BoFormMode.fm_OK_MODE)
                {
                    if (recargarDatos)
                    {
                        // Menú estándar "Actualizar" (1304) del documento activo (SUPUESTO).
                        form.Select();
                        _app.ActivateMenuItem("1304");
                    }
                    BotonesSii.Refrescar(form, _lector.LeerDocumento(objType, docEntry));
                }
                else
                {
                    BotonesSii.Refrescar(form, new CabeceraDocumento { ObjType = objType, DocEntry = 0 });
                }
            }
            catch (Exception e)
            {
                Trace.TraceWarning("No se pudo refrescar el formulario: " + e.Message);
            }
        }

        private void AgregarBotonesAFormulariosAbiertos()
        {
            for (int i = 0; i < _app.Forms.Count; i++)
            {
                SAPbouiCOM.Form f = _app.Forms.Item(i);
                try
                {
                    if (FormulariosSoportados.TryObjType(f.TypeEx, out var objType))
                    {
                        BotonesSii.Agregar(f);
                        RefrescarFormulario(f, objType, recargarDatos: false);
                    }
                }
                catch (Exception e)
                {
                    Trace.TraceWarning("No se pudieron agregar los botones a " + f.TypeEx + ": " + e.Message);
                }
            }
        }

        // ------------------------------------------------------------------ eventos

        private void OnItemEvent(string formUid, ref SAPbouiCOM.ItemEvent pVal, out bool bubbleEvent)
        {
            bubbleEvent = true;
            try
            {
                if (pVal.FormTypeEx == FormularioConfiguracion.Uid || formUid == FormularioConfiguracion.Uid)
                {
                    if (pVal.EventType == SAPbouiCOM.BoEventTypes.et_ITEM_PRESSED && !pVal.BeforeAction) _formConfig.ManejarClic(formUid, pVal.ItemUID);
                    return;
                }
                if (!FormulariosSoportados.TryObjType(pVal.FormTypeEx, out var objType)) return;

                switch (pVal.EventType)
                {
                    case SAPbouiCOM.BoEventTypes.et_FORM_LOAD:
                        if (!pVal.BeforeAction)
                        {
                            var f = _app.Forms.Item(formUid);
                            BotonesSii.Agregar(f);
                            BotonesSii.Refrescar(f, new CabeceraDocumento { ObjType = objType });
                        }
                        break;
                    case SAPbouiCOM.BoEventTypes.et_FORM_RESIZE:
                        if (!pVal.BeforeAction) BotonesSii.Reposicionar(_app.Forms.Item(formUid));
                        break;
                    case SAPbouiCOM.BoEventTypes.et_ITEM_PRESSED:
                        if (!pVal.BeforeAction && BotonesSii.EsBotonSii(pVal.ItemUID))
                            EjecutarAccion(pVal.ItemUID, _app.Forms.Item(formUid), objType);
                        break;
                }
            }
            catch (Exception e)
            {
                ReportarError("ItemEvent", e);
            }
        }

        private void OnFormDataEvent(ref SAPbouiCOM.BusinessObjectInfo info, out bool bubbleEvent)
        {
            bubbleEvent = true;
            try
            {
                int objType;
                if (!int.TryParse(info.Type, out objType) || (objType != 13 && objType != 14 && objType != 15)) return;
                var form = _app.Forms.Item(info.FormUID);
                if (!FormulariosSoportados.TryObjType(form.TypeEx, out _)) return;

                switch (info.EventType)
                {
                    case SAPbouiCOM.BoEventTypes.et_FORM_DATA_ADD:
                        if (info.BeforeAction)
                        {
                            // Valida y bloquea el "Agregar" si el documento (marcado para el SII) no cumple las reglas.
                            var s = Servicios(new DocumentoB1Sap(form, objType, _lector));
                            if (!new ValidarControlador(s).PermiteAgregar()) bubbleEvent = false;
                        }
                        else if (info.ActionSuccess)
                        {
                            EmitirTrasAgregar(info, form, objType);
                        }
                        break;
                    case SAPbouiCOM.BoEventTypes.et_FORM_DATA_LOAD:
                        if (!info.BeforeAction) RefrescarFormulario(form, objType, recargarDatos: false);
                        break;
                }
            }
            catch (Exception e)
            {
                // No bloquear la operación del usuario por un fallo técnico del add-on.
                bubbleEvent = true;
                ReportarError("FormDataEvent", e);
            }
        }

        /// <summary>Opcional (config EmitirAlAgregar): emite el documento recién agregado si quedó PENDIENTE.</summary>
        private void EmitirTrasAgregar(SAPbouiCOM.BusinessObjectInfo info, SAPbouiCOM.Form form, int objType)
        {
            if (!_almacen.Cargar().EmitirAlAgregar) return;
            // ObjectKey: <DocumentParams><DocEntry>123</DocEntry></DocumentParams> (SUPUESTO sobre el formato).
            var m = Regex.Match(info.ObjectKey ?? "", @"<DocEntry>(\d+)</DocEntry>");
            if (!m.Success) return;
            int docEntry = int.Parse(m.Groups[1].Value);
            var cab = _lector.LeerDocumento(objType, docEntry);
            if ((cab.SiiEstado ?? "").Trim() != EstadoSii.Pendiente) return;
            new EmitirControlador(Servicios(new DocumentoB1PorClave(objType, docEntry, _lector))).Ejecutar();
            RefrescarFormulario(form, objType, recargarDatos: true);
        }

        private void OnMenuEvent(ref SAPbouiCOM.MenuEvent pVal, out bool bubbleEvent)
        {
            bubbleEvent = true;
            try
            {
                if (pVal.BeforeAction) return;
                string accion;
                switch (pVal.MenuUID)
                {
                    case MenuConfig:
                        _formConfig.Abrir();
                        return;
                    case MenuEmitir: accion = BotonesSii.Emitir; break;
                    case MenuReenviar: accion = BotonesSii.Reenviar; break;
                    case MenuPdf: accion = BotonesSii.Pdf; break;
                    case MenuEstado: accion = BotonesSii.Estado; break;
                    case MenuValidar: accion = BotonesSii.Validar; break;
                    default: return;
                }
                var form = _app.Forms.ActiveForm;
                int objType;
                if (!FormulariosSoportados.TryObjType(form.TypeEx, out objType))
                {
                    _mensajes.Aviso("SII", "Abra una factura de deudores, nota de crédito o entrega para usar esta opción.");
                    return;
                }
                EjecutarAccion(accion, form, objType);
            }
            catch (Exception e)
            {
                ReportarError("MenuEvent", e);
            }
        }

        private void OnAppEvent(SAPbouiCOM.BoAppEventTypes eventType)
        {
            switch (eventType)
            {
                case SAPbouiCOM.BoAppEventTypes.aet_ShutDown:
                case SAPbouiCOM.BoAppEventTypes.aet_ServerTerminition:
                case SAPbouiCOM.BoAppEventTypes.aet_CompanyChanged:
                case SAPbouiCOM.BoAppEventTypes.aet_LanguageChanged:
                    // B1 vuelve a lanzar los add-ons registrados al cambiar de company o idioma: salir limpio.
                    Salir();
                    break;
            }
        }

        // ------------------------------------------------------------------ menú

        private void CrearMenu()
        {
            var menus = _app.Menus;
            if (menus.Exists(MenuRaiz)) menus.RemoveEx(MenuRaiz); // resto de una ejecución anterior sin salida limpia
            var modulos = menus.Item(MenuModulos);

            var raiz = (SAPbouiCOM.MenuCreationParams)_app.CreateObject(SAPbouiCOM.BoCreatableObjectType.cot_MenuCreationParams);
            raiz.Type = SAPbouiCOM.BoMenuType.mt_POPUP;
            raiz.UniqueID = MenuRaiz;
            raiz.String = "SII";
            raiz.Enabled = true;
            raiz.Position = -1;
            modulos.SubMenus.AddEx(raiz);

            var sub = menus.Item(MenuRaiz).SubMenus;
            Opcion(sub, MenuValidar, "Validar documento");
            Opcion(sub, MenuEmitir, "Emitir documento");
            Opcion(sub, MenuReenviar, "Reenviar al SII");
            Opcion(sub, MenuEstado, "Consultar estado");
            Opcion(sub, MenuPdf, "Ver PDF");
            Opcion(sub, MenuConfig, "Configuración");
        }

        private void Opcion(SAPbouiCOM.Menus sub, string uid, string texto)
        {
            var p = (SAPbouiCOM.MenuCreationParams)_app.CreateObject(SAPbouiCOM.BoCreatableObjectType.cot_MenuCreationParams);
            p.Type = SAPbouiCOM.BoMenuType.mt_STRING;
            p.UniqueID = uid;
            p.String = texto;
            p.Enabled = true;
            p.Position = -1;
            sub.AddEx(p);
        }

        // ------------------------------------------------------------------ cierre

        private void ReportarError(string origen, Exception e)
        {
            var texto = Secretos.Redactar("SII (" + origen + "): " + e.Message, _almacen.Cargar().ApiKey);
            Trace.TraceError(texto);
            _mensajes.Estado(texto, NivelMensaje.Error);
        }

        private void Salir()
        {
            if (_saliendo) return;
            _saliendo = true;
            try
            {
                if (_app.Menus.Exists(MenuRaiz)) _app.Menus.RemoveEx(MenuRaiz);
            }
            catch (Exception)
            {
                // B1 ya se está cerrando
            }
            System.Windows.Forms.Application.Exit();
        }

        public void Dispose()
        {
            _http.Dispose();
            _di.Dispose();
            try
            {
                System.Runtime.InteropServices.Marshal.ReleaseComObject(_app);
            }
            catch (Exception)
            {
                // ya liberado
            }
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }

        /// <summary>Evita descifrar el archivo de DPAPI en cada llamada; se invalida al guardar.</summary>
        private sealed class AlmacenCacheado : IAlmacenConfiguracion
        {
            private readonly IAlmacenConfiguracion _interno;
            private ConfiguracionAddon? _cache;

            public AlmacenCacheado(IAlmacenConfiguracion interno)
            {
                _interno = interno;
            }

            public ConfiguracionAddon Cargar() => _cache ?? (_cache = _interno.Cargar());

            public void Guardar(ConfiguracionAddon configuracion)
            {
                _interno.Guardar(configuracion);
                _cache = null;
            }
        }
    }
}
