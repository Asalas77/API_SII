using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace SapB1Addon.Core.Api
{
    /// <summary>Cuerpo de <c>POST /v1/empresas/{rut}/documentos</c> (ver <c>EmitirDocumentoDto</c> de la API).</summary>
    public class CuerpoDocumento
    {
        [JsonPropertyName("idDoc")] public CuerpoIdDoc IdDoc { get; set; } = new CuerpoIdDoc();
        [JsonPropertyName("receptor")] public CuerpoReceptor? Receptor { get; set; }
        [JsonPropertyName("detalle")] public List<CuerpoDetalle> Detalle { get; set; } = new List<CuerpoDetalle>();
        [JsonPropertyName("descuentosRecargos")] public List<CuerpoDescuentoRecargo>? DescuentosRecargos { get; set; }
        [JsonPropertyName("referencias")] public List<CuerpoReferencia>? Referencias { get; set; }
        [JsonPropertyName("origen")] public Dictionary<string, object>? Origen { get; set; }
    }

    public class CuerpoIdDoc
    {
        [JsonPropertyName("tipoDte")] public int TipoDte { get; set; }
        [JsonPropertyName("fechaEmision")] public string FechaEmision { get; set; } = "";
        [JsonPropertyName("fechaVencimiento")] public string? FechaVencimiento { get; set; }
        [JsonPropertyName("formaPago")] public int? FormaPago { get; set; }
        [JsonPropertyName("indTraslado")] public int? IndTraslado { get; set; }
    }

    public class CuerpoReceptor
    {
        [JsonPropertyName("rut")] public string Rut { get; set; } = "";
        [JsonPropertyName("razonSocial")] public string RazonSocial { get; set; } = "";
        [JsonPropertyName("giro")] public string? Giro { get; set; }
        [JsonPropertyName("direccion")] public string? Direccion { get; set; }
        [JsonPropertyName("comuna")] public string? Comuna { get; set; }
        [JsonPropertyName("ciudad")] public string? Ciudad { get; set; }
        [JsonPropertyName("correo")] public string? Correo { get; set; }
        [JsonPropertyName("telefono")] public string? Telefono { get; set; }
    }

    public class CuerpoDetalle
    {
        [JsonPropertyName("nombre")] public string Nombre { get; set; } = "";
        [JsonPropertyName("descripcion")] public string? Descripcion { get; set; }
        [JsonPropertyName("codigoItem")] public string? CodigoItem { get; set; }
        [JsonPropertyName("cantidad")] public decimal Cantidad { get; set; }
        [JsonPropertyName("unidad")] public string? Unidad { get; set; }
        [JsonPropertyName("precioUnitario")] public decimal PrecioUnitario { get; set; }
        [JsonPropertyName("descuentoPorcentaje")] public decimal? DescuentoPorcentaje { get; set; }
        [JsonPropertyName("exento")] public bool? Exento { get; set; }
    }

    public class CuerpoDescuentoRecargo
    {
        [JsonPropertyName("tipo")] public string Tipo { get; set; } = "D";
        [JsonPropertyName("glosa")] public string? Glosa { get; set; }
        [JsonPropertyName("tipoValor")] public string TipoValor { get; set; } = "%";
        [JsonPropertyName("valor")] public decimal Valor { get; set; }
        [JsonPropertyName("exento")] public bool? Exento { get; set; }
    }

    public class CuerpoReferencia
    {
        [JsonPropertyName("tipoDocRef")] public string TipoDocRef { get; set; } = "";
        /// <summary>Folio como texto: la API acepta string o número.</summary>
        [JsonPropertyName("folioRef")] public string FolioRef { get; set; } = "";
        [JsonPropertyName("fechaRef")] public string? FechaRef { get; set; }
        [JsonPropertyName("codRef")] public int? CodRef { get; set; }
        [JsonPropertyName("razonRef")] public string? RazonRef { get; set; }
    }

    // ---- Respuestas ----

    public class DocumentoApi
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("tipoDte")] public int TipoDte { get; set; }
        [JsonPropertyName("folio")] public long Folio { get; set; }
        [JsonPropertyName("estado")] public string Estado { get; set; } = "";
        [JsonPropertyName("trackId")] public string? TrackId { get; set; }
        [JsonPropertyName("reparos")] public System.Text.Json.JsonElement? Reparos { get; set; }
        [JsonPropertyName("estadoSii")] public string? EstadoSii { get; set; }
        [JsonPropertyName("glosaSii")] public string? GlosaSii { get; set; }
    }

    public class ResultadoEmision
    {
        public DocumentoApi Documento { get; set; } = new DocumentoApi();
        /// <summary>true si la API devolvió el documento ya emitido (200 + <c>Idempotent-Replayed</c>).</summary>
        public bool Repetido { get; set; }
    }

    public class EnvioApi
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("trackId")] public string? TrackId { get; set; }
        [JsonPropertyName("estado")] public string? Estado { get; set; }
        [JsonPropertyName("documentos")] public List<EnvioDocumentoApi> Documentos { get; set; } = new List<EnvioDocumentoApi>();
    }

    public class EnvioDocumentoApi
    {
        [JsonPropertyName("documentoId")] public string DocumentoId { get; set; } = "";
    }

    public class EnviosRespuesta
    {
        [JsonPropertyName("envios")] public List<EnvioApi> Envios { get; set; } = new List<EnvioApi>();
    }

    public class EstadoConsultado
    {
        [JsonPropertyName("documento")] public DocumentoApi Documento { get; set; } = new DocumentoApi();
        [JsonPropertyName("estadoSii")] public string? EstadoSii { get; set; }
        [JsonPropertyName("glosaSii")] public string? GlosaSii { get; set; }
        [JsonPropertyName("esFinal")] public bool EsFinal { get; set; }
        [JsonPropertyName("descripcionEstado")] public string? DescripcionEstado { get; set; }
    }

    public class PdfDescargado
    {
        public byte[] Contenido { get; set; } = new byte[0];
        public string Nombre { get; set; } = "";
    }
}
