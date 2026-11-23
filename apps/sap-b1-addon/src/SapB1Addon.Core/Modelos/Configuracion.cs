using System.Collections.Generic;

namespace SapB1Addon.Core.Modelos
{
    /// <summary>
    /// Configuración del add-on. <see cref="ApiKey"/> es un secreto: nunca se imprime ni se registra
    /// (<see cref="ToString"/> la oculta) y el almacén de la capa SAP la guarda cifrada con DPAPI.
    /// </summary>
    public class ConfiguracionAddon
    {
        /// <summary>Base de la API sin <c>/v1</c> (p. ej. <c>https://api.midominio.cl</c>).</summary>
        public string ApiUrl { get; set; } = "";
        /// <summary>RUT emisor en la API (con o sin puntos).</summary>
        public string RutEmpresa { get; set; } = "";
        /// <summary>Secreto. [JsonIgnore]: ninguna serialización de la configuración puede incluirlo.</summary>
        [System.Text.Json.Serialization.JsonIgnore]
        public string ApiKey { get; set; } = "";
        /// <summary><c>TaxCode</c> tratados como exentos (igual que B1_CODIGOS_EXENTOS del worker).</summary>
        public List<string> CodigosExentos { get; set; } = new List<string> { "IVA_EXE", "EXE" };
        /// <summary><c>PaymentGroupCode</c> de pago contado (B1_GRUPOS_PAGO_CONTADO del worker).</summary>
        public List<int> GruposPagoContado { get; set; } = new List<int> { -1 };
        /// <summary>Si es true, tras emitir se dispara también el envío al SII. Si el worker corre con ENVIAR_AUTOMATICAMENTE=true puede dejarse en false.</summary>
        public bool EnviarAlEmitir { get; set; }
        /// <summary>Emitir automáticamente tras agregar un documento marcado PENDIENTE (FormDataEvent ADD, AfterAction). Por defecto false: el usuario pulsa Emitir.</summary>
        public bool EmitirAlAgregar { get; set; }
        /// <summary>Adjuntar el PDF al documento de B1 tras emitir (opcional, como el worker).</summary>
        public bool AdjuntarPdf { get; set; } = true;
        /// <summary>Exigir giro, dirección y comuna del receptor en facturas 33/34 (el worker solo advierte).</summary>
        public bool ExigirDatosReceptor { get; set; } = true;
        public int TimeoutSegundos { get; set; } = 30;
        /// <summary>Código de la moneda local de B1: una exportación debe emitirse en otra moneda (B1_MONEDA_LOCAL del worker).</summary>
        public string MonedaLocal { get; set; } = "CLP";
        /// <summary>Código de moneda de B1 -> glosa de moneda del SII, adicional a la tabla incorporada (B1_MONEDAS_SII del worker).</summary>
        public Dictionary<string, string> MonedasSii { get; set; } = new Dictionary<string, string>();

        public override string ToString() =>
            "ConfiguracionAddon { ApiUrl = " + ApiUrl + ", RutEmpresa = " + RutEmpresa + ", ApiKey = " +
            (string.IsNullOrEmpty(ApiKey) ? "(vacía)" : "***") + " }";
    }
}
