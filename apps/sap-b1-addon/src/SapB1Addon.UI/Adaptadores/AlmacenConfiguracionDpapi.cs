using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SapB1Addon.Core;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>
    /// Guarda la configuración en el perfil del usuario de Windows (<c>%APPDATA%\SapB1Addon</c>):
    /// los datos no secretos en JSON y la API key cifrada con DPAPI (<see cref="ProtectedData"/>,
    /// ámbito CurrentUser). La clave nunca se guarda en texto plano ni en una tabla de B1: solo el
    /// mismo usuario de Windows, en el mismo equipo, puede descifrarla. Un archivo por company de B1.
    /// </summary>
    internal sealed class AlmacenConfiguracionDpapi : IAlmacenConfiguracion
    {
        // Entropía adicional fija del add-on: otro programa del mismo usuario no descifra por accidente.
        private static readonly byte[] Entropia = Encoding.UTF8.GetBytes("SapB1Addon.SII.ApiKey.v1");

        private readonly string _carpeta;
        private readonly string _rutaJson;
        private readonly string _rutaClave;

        public AlmacenConfiguracionDpapi(string companyDb, string? carpetaBase = null)
        {
            var seguro = new string((companyDb ?? "").Where(c => char.IsLetterOrDigit(c) || c == '_' || c == '-').ToArray());
            if (seguro.Length == 0) seguro = "default";
            _carpeta = carpetaBase ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SapB1Addon");
            _rutaJson = Path.Combine(_carpeta, "config." + seguro + ".json");
            _rutaClave = Path.Combine(_carpeta, "apikey." + seguro + ".bin");
        }

        public ConfiguracionAddon Cargar()
        {
            var c = new ConfiguracionAddon();
            if (File.Exists(_rutaJson))
            {
                var leida = JsonSerializer.Deserialize<ConfiguracionAddon>(File.ReadAllText(_rutaJson, Encoding.UTF8));
                if (leida != null) c = leida;
            }
            if (File.Exists(_rutaClave))
            {
                try
                {
                    var plano = ProtectedData.Unprotect(File.ReadAllBytes(_rutaClave), Entropia, DataProtectionScope.CurrentUser);
                    c.ApiKey = Encoding.UTF8.GetString(plano);
                    Array.Clear(plano, 0, plano.Length);
                }
                catch (CryptographicException)
                {
                    // Otro usuario/equipo o archivo dañado: se pide la clave de nuevo.
                    c.ApiKey = "";
                }
            }
            return c;
        }

        public void Guardar(ConfiguracionAddon configuracion)
        {
            Directory.CreateDirectory(_carpeta);
            // ApiKey tiene [JsonIgnore]: el JSON nunca la contiene.
            File.WriteAllText(_rutaJson, JsonSerializer.Serialize(configuracion, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
            if (string.IsNullOrEmpty(configuracion.ApiKey))
            {
                if (File.Exists(_rutaClave)) File.Delete(_rutaClave);
                return;
            }
            var plano = Encoding.UTF8.GetBytes(configuracion.ApiKey);
            try
            {
                File.WriteAllBytes(_rutaClave, ProtectedData.Protect(plano, Entropia, DataProtectionScope.CurrentUser));
            }
            finally
            {
                Array.Clear(plano, 0, plano.Length);
            }
        }
    }
}
