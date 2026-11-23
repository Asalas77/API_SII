using System.Text.RegularExpressions;

namespace SapB1Addon.Core
{
    /// <summary>Utilidades de RUT chileno (equivalente a <c>rut.ts</c> del worker).</summary>
    public static class Rut
    {
        public const string Generico = "66666666-6";

        /// <summary>Dígito verificador (módulo 11) del cuerpo numérico.</summary>
        public static string CalcularDv(string cuerpo)
        {
            int suma = 0, factor = 2;
            for (int i = cuerpo.Length - 1; i >= 0; i--)
            {
                suma += (cuerpo[i] - '0') * factor;
                factor = factor == 7 ? 2 : factor + 1;
            }
            int resto = 11 - (suma % 11);
            if (resto == 11) return "0";
            if (resto == 10) return "K";
            return resto.ToString();
        }

        /// <summary>Devuelve <c>cuerpo-DV</c> sin puntos ni ceros a la izquierda, o null si el formato o el DV no valen.</summary>
        public static string? Normalizar(string? valor)
        {
            if (string.IsNullOrWhiteSpace(valor)) return null;
            var limpio = Regex.Replace(valor, @"[.\s]", "").ToUpperInvariant();
            var m = Regex.Match(limpio, @"^(\d{1,9})-?([\dK])$");
            if (!m.Success) return null;
            var cuerpo = long.Parse(m.Groups[1].Value).ToString();
            if (cuerpo == "0") return null;
            var dv = m.Groups[2].Value;
            return CalcularDv(cuerpo) == dv ? cuerpo + "-" + dv : null;
        }
    }
}
