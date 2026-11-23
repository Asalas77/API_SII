using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core.Controladores
{
    /// <summary>Validar sin emitir: botón "Validar" y bloqueo del "Agregar" (BeforeAction de FORM_DATA_ADD).</summary>
    public class ValidarControlador : ControladorBase
    {
        public ValidarControlador(ServiciosAddon s) : base(s) { }
        protected override string Titulo => "SII - Validación";

        /// <summary>Botón "Validar": siempre valida y muestra el detalle.</summary>
        public ResultadoAccion Ejecutar() => Proteger(() =>
        {
            var v = ValidadorDocumento.Validar(S.Documento, S.Configuracion());
            var r = v.Ok
                ? ResultadoAccion.Ok("El documento cumple las validaciones para el tipo " + v.TipoDte + ".")
                : ResultadoAccion.Falla("El documento no puede emitirse:\n" + string.Join("\n", v.Errores.Select(e => "- " + e)));
            r.Advertencias.AddRange(v.Advertencias);
            return r;
        });

        /// <summary>
        /// Solo valida los documentos marcados para el SII (<c>U_SII_Estado = PENDIENTE</c> o <c>U_SII_TipoDTE</c>
        /// informado); el resto (p. ej. documentos que no se facturan electrónicamente) pasa sin tocar.
        /// </summary>
        /// <returns>true si se puede agregar; false para bloquear con <c>BubbleEvent = false</c>.</returns>
        public bool PermiteAgregar()
        {
            try
            {
                var cab = S.Documento.LeerCabecera();
                if (!DebeValidar(cab)) return true;
                return Ejecutar().Exito;
            }
            catch (Exception e)
            {
                // Falla técnica leyendo el formulario: no bloquear la operación del usuario; avisar.
                S.Mensajes.Estado("SII - Validación omitida por un error técnico: " + Seguro(e.Message), NivelMensaje.Advertencia);
                return true;
            }
        }

        public static bool DebeValidar(CabeceraDocumento c) =>
            (c.SiiEstado ?? "").Trim() == EstadoSii.Pendiente || !string.IsNullOrWhiteSpace(c.SiiTipoDte);
    }

    /// <summary>Emite el documento ya agregado en la API y escribe folio, estado y enlaces en los UDF.</summary>
    public class EmitirControlador : ControladorBase
    {
        public EmitirControlador(ServiciosAddon s) : base(s) { }
        protected override string Titulo => "SII - Emitir";

        public ResultadoAccion Ejecutar() => Proteger(EjecutarInterno);

        private ResultadoAccion EjecutarInterno()
        {
            var cab = S.Documento.LeerCabecera();
            if (cab.DocEntry <= 0)
                return ResultadoAccion.Falla("Agregue el documento antes de emitirlo (la clave de emisión depende del DocEntry).");
            if (EstadoSii.YaEmitido(cab.SiiEstado) || cab.SiiFolio.HasValue)
                return ResultadoAccion.Falla("El documento ya fue emitido" +
                    (cab.SiiFolio.HasValue ? " con folio " + cab.SiiFolio : "") + " (estado " + cab.SiiEstado +
                    "). No se emite dos veces; para corregirlo cree una nota de crédito o débito.");
            if (!ConfiguracionValida(out var errConfig)) return ResultadoAccion.Falla(errConfig);

            var cfg = S.Configuracion();
            var v = ValidadorDocumento.Validar(S.Documento, cab, cfg);
            if (!v.Ok)
            {
                var glosa = ValidadorDocumento.Resumen(v.Errores);
                Escribir(cab, new Dictionary<string, object?> { { Udf.Estado, EstadoSii.Error }, { Udf.Glosa, glosa } });
                return ResultadoAccion.Falla("El documento tiene errores de validación:\n" + string.Join("\n", v.Errores.Select(e => "- " + e)), EstadoSii.Error);
            }

            var rut = RutEmpresa();
            var idem = string.IsNullOrWhiteSpace(cab.SiiIdemKey) ? ClaveIdempotencia.De(rut, cab.ObjType, cab.DocEntry) : cab.SiiIdemKey!.Trim();

            // Bloqueo lógico: el worker no toma PENDIENTE una vez que está ENVIANDO. Si queda así por un
            // fallo transitorio, la conciliación del worker o un nuevo clic reintentan con la MISMA clave.
            Escribir(cab, new Dictionary<string, object?>
            {
                { Udf.Estado, EstadoSii.Enviando }, { Udf.IdemKey, idem }, { Udf.Glosa, "" },
            });

            ResultadoEmision emision;
            try
            {
                emision = S.Api.Emitir(rut, v.Cuerpo!, idem);
            }
            catch (ErrorApi e) when (e.EsDefinitivo)
            {
                Escribir(cab, new Dictionary<string, object?> { { Udf.Estado, EstadoSii.Error }, { Udf.Glosa, TraductorEstados.Acotar(Seguro(e.Glosa())) } });
                return ResultadoAccion.Falla("La API rechazó el documento:\n" + e.Glosa(), EstadoSii.Error);
            }
            catch (Exception e) when (e is ErrorApi || e is ErrorRedApi)
            {
                var extra = e is ErrorApi ea && (ea.Status == 401 || ea.Status == 403)
                    ? "\nRevise la API key y sus permisos (documentos.emitir) en SII > Configuración."
                    : "";
                return ResultadoAccion.Falla("No se pudo emitir ahora (" + e.Message + "). El documento queda ENVIANDO: " +
                    "vuelva a pulsar Emitir; se reutiliza la misma Idempotency-Key, no se consume otro folio." + extra, EstadoSii.Enviando);
            }

            var d = emision.Documento;
            try
            {
                Escribir(cab, new Dictionary<string, object?>
                {
                    { Udf.Estado, EstadoSii.Emitido },
                    { Udf.TipoDte, v.TipoDte.ToString() },
                    { Udf.Folio, d.Folio },
                    { Udf.DocId, d.Id },
                    { Udf.XmlUrl, S.Api.UrlRecurso(d.Id, "xml") },
                    { Udf.PdfUrl, S.Api.UrlRecurso(d.Id, "pdf") },
                    { Udf.IdemKey, idem },
                    { Udf.Glosa, "" },
                });
            }
            catch (Exception e)
            {
                return ResultadoAccion.Falla("La API emitió el folio " + d.Folio + " pero no se pudo guardar en B1 (" + e.Message +
                    "). Vuelva a pulsar Emitir: la API devuelve el mismo documento sin consumir otro folio.", EstadoSii.Enviando);
            }

            var res = ResultadoAccion.Ok("Documento emitido: tipo " + v.TipoDte + ", folio " + d.Folio + (emision.Repetido ? " (ya emitido antes; mismo folio)" : "") + ".", EstadoSii.Emitido);
            res.Advertencias.AddRange(v.Advertencias);

            if (cfg.AdjuntarPdf) IntentarAdjuntarPdf(cab, d, res);
            if (cfg.EnviarAlEmitir)
            {
                var nuevo = ServicioEnvio.EnviarAlSii(S, cab, d.Id, res);
                if (nuevo != null) res.EstadoB1 = nuevo;
            }
            return res;
        }

        private void IntentarAdjuntarPdf(CabeceraDocumento cab, DocumentoApi d, ResultadoAccion res)
        {
            if (S.Adjuntador == null) return;
            if (cab.AttachmentEntry.HasValue && cab.AttachmentEntry.Value > 0) return; // ya tiene adjuntos: queda la URL
            try
            {
                var ruta = GuardarPdf(S, S.Api.DescargarPdf(d.Id), cab.SiiTipoDte, d);
                if (!S.Adjuntador.Adjuntar(cab.ObjType, cab.DocEntry, ruta))
                    res.Advertencias.Add("No se pudo adjuntar el PDF al documento (queda la URL en U_SII_PdfUrl).");
            }
            catch (Exception e)
            {
                res.Advertencias.Add("No se pudo adjuntar el PDF (no bloquea; queda U_SII_PdfUrl): " + e.Message);
            }
        }

        internal static string GuardarPdf(ServiciosAddon s, PdfDescargado pdf, string? tipoCrudo, DocumentoApi d)
        {
            // El nombre lo arma el add-on (nunca el que sugiera el servidor) para evitar rutas inesperadas.
            var nombre = "DTE_" + (d.TipoDte > 0 ? d.TipoDte.ToString() : (tipoCrudo ?? "").Trim()) + "_" + d.Folio + ".pdf";
            foreach (var c in Path.GetInvalidFileNameChars()) nombre = nombre.Replace(c, '_');
            Directory.CreateDirectory(s.CarpetaTemporal);
            var ruta = Path.Combine(s.CarpetaTemporal, nombre);
            File.WriteAllBytes(ruta, pdf.Contenido);
            return ruta;
        }
    }

    /// <summary>Envío al SII y sincronización de estado, compartido por Emitir y Reenviar.</summary>
    internal static class ServicioEnvio
    {
        /// <returns>El nuevo U_SII_Estado si cambió; null si no cambió.</returns>
        public static string? EnviarAlSii(ServiciosAddon s, CabeceraDocumento cab, string docId, ResultadoAccion res)
        {
            var rut = Rut.Normalizar(s.Configuracion().RutEmpresa)!;
            try
            {
                var envios = s.Api.CrearEnvio(rut, new[] { docId });
                foreach (var envio in envios)
                {
                    if (envio.Documentos.Any(x => x.DocumentoId == docId))
                    {
                        s.Udf.Escribir(cab.ObjType, cab.DocEntry, new Dictionary<string, object?>
                        {
                            { Udf.Estado, EstadoSii.Enviado }, { Udf.TrackId, envio.TrackId ?? "" }, { Udf.Glosa, "" },
                        });
                        res.Mensaje += "\nEnviado al SII" + (string.IsNullOrEmpty(envio.TrackId) ? "." : " (Track ID " + envio.TrackId + ").");
                        return EstadoSii.Enviado;
                    }
                }
                res.Advertencias.Add("La API no incluyó el documento en el envío; reintente con Reenviar.");
                return null;
            }
            catch (ErrorApi e) when (e.Status == 409)
            {
                // Ya salió en otro envío (p. ej. el worker): refleja el estado de la API.
                try
                {
                    var api = s.Api.ObtenerDocumento(docId);
                    var nuevo = TraductorEstados.Desde(api.Estado);
                    if (nuevo != null && nuevo != EstadoSii.Emitido)
                    {
                        var cambios = new Dictionary<string, object?> { { Udf.Estado, nuevo } };
                        if (!string.IsNullOrEmpty(api.TrackId)) cambios[Udf.TrackId] = api.TrackId;
                        cambios[Udf.Glosa] = nuevo == EstadoSii.Enviado ? "" : TraductorEstados.GlosaDeEstado(api, api.GlosaSii, null, api.EstadoSii);
                        s.Udf.Escribir(cab.ObjType, cab.DocEntry, cambios);
                        res.Mensaje += "\nEl documento ya había sido enviado al SII (estado " + nuevo + ").";
                        return nuevo;
                    }
                }
                catch (Exception e2)
                {
                    res.Advertencias.Add("No se pudo sincronizar con la API: " + e2.Message);
                }
                res.Advertencias.Add("La API no permite enviar el documento ahora: " + e.Glosa());
                return null;
            }
            catch (Exception e) when (e is ErrorApi || e is ErrorRedApi)
            {
                res.Advertencias.Add("El envío al SII falló (" + e.Message + "); use Reenviar o espere al worker.");
                return null;
            }
        }
    }

    /// <summary>Envía al SII un documento ya emitido (<c>EMITIDO</c>) que no salió.</summary>
    public class ReenviarControlador : ControladorBase
    {
        public ReenviarControlador(ServiciosAddon s) : base(s) { }
        protected override string Titulo => "SII - Reenviar";

        public ResultadoAccion Ejecutar() => Proteger(() =>
        {
            var cab = S.Documento.LeerCabecera();
            var estado = (cab.SiiEstado ?? "").Trim();
            if (cab.DocEntry <= 0 || string.IsNullOrWhiteSpace(cab.SiiDocId))
                return ResultadoAccion.Falla("El documento aún no está emitido: use Emitir.");
            if (estado != EstadoSii.Emitido)
                return ResultadoAccion.Falla(estado == EstadoSii.Enviado
                    ? "El documento ya se envió al SII (Track ID " + cab.SiiTrackId + "). Use Consultar estado."
                    : "Solo se reenvían documentos en estado EMITIDO (estado actual: " + (string.IsNullOrEmpty(estado) ? "vacío" : estado) + ").");
            if (!ConfiguracionValida(out var errConfig)) return ResultadoAccion.Falla(errConfig);

            var r = ResultadoAccion.Ok("Reenvío solicitado.");
            var nuevo = ServicioEnvio.EnviarAlSii(S, cab, cab.SiiDocId!.Trim(), r);
            if (nuevo == null)
            {
                r.Exito = false;
                r.Mensaje = "No se pudo enviar el documento al SII.";
            }
            r.EstadoB1 = nuevo ?? cab.SiiEstado;
            return r;
        });
    }

    /// <summary>Consulta el estado en el SII (vía la API) y lo refleja en los UDF.</summary>
    public class ConsultarEstadoControlador : ControladorBase
    {
        public ConsultarEstadoControlador(ServiciosAddon s) : base(s) { }
        protected override string Titulo => "SII - Estado";

        public ResultadoAccion Ejecutar() => Proteger(() =>
        {
            var cab = S.Documento.LeerCabecera();
            var estado = (cab.SiiEstado ?? "").Trim();
            if (cab.DocEntry <= 0 || string.IsNullOrWhiteSpace(cab.SiiDocId))
                return ResultadoAccion.Falla("El documento aún no está emitido.");
            if (estado == EstadoSii.Emitido)
                return ResultadoAccion.Falla("El documento está emitido pero aún no se envía al SII: use Reenviar.");
            if (estado != EstadoSii.Enviado)
                return ResultadoAccion.Ok("El estado " + estado + " es final; no hay nada que consultar.", estado);
            if (!ConfiguracionValida(out var errConfig)) return ResultadoAccion.Falla(errConfig);

            EstadoConsultado e;
            try
            {
                e = S.Api.ConsultarEstado(cab.SiiDocId!.Trim());
            }
            catch (ErrorApi ex) when (ex.Status == 409)
            {
                // La API no lo tiene como enviado: vuelve a EMITIDO para reenviarlo (igual que el worker).
                Escribir(cab, new Dictionary<string, object?> { { Udf.Estado, EstadoSii.Emitido }, { Udf.Glosa, TraductorEstados.Acotar(Seguro(ex.Glosa())) } });
                return ResultadoAccion.Falla("La API no tiene el documento como enviado; volvió a EMITIDO. Use Reenviar.\n" + ex.Glosa(), EstadoSii.Emitido);
            }
            catch (Exception ex) when (ex is ErrorApi || ex is ErrorRedApi)
            {
                return ResultadoAccion.Falla("No se pudo consultar el estado: " + ex.Message);
            }

            var nuevo = TraductorEstados.Desde(e.Documento.Estado);
            if (nuevo == null || nuevo == EstadoSii.Enviado)
                return ResultadoAccion.Ok("El SII aún está procesando el documento" + (string.IsNullOrEmpty(e.EstadoSii) ? "." : " (" + e.EstadoSii + ")."), EstadoSii.Enviado);

            var cambios = new Dictionary<string, object?> { { Udf.Estado, nuevo } };
            if (!string.IsNullOrEmpty(e.Documento.TrackId)) cambios[Udf.TrackId] = e.Documento.TrackId;
            cambios[Udf.Glosa] = nuevo == EstadoSii.Emitido
                ? "El SII aun no recibe el documento: se reenviara"
                : TraductorEstados.GlosaDeEstado(e.Documento, e.GlosaSii, e.DescripcionEstado, e.EstadoSii);
            Escribir(cab, cambios);
            var msg = "Estado en el SII: " + nuevo;
            var glosa = cambios[Udf.Glosa] as string;
            if (!string.IsNullOrEmpty(glosa) && nuevo != EstadoSii.Aceptado) msg += "\n" + glosa;
            return nuevo == EstadoSii.Rechazado
                ? new ResultadoAccion { Exito = false, Mensaje = msg, EstadoB1 = nuevo }
                : ResultadoAccion.Ok(msg, nuevo);
        });
    }

    /// <summary>Descarga el PDF a una carpeta temporal y lo abre con la aplicación asociada.</summary>
    public class VerPdfControlador : ControladorBase
    {
        public VerPdfControlador(ServiciosAddon s) : base(s) { }
        protected override string Titulo => "SII - PDF";

        public ResultadoAccion Ejecutar() => Proteger(() =>
        {
            var cab = S.Documento.LeerCabecera();
            if (cab.DocEntry <= 0 || string.IsNullOrWhiteSpace(cab.SiiDocId))
                return ResultadoAccion.Falla("El documento aún no está emitido: no hay PDF.");
            if (S.Abridor == null) return ResultadoAccion.Falla("No hay un visor de archivos configurado.");
            if (!ConfiguracionValida(out var errConfig)) return ResultadoAccion.Falla(errConfig);

            PdfDescargado pdf;
            try
            {
                pdf = S.Api.DescargarPdf(cab.SiiDocId!.Trim());
            }
            catch (Exception e) when (e is ErrorApi || e is ErrorRedApi)
            {
                return ResultadoAccion.Falla("No se pudo descargar el PDF: " + e.Message);
            }
            var d = new DocumentoApi { Id = cab.SiiDocId!, Folio = cab.SiiFolio ?? 0, TipoDte = int.TryParse(cab.SiiTipoDte, out var t) ? t : 0 };
            var ruta = EmitirControlador.GuardarPdf(S, pdf, cab.SiiTipoDte, d);
            S.Abridor.Abrir(ruta);
            return ResultadoAccion.Ok("PDF abierto: " + ruta);
        });
    }
}
