using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core
{
    /// <summary>Traducción de estados de la API a <c>U_SII_Estado</c> y glosas (equivale a <c>estadoB1Desde</c> y <c>glosaDeEstado</c> del worker).</summary>
    public static class TraductorEstados
    {
        public const int MaxGlosa = 2000;

        /// <summary>Estado de B1 para el estado de emisión de la API; null si no se reconoce.</summary>
        public static string? Desde(string? estadoApi)
        {
            switch (estadoApi)
            {
                case "emitido":
                case "encolado":
                    return EstadoSii.Emitido;
                case "enviado":
                    return EstadoSii.Enviado;
                case "aceptado":
                    return EstadoSii.Aceptado;
                case "aceptado_con_reparos":
                    return EstadoSii.Reparos;
                case "rechazado":
                case "anulado":
                    return EstadoSii.Rechazado;
                default:
                    return null;
            }
        }

        public static string Acotar(string s, int max = MaxGlosa) => s.Length > max ? s.Substring(0, max - 3) + "..." : s;

        public static string GlosaDeEstado(DocumentoApi d, string? glosaSii, string? descripcion, string? estadoSii)
        {
            var partes = new List<string>();
            if (d.Estado == "anulado") partes.Add("Anulado en el SII");
            var baseTxt = !string.IsNullOrEmpty(glosaSii) ? glosaSii! : (descripcion ?? "");
            if (!string.IsNullOrEmpty(estadoSii) || baseTxt.Length > 0)
                partes.Add(string.Join(": ", new[] { estadoSii, baseTxt }.Where(x => !string.IsNullOrEmpty(x))));
            if (d.Reparos.HasValue && d.Reparos.Value.ValueKind != JsonValueKind.Null && d.Reparos.Value.ValueKind != JsonValueKind.Undefined)
            {
                var rep = d.Reparos.Value;
                var texto = rep.ValueKind == JsonValueKind.String ? rep.GetString() ?? "" : rep.GetRawText();
                if (texto.Length > 0) partes.Add("Reparos: " + texto);
            }
            return Acotar(string.Join("\n", partes));
        }
    }

    /// <summary>Clave de idempotencia determinista por empresa + tipo de objeto + DocEntry. Idéntica a la del worker.</summary>
    public static class ClaveIdempotencia
    {
        public static string De(string rutEmpresaNormalizado, int objType, int docEntry) =>
            "b1:" + rutEmpresaNormalizado + ":" + objType + ":" + docEntry;
    }
}
