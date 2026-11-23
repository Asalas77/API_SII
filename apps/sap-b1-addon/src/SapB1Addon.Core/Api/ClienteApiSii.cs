using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core.Api
{
    /// <summary>Error de la API en formato problem+json.</summary>
    public class ErrorApi : Exception
    {
        public int Status { get; }
        public string Codigo { get; }
        public string Detalle { get; }
        public IReadOnlyList<string> Errores { get; }

        public ErrorApi(int status, string codigo, string detalle, IReadOnlyList<string>? errores = null)
            : base(status + " " + codigo + ": " + detalle)
        {
            Status = status;
            Codigo = codigo;
            Detalle = detalle;
            Errores = errores ?? new string[0];
        }

        /// <summary>
        /// El contenido fue rechazado (400, 409, 413, 422): el documento pasa a ERROR y no se reintenta.
        /// Todo lo demás (red, 5xx, 429, 401/403 por configuración, 404 de empresa) es transitorio: se
        /// reintenta con la misma Idempotency-Key. Igual que <c>esErrorDefinitivo</c> del worker.
        /// </summary>
        public bool EsDefinitivo => Status == 400 || Status == 409 || Status == 413 || Status == 422;

        /// <summary>Texto para <c>U_SII_Glosa</c>: código, detalle y errores por campo.</summary>
        public string Glosa() => string.Join("\n", new[] { Codigo + ": " + Detalle }.Concat(Errores));
    }

    /// <summary>Fallo de red o timeout hablando con la API (transitorio).</summary>
    public class ErrorRedApi : Exception
    {
        public ErrorRedApi(string mensaje) : base(mensaje) { }
    }

    /// <summary>Operaciones de la API <c>/v1</c> que usa el add-on. Síncronas a propósito: los hilos de COM de B1 no deben cambiar.</summary>
    public interface IApiSii
    {
        ResultadoEmision Emitir(string rut, CuerpoDocumento cuerpo, string claveIdempotencia);
        IReadOnlyList<EnvioApi> CrearEnvio(string rut, IReadOnlyList<string> documentoIds);
        EstadoConsultado ConsultarEstado(string documentoId);
        DocumentoApi ObtenerDocumento(string documentoId);
        PdfDescargado DescargarPdf(string documentoId);
        /// <summary>URL del recurso (sin credenciales) para guardar en los UDF.</summary>
        string UrlRecurso(string documentoId, string recurso);
    }

    /// <summary>
    /// Cliente HTTP de la API (<c>Authorization: Bearer</c>). La API key solo viaja en la cabecera
    /// Authorization; los mensajes de error pasan por <see cref="Secretos.Redactar"/>.
    /// </summary>
    public class ClienteApiSii : IApiSii
    {
        private static readonly JsonSerializerOptions OpcionesJson = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            PropertyNameCaseInsensitive = true,
        };

        private readonly HttpClient _http;
        private readonly Func<ConfiguracionAddon> _config;

        /// <param name="http">Cliente HTTP (el adaptador real fija el timeout y la verificación TLS estándar; las pruebas usan un handler simulado).</param>
        /// <param name="config">Se lee en cada llamada: un cambio de configuración aplica sin reiniciar.</param>
        public ClienteApiSii(HttpClient http, Func<ConfiguracionAddon> config)
        {
            _http = http;
            _config = config;
        }

        public string UrlRecurso(string documentoId, string recurso) =>
            _config().ApiUrl.TrimEnd('/') + "/v1/documentos/" + documentoId + "/" + recurso;

        public ResultadoEmision Emitir(string rut, CuerpoDocumento cuerpo, string claveIdempotencia)
        {
            var h = new Dictionary<string, string> { { "Idempotency-Key", claveIdempotencia } };
            var (res, texto, _) = Pedir(HttpMethod.Post, "/empresas/" + Uri.EscapeDataString(rut) + "/documentos", cuerpo, h);
            var doc = Deserializar<DocumentoApi>(texto, "emitir");
            bool repetido = res.Headers.TryGetValues("Idempotent-Replayed", out var v) &&
                            v.Any(x => string.Equals(x, "true", StringComparison.OrdinalIgnoreCase));
            return new ResultadoEmision { Documento = doc, Repetido = repetido };
        }

        public IReadOnlyList<EnvioApi> CrearEnvio(string rut, IReadOnlyList<string> documentoIds)
        {
            var (_, texto, _) = Pedir(HttpMethod.Post, "/empresas/" + Uri.EscapeDataString(rut) + "/envios", new { documentoIds });
            return Deserializar<EnviosRespuesta>(texto, "crear envío").Envios;
        }

        public EstadoConsultado ConsultarEstado(string documentoId)
        {
            var (_, texto, _) = Pedir(HttpMethod.Post, "/documentos/" + Uri.EscapeDataString(documentoId) + "/consultar-estado", null);
            return Deserializar<EstadoConsultado>(texto, "consultar estado");
        }

        public DocumentoApi ObtenerDocumento(string documentoId)
        {
            var (_, texto, _) = Pedir(HttpMethod.Get, "/documentos/" + Uri.EscapeDataString(documentoId), null);
            return Deserializar<DocumentoApi>(texto, "obtener documento");
        }

        public PdfDescargado DescargarPdf(string documentoId)
        {
            var (res, _, bytes) = Pedir(HttpMethod.Get, "/documentos/" + Uri.EscapeDataString(documentoId) + "/pdf", null, null, "application/pdf");
            var disp = res.Content.Headers.ContentDisposition;
            var nombre = disp?.FileNameStar ?? disp?.FileName ?? ("DTE_" + documentoId + ".pdf");
            return new PdfDescargado { Contenido = bytes, Nombre = nombre.Trim('"') };
        }

        // ------------------------------------------------------------------

        private static T Deserializar<T>(string texto, string operacion)
        {
            try
            {
                var r = JsonSerializer.Deserialize<T>(texto, OpcionesJson);
                if (r == null) throw new JsonException("respuesta vacía");
                return r;
            }
            catch (JsonException e)
            {
                // Respuesta 2xx no interpretable (proxy, página HTML): transitorio.
                throw new ErrorRedApi("Respuesta inesperada de la API al " + operacion + ": " + e.Message);
            }
        }

        private (HttpResponseMessage Res, string Texto, byte[] Bytes) Pedir(
            HttpMethod metodo, string ruta, object? cuerpo, IDictionary<string, string>? headers = null, string accept = "application/json")
        {
            var cfg = _config();
            // Task.Run + GetResult: el hilo llamador (STA de B1) no se captura, así no hay interbloqueo.
            return Task.Run(() => PedirAsync(cfg, metodo, ruta, cuerpo, headers, accept)).GetAwaiter().GetResult();
        }

        private async Task<(HttpResponseMessage, string, byte[])> PedirAsync(
            ConfiguracionAddon cfg, HttpMethod metodo, string ruta, object? cuerpo, IDictionary<string, string>? headers, string accept)
        {
            var url = cfg.ApiUrl.TrimEnd('/') + "/v1" + ruta;
            using var req = new HttpRequestMessage(metodo, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.ApiKey);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(accept));
            if (headers != null) foreach (var kv in headers) req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
            if (cuerpo != null)
            {
                req.Content = new StringContent(JsonSerializer.Serialize(cuerpo, cuerpo.GetType(), OpcionesJson), Encoding.UTF8, "application/json");
            }
            else if (metodo == HttpMethod.Post)
            {
                req.Content = new StringContent("", Encoding.UTF8, "application/json");
            }

            HttpResponseMessage res;
            byte[] bytes;
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(1, cfg.TimeoutSegundos)));
                res = await _http.SendAsync(req, cts.Token).ConfigureAwait(false);
                bytes = await res.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            }
            catch (Exception e) when (e is HttpRequestException || e is TaskCanceledException || e is OperationCanceledException)
            {
                throw new ErrorRedApi(Secretos.Redactar(metodo + " " + ruta + ": " + e.Message, cfg.ApiKey));
            }

            var texto = esTexto(accept, res) ? Encoding.UTF8.GetString(bytes) : "";
            if (res.IsSuccessStatusCode) return (res, texto, bytes);

            var cuerpoError = Encoding.UTF8.GetString(bytes);
            string codigo = "HTTP_" + (int)res.StatusCode;
            string detalle = cuerpoError.Length > 300 ? cuerpoError.Substring(0, 300) : cuerpoError;
            var errores = new List<string>();
            try
            {
                using var doc = JsonDocument.Parse(cuerpoError);
                var raiz = doc.RootElement;
                if (raiz.ValueKind == JsonValueKind.Object)
                {
                    if (raiz.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String) codigo = c.GetString()!;
                    if (raiz.TryGetProperty("detail", out var d) && d.ValueKind == JsonValueKind.String) detalle = d.GetString()!;
                    if (raiz.TryGetProperty("errors", out var es) && es.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var e in es.EnumerateArray())
                        {
                            var m = e.ValueKind == JsonValueKind.Object && e.TryGetProperty("mensaje", out var mm) ? mm.GetString() : null;
                            var campo = e.ValueKind == JsonValueKind.Object && e.TryGetProperty("campo", out var cc) ? cc.GetString() : null;
                            if (!string.IsNullOrEmpty(m)) errores.Add(string.IsNullOrEmpty(campo) ? m! : campo + ": " + m);
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // cuerpo no JSON (proxy, 502 de balanceador)
            }
            if (string.IsNullOrWhiteSpace(detalle)) detalle = res.ReasonPhrase ?? "";
            throw new ErrorApi(
                (int)res.StatusCode,
                codigo,
                Secretos.Redactar(detalle, cfg.ApiKey),
                errores.Select(x => Secretos.Redactar(x, cfg.ApiKey)).ToList());
        }

        private static bool esTexto(string accept, HttpResponseMessage res) => accept != "application/pdf" || !res.IsSuccessStatusCode;
    }

    /// <summary>Evita que la API key aparezca en mensajes, glosas o logs.</summary>
    public static class Secretos
    {
        public static string Redactar(string? texto, string? secreto)
        {
            var t = texto ?? "";
            if (!string.IsNullOrEmpty(secreto) && secreto!.Length >= 4) t = t.Replace(secreto, "***");
            // Patrón de las API keys del proyecto: sk_<test|live>_<prefijo>_<secreto>
            return Regex.Replace(t, @"sk_(?:test|live)_[0-9a-fA-F]+_[A-Za-z0-9_\-]+", "***");
        }
    }
}
