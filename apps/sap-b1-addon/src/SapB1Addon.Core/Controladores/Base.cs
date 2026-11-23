using System;
using System.Collections.Generic;
using System.Linq;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core.Controladores
{
    /// <summary>Dependencias de los controladores (todas son puertos: la capa SAP aporta las reales).</summary>
    public class ServiciosAddon
    {
        public ServiciosAddon(IDocumentoB1 documento, IEscritorUdf udf, IMensajes mensajes, IApiSii api, Func<ConfiguracionAddon> configuracion)
        {
            Documento = documento;
            Udf = udf;
            Mensajes = mensajes;
            Api = api;
            Configuracion = configuracion;
        }

        public IDocumentoB1 Documento { get; }
        public IEscritorUdf Udf { get; }
        public IMensajes Mensajes { get; }
        public IApiSii Api { get; }
        public Func<ConfiguracionAddon> Configuracion { get; }
        public IAbridorArchivos? Abridor { get; set; }
        public IAdjuntadorPdf? Adjuntador { get; set; }
        /// <summary>Carpeta donde "Ver PDF" guarda el archivo (la capa SAP usa la temporal del usuario).</summary>
        public string CarpetaTemporal { get; set; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "SapB1Addon");
    }

    public class ResultadoAccion
    {
        public bool Exito { get; set; }
        /// <summary>Texto para el usuario (puede ser multilínea). Nunca contiene la API key.</summary>
        public string Mensaje { get; set; } = "";
        /// <summary>Valor de <c>U_SII_Estado</c> tras la acción, si cambió.</summary>
        public string? EstadoB1 { get; set; }
        public List<string> Advertencias { get; } = new List<string>();

        public static ResultadoAccion Ok(string mensaje, string? estado = null) => new ResultadoAccion { Exito = true, Mensaje = mensaje, EstadoB1 = estado };
        public static ResultadoAccion Falla(string mensaje, string? estado = null) => new ResultadoAccion { Exito = false, Mensaje = mensaje, EstadoB1 = estado };
    }

    /// <summary>Qué acciones corresponden a un documento según su estado (para habilitar/deshabilitar botones).</summary>
    public class Disponibilidad
    {
        public bool Emitir { get; set; }
        public bool Reenviar { get; set; }
        public bool VerPdf { get; set; }
        public bool ConsultarEstado { get; set; }
        public bool Validar { get; set; }

        public static Disponibilidad De(CabeceraDocumento c)
        {
            bool agregado = c.DocEntry > 0;
            var estado = (c.SiiEstado ?? "").Trim();
            bool conDocId = !string.IsNullOrWhiteSpace(c.SiiDocId) && c.SiiFolio.HasValue;
            bool yaEmitido = EstadoSii.YaEmitido(estado) || c.SiiFolio.HasValue;
            return new Disponibilidad
            {
                Validar = true,
                Emitir = agregado && !yaEmitido,
                Reenviar = agregado && conDocId && estado == EstadoSii.Emitido,
                VerPdf = agregado && conDocId,
                ConsultarEstado = agregado && conDocId && estado == EstadoSii.Enviado,
            };
        }
    }

    public abstract class ControladorBase
    {
        protected readonly ServiciosAddon S;

        protected ControladorBase(ServiciosAddon servicios)
        {
            S = servicios;
        }

        protected abstract string Titulo { get; }

        /// <summary>Texto seguro para mostrar: sin la API key.</summary>
        protected string Seguro(string? texto) => Secretos.Redactar(texto, S.Configuracion().ApiKey);

        /// <summary>
        /// Ejecuta la acción, nunca lanza (un handler de B1 que lanza puede tumbar el cliente) y
        /// publica el resultado en la barra de estado (y en un cuadro si hay detalle o falló).
        /// </summary>
        protected ResultadoAccion Proteger(Func<ResultadoAccion> accion)
        {
            ResultadoAccion r;
            try
            {
                r = accion();
            }
            catch (Exception e)
            {
                r = ResultadoAccion.Falla("Error inesperado: " + e.GetType().Name + ": " + e.Message);
            }
            r.Mensaje = Seguro(r.Mensaje);
            Publicar(r);
            return r;
        }

        private void Publicar(ResultadoAccion r)
        {
            try
            {
                var primera = r.Mensaje.Split('\n')[0];
                S.Mensajes.Estado(Titulo + ": " + primera, r.Exito ? (r.Advertencias.Count > 0 ? NivelMensaje.Advertencia : NivelMensaje.Exito) : NivelMensaje.Error);
                if (!r.Exito || r.Mensaje.Contains("\n") || r.Advertencias.Count > 0)
                {
                    var texto = r.Mensaje;
                    if (r.Advertencias.Count > 0) texto += "\n\nAdvertencias:\n" + string.Join("\n", r.Advertencias.Select(a => "- " + Seguro(a)));
                    S.Mensajes.Aviso(Titulo, texto);
                }
            }
            catch
            {
                // La interfaz nunca debe tumbar la acción.
            }
        }

        protected bool ConfiguracionValida(out string error)
        {
            var errores = VerificadorConfiguracion.Errores(S.Configuracion());
            error = errores.Count == 0 ? "" : "Configure el add-on (menú SII > Configuración):\n" + string.Join("\n", errores.Select(e => "- " + e));
            return errores.Count == 0;
        }

        protected void Escribir(CabeceraDocumento cab, IDictionary<string, object?> cambios)
        {
            S.Udf.Escribir(cab.ObjType, cab.DocEntry, new Dictionary<string, object?>(cambios));
        }

        protected string RutEmpresa() => Rut.Normalizar(S.Configuracion().RutEmpresa)!;
    }

    public static class VerificadorConfiguracion
    {
        public static List<string> Errores(ConfiguracionAddon c)
        {
            var e = new List<string>();
            if (string.IsNullOrWhiteSpace(c.ApiUrl) ||
                !Uri.TryCreate(c.ApiUrl.Trim(), UriKind.Absolute, out var u) ||
                (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp))
                e.Add("URL de la API inválida (debe comenzar con https://)");
            if (Rut.Normalizar(c.RutEmpresa) == null) e.Add("RUT del emisor inválido (dígito verificador o formato)");
            if (string.IsNullOrWhiteSpace(c.ApiKey)) e.Add("Falta la API key");
            return e;
        }
    }
}
