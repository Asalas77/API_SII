using System;
using System.Globalization;
using System.Runtime.InteropServices;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>Utilidades para COM (DI API) y conversión de valores de campos de B1.</summary>
    internal static class Com
    {
        /// <summary>Libera objetos COM de la DI API (RCW). Nunca lanza.</summary>
        public static void Liberar(params object?[] objetos)
        {
            foreach (var o in objetos)
            {
                if (o == null) continue;
                try
                {
                    if (Marshal.IsComObject(o)) Marshal.ReleaseComObject(o);
                }
                catch
                {
                    // ya liberado
                }
            }
        }

        public static string Cadena(object? v) => v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim() ?? "";

        public static decimal? Decimal(object? v)
        {
            if (v == null) return null;
            try
            {
                return Convert.ToDecimal(v, CultureInfo.InvariantCulture);
            }
            catch (FormatException)
            {
                return null;
            }
        }

        public static int? Entero(object? v)
        {
            var d = Decimal(v);
            return d.HasValue ? (int?)Convert.ToInt32(d.Value) : null;
        }

        /// <summary>Fecha de un DBDataSource de la UI API: <c>yyyyMMdd</c> (formato interno, independiente de la configuración regional).</summary>
        public static DateTime? FechaInterna(string? v)
        {
            return DateTime.TryParseExact((v ?? "").Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateTime?)null;
        }
    }
}
