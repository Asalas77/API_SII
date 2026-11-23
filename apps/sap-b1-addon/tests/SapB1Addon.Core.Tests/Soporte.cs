using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SapB1Addon.Core;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Controladores;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core.Tests
{
    public static class Constantes
    {
        public const string RutEmpresa = "76086428-5";
        public const string RutCliente = "12345678-5";
        public const string ApiKey = "sk_test_0123456789_ABCdef-secretoSECRETO_1234567890abcdefghijk";
    }

    /// <summary>Documentos B1 de prueba.</summary>
    public static class Datos
    {
        public static ConfiguracionAddon Config() => new ConfiguracionAddon
        {
            ApiUrl = "https://api.prueba.cl",
            RutEmpresa = "76.086.428-5",
            ApiKey = Constantes.ApiKey,
            AdjuntarPdf = true,
        };

        public static SocioNegocio Socio(string? rut = Constantes.RutCliente, string? giro = "Venta de insumos") => new SocioNegocio
        {
            CardCode = "C001",
            CardName = "Cliente Uno SpA",
            LicTradNum = rut,
            Giro = giro,
            EmailAddress = "contacto@cliente.cl",
            Phone1 = "+56 2 2222 2222",
            Direcciones =
            {
                new DireccionSocio { AddressName = "Casa matriz", AddressType = "bo_BillTo", Street = "Av. Siempre Viva", StreetNo = "742", City = "Santiago", County = "Providencia" },
            },
        };

        public static LineaDocumento Linea(int n = 0, decimal cantidad = 2, decimal precio = 1000, string tax = "IVA", decimal? desc = null) => new LineaDocumento
        {
            LineNum = n,
            ItemCode = "A" + (n + 1),
            ItemDescription = "Artículo " + (n + 1),
            Quantity = cantidad,
            UnitPrice = precio,
            TaxCode = tax,
            DiscountPercent = desc,
            MeasureUnit = "UN",
        };

        public static CabeceraDocumento Factura(int docEntry = 100) => new CabeceraDocumento
        {
            ObjType = 13,
            DocEntry = docEntry,
            DocNum = 5000 + docEntry,
            DocDate = new DateTime(2026, 3, 10),
            DocDueDate = new DateTime(2026, 4, 9),
            CardCode = "C001",
            CardName = "Cliente Uno SpA",
            PaymentGroupCode = 2,
            Lines = { Linea(0), Linea(1, 1, 500, desc: 10) },
            SiiEstado = EstadoSii.Pendiente,
        };

        public static CabeceraDocumento NotaCredito(int docEntry = 200, int baseEntry = 100) => new CabeceraDocumento
        {
            ObjType = 14,
            DocEntry = docEntry,
            DocDate = new DateTime(2026, 3, 12),
            CardCode = "C001",
            CardName = "Cliente Uno SpA",
            Lines =
            {
                new LineaDocumento { LineNum = 0, ItemCode = "A1", ItemDescription = "Artículo 1", Quantity = 1, UnitPrice = 1000, TaxCode = "IVA", BaseType = 13, BaseEntry = baseEntry },
            },
            SiiEstado = EstadoSii.Pendiente,
            SiiCodRef = "1",
            SiiRazonRef = "Anula factura",
        };

        public static CabeceraDocumento Guia(int docEntry = 300) => new CabeceraDocumento
        {
            ObjType = 15,
            DocEntry = docEntry,
            DocDate = new DateTime(2026, 3, 11),
            CardCode = "C001",
            CardName = "Cliente Uno SpA",
            Lines = { Linea(0) },
            SiiEstado = EstadoSii.Pendiente,
            SiiIndTraslado = "1",
            SiiTransporte = "Patente AB1234; chofer Juan",
        };
    }

    public class DocumentoFalso : IDocumentoB1
    {
        public CabeceraDocumento Cab { get; set; }
        public SocioNegocio? Socio { get; set; } = Datos.Socio();
        public Dictionary<string, BaseInfo> Bases { get; } = new Dictionary<string, BaseInfo>();
        public Exception? FallaAlLeerSocio { get; set; }
        public int LecturasDeCabecera { get; private set; }

        public DocumentoFalso(CabeceraDocumento cab) { Cab = cab; }

        public CabeceraDocumento LeerCabecera()
        {
            LecturasDeCabecera++;
            return Cab;
        }

        public SocioNegocio? LeerSocio(string cardCode)
        {
            if (FallaAlLeerSocio != null) throw FallaAlLeerSocio;
            return Socio;
        }

        public BaseInfo? LeerBase(int objType, int docEntry) =>
            Bases.TryGetValue(MapeadorDocumento.ClaveBase(objType, docEntry), out var b) ? b : null;
    }

    /// <summary>Aplica las escrituras sobre la cabecera en memoria (como lo haría B1) y las registra.</summary>
    public class EscritorUdfFalso : IEscritorUdf
    {
        private readonly DocumentoFalso _doc;
        public List<Dictionary<string, object?>> Escrituras { get; } = new List<Dictionary<string, object?>>();
        public Func<IReadOnlyDictionary<string, object?>, Exception?>? Falla { get; set; }

        public EscritorUdfFalso(DocumentoFalso doc) { _doc = doc; }

        public void Escribir(int objType, int docEntry, IReadOnlyDictionary<string, object?> cambios)
        {
            var ex = Falla?.Invoke(cambios);
            if (ex != null) throw ex;
            Escrituras.Add(new Dictionary<string, object?>(cambios));
            var c = _doc.Cab;
            foreach (var kv in cambios)
            {
                var s = kv.Value as string;
                switch (kv.Key)
                {
                    case Udf.Estado: c.SiiEstado = s; break;
                    case Udf.TipoDte: c.SiiTipoDte = s; break;
                    case Udf.Folio: c.SiiFolio = kv.Value == null ? (long?)null : Convert.ToInt64(kv.Value); break;
                    case Udf.TrackId: c.SiiTrackId = s; break;
                    case Udf.Glosa: c.SiiGlosa = s; break;
                    case Udf.DocId: c.SiiDocId = s; break;
                    case Udf.XmlUrl: c.SiiXmlUrl = s; break;
                    case Udf.PdfUrl: c.SiiPdfUrl = s; break;
                    case Udf.IdemKey: c.SiiIdemKey = s; break;
                    default: throw new InvalidOperationException("UDF desconocido: " + kv.Key);
                }
            }
        }

        public Dictionary<string, object?> Ultima => Escrituras.Last();
        public IEnumerable<string?> Estados => Escrituras.Where(e => e.ContainsKey(Udf.Estado)).Select(e => e[Udf.Estado] as string);
    }

    public class MensajesFalsos : IMensajes
    {
        public List<(string Texto, NivelMensaje Nivel)> EnEstado { get; } = new List<(string, NivelMensaje)>();
        public List<(string Titulo, string Texto)> Avisos { get; } = new List<(string, string)>();
        public void Estado(string texto, NivelMensaje nivel) => EnEstado.Add((texto, nivel));
        public void Aviso(string titulo, string texto) => Avisos.Add((titulo, texto));
        public string Todo => string.Join("\n", EnEstado.Select(x => x.Texto).Concat(Avisos.Select(x => x.Titulo + "\n" + x.Texto)));
    }

    public class AbridorFalso : IAbridorArchivos
    {
        public List<string> Abiertos { get; } = new List<string>();
        public void Abrir(string ruta) => Abiertos.Add(ruta);
    }

    public class AdjuntadorFalso : IAdjuntadorPdf
    {
        public List<(int ObjType, int DocEntry, string Ruta)> Llamadas { get; } = new List<(int, int, string)>();
        public bool Resultado { get; set; } = true;
        public bool Lanza { get; set; }
        public bool Adjuntar(int objType, int docEntry, string rutaPdf)
        {
            if (Lanza) throw new IOException("sin permiso de adjuntos");
            Llamadas.Add((objType, docEntry, rutaPdf));
            return Resultado;
        }
    }

    public class PeticionRegistrada
    {
        public HttpMethod Metodo { get; set; } = HttpMethod.Get;
        public string Ruta { get; set; } = "";
        public string? Autorizacion { get; set; }
        public string? ClaveIdempotencia { get; set; }
        public string Cuerpo { get; set; } = "";
    }

    /// <summary>API /v1 simulada: folios, idempotencia, envíos, estado y PDF, con inyección de fallos.</summary>
    public class ApiSimulada : HttpMessageHandler
    {
        private readonly Dictionary<string, (string Id, long Folio, int Tipo)> _porClave = new Dictionary<string, (string, long, int)>();
        private long _siguienteFolio = 1000;
        private int _contadorIds;

        public List<PeticionRegistrada> Peticiones { get; } = new List<PeticionRegistrada>();
        public int FoliosAsignados => _porClave.Count;
        public Func<PeticionRegistrada, HttpResponseMessage?>? Interceptor { get; set; }
        /// <summary>Crea el documento pero pierde la respuesta (timeout) la primera vez.</summary>
        public bool PerderRespuestaTrasCrear { get; set; }
        public string EstadoApi { get; set; } = "enviado";
        public string? EstadoSii { get; set; } = "EPR";
        public string? GlosaSii { get; set; } = "Envio Procesado";
        public string? Reparos { get; set; }
        public string TrackId { get; set; } = "9876543210";
        public byte[] Pdf { get; set; } = Encoding.ASCII.GetBytes("%PDF-1.4 falso");

        public IEnumerable<PeticionRegistrada> Emisiones => Peticiones.Where(p => p.Metodo == HttpMethod.Post && p.Ruta.EndsWith("/documentos"));

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var p = new PeticionRegistrada
            {
                Metodo = request.Method,
                Ruta = request.RequestUri!.AbsolutePath,
                Autorizacion = request.Headers.Authorization?.ToString(),
                ClaveIdempotencia = request.Headers.TryGetValues("Idempotency-Key", out var v) ? v.FirstOrDefault() : null,
                Cuerpo = request.Content == null ? "" : await request.Content.ReadAsStringAsync().ConfigureAwait(false),
            };
            Peticiones.Add(p);

            var forzada = Interceptor?.Invoke(p);
            if (forzada != null) return forzada;

            if (p.Metodo == HttpMethod.Post && p.Ruta.EndsWith("/documentos"))
            {
                var clave = p.ClaveIdempotencia ?? "";
                bool repetido = _porClave.TryGetValue(clave, out var existente);
                if (!repetido)
                {
                    using var doc = JsonDocument.Parse(p.Cuerpo);
                    existente = ("doc-" + (++_contadorIds), _siguienteFolio++, doc.RootElement.GetProperty("idDoc").GetProperty("tipoDte").GetInt32());
                    _porClave[clave] = existente;
                    if (PerderRespuestaTrasCrear)
                    {
                        PerderRespuestaTrasCrear = false;
                        throw new HttpRequestException("conexión interrumpida tras crear el documento");
                    }
                }
                var r = Json(repetido ? HttpStatusCode.OK : HttpStatusCode.Created, new { id = existente.Id, tipoDte = existente.Tipo, folio = existente.Folio, estado = "encolado", trackId = (string?)null });
                if (repetido) r.Headers.Add("Idempotent-Replayed", "true");
                return r;
            }
            if (p.Metodo == HttpMethod.Post && p.Ruta.EndsWith("/envios"))
            {
                using var body = JsonDocument.Parse(p.Cuerpo);
                var ids = body.RootElement.GetProperty("documentoIds").EnumerateArray().Select(x => x.GetString()!).ToArray();
                return Json(HttpStatusCode.Created, new { envios = new[] { new { id = "env-1", trackId = TrackId, estado = "enviado", documentos = ids.Select(i => new { documentoId = i, tipoDte = 33, folio = 1 }).ToArray() } } });
            }
            if (p.Metodo == HttpMethod.Post && p.Ruta.EndsWith("/consultar-estado"))
            {
                var id = p.Ruta.Split('/')[3];
                object reparos = Reparos == null ? null! : Reparos;
                return Json(HttpStatusCode.OK, new
                {
                    documento = new { id, tipoDte = 33, folio = 1000, estado = EstadoApi, trackId = TrackId, reparos },
                    estadoSii = EstadoSii,
                    glosaSii = GlosaSii,
                    esFinal = EstadoApi != "enviado",
                });
            }
            if (p.Metodo == HttpMethod.Get && p.Ruta.EndsWith("/pdf"))
            {
                var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Pdf) };
                r.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
                r.Content.Headers.ContentDisposition = new System.Net.Http.Headers.ContentDispositionHeaderValue("inline") { FileName = "\"../../peligroso.pdf\"" };
                return r;
            }
            if (p.Metodo == HttpMethod.Get && p.Ruta.Contains("/documentos/"))
            {
                var id = p.Ruta.Split('/').Last();
                return Json(HttpStatusCode.OK, new { id, tipoDte = 33, folio = 1000, estado = EstadoApi, trackId = TrackId });
            }
            return Json(HttpStatusCode.NotFound, new { code = "NO_ENCONTRADO", detail = "ruta desconocida" });
        }

        public static HttpResponseMessage Json(HttpStatusCode status, object cuerpo) => new HttpResponseMessage(status)
        {
            Content = new StringContent(JsonSerializer.Serialize(cuerpo), Encoding.UTF8, "application/json"),
        };

        public static HttpResponseMessage Problema(HttpStatusCode status, string codigo, string detalle, params string[] errores) =>
            Json(status, new { type = "about:blank", title = codigo, status = (int)status, code = codigo, detail = detalle, errors = errores.Select(e => new { campo = "x", mensaje = e }).ToArray() });
    }

    /// <summary>Todo cableado: documento falso + API simulada + controladores.</summary>
    public class Escenario : IDisposable
    {
        public DocumentoFalso Doc { get; }
        public EscritorUdfFalso Udf { get; }
        public MensajesFalsos Msg { get; } = new MensajesFalsos();
        public AbridorFalso Abridor { get; } = new AbridorFalso();
        public AdjuntadorFalso Adjuntador { get; } = new AdjuntadorFalso();
        public ApiSimulada Servidor { get; }
        public ConfiguracionAddon Config { get; }
        public ServiciosAddon Servicios { get; }
        public string Carpeta { get; }

        public Escenario(CabeceraDocumento? cab = null, ApiSimulada? servidor = null, ConfiguracionAddon? config = null)
        {
            Doc = new DocumentoFalso(cab ?? Datos.Factura());
            Udf = new EscritorUdfFalso(Doc);
            Servidor = servidor ?? new ApiSimulada();
            Config = config ?? Datos.Config();
            Carpeta = Path.Combine(Path.GetTempPath(), "SapB1AddonTests", Guid.NewGuid().ToString("N"));
            var api = new ClienteApiSii(new HttpClient(Servidor), () => Config);
            Servicios = new ServiciosAddon(Doc, Udf, Msg, api, () => Config)
            {
                Abridor = Abridor,
                Adjuntador = Adjuntador,
                CarpetaTemporal = Carpeta,
            };
        }

        public EmitirControlador Emitir() => new EmitirControlador(Servicios);
        public ReenviarControlador Reenviar() => new ReenviarControlador(Servicios);
        public ConsultarEstadoControlador Consultar() => new ConsultarEstadoControlador(Servicios);
        public VerPdfControlador VerPdf() => new VerPdfControlador(Servicios);
        public ValidarControlador Validar() => new ValidarControlador(Servicios);

        public void Dispose()
        {
            try { if (Directory.Exists(Carpeta)) Directory.Delete(Carpeta, true); } catch { }
        }
    }
}
