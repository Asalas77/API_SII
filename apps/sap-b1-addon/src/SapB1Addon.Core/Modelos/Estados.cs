using System.Collections.Generic;

namespace SapB1Addon.Core.Modelos
{
    /// <summary>Valores de <c>U_SII_Estado</c>. Idénticos a los del worker (<c>apps/sap-b1-worker/src/tipos-b1.ts</c>).</summary>
    public static class EstadoSii
    {
        public const string Pendiente = "PENDIENTE";
        public const string Enviando = "ENVIANDO";
        public const string Emitido = "EMITIDO";
        public const string Enviado = "ENVIADO";
        public const string Aceptado = "ACEPTADO";
        public const string Reparos = "REPAROS";
        public const string Rechazado = "RECHAZADO";
        public const string Error = "ERROR";

        public static readonly IReadOnlyList<string> Todos = new[]
        {
            Pendiente, Enviando, Emitido, Enviado, Aceptado, Reparos, Rechazado, Error,
        };

        /// <summary>Estados en los que el documento ya tiene folio en la API: no puede volver a emitirse.</summary>
        public static bool YaEmitido(string? estado)
        {
            switch ((estado ?? "").Trim())
            {
                case Emitido:
                case Enviado:
                case Aceptado:
                case Reparos:
                case Rechazado:
                    return true;
                default:
                    return false;
            }
        }
    }

    /// <summary>Tipos de DTE admitidos y su relación con el objeto de B1.</summary>
    public static class TiposDte
    {
        public static readonly IReadOnlyList<int> Validos = new[] { 33, 34, 39, 41, 52, 56, 61 };

        public static bool EsBoleta(int tipo) => tipo == 39 || tipo == 41;

        /// <summary>Tipos que admite cada ObjType: 13 factura de deudores, 14 nota de crédito, 15 entrega.</summary>
        public static IReadOnlyList<int> PorObjType(int objType)
        {
            switch (objType)
            {
                case 13: return new[] { 33, 34, 39, 41, 56 };
                case 14: return new[] { 61 };
                case 15: return new[] { 52 };
                default: return new int[0];
            }
        }

        /// <summary>Tipo por defecto de un ObjType (0 si no se conoce).</summary>
        public static int PorDefecto(int objType)
        {
            switch (objType)
            {
                case 13: return 33;
                case 14: return 61;
                case 15: return 52;
                default: return 0;
            }
        }

        public static string NombreEntidad(int objType)
        {
            switch (objType)
            {
                case 13: return "Invoices";
                case 14: return "CreditNotes";
                case 15: return "DeliveryNotes";
                default: return "ObjType " + objType;
            }
        }

        public static string Tabla(int objType)
        {
            switch (objType)
            {
                case 13: return "OINV";
                case 14: return "ORIN";
                case 15: return "ODLN";
                default: return "";
            }
        }
    }

    /// <summary>Nombres de los UDF (<c>U_SII_*</c>) tal como los instala <c>npm run instalar-udfs</c> del worker.</summary>
    public static class Udf
    {
        public const string TipoDte = "U_SII_TipoDTE";
        public const string Estado = "U_SII_Estado";
        public const string Folio = "U_SII_Folio";
        public const string TrackId = "U_SII_TrackId";
        public const string Glosa = "U_SII_Glosa";
        public const string DocId = "U_SII_DocId";
        public const string XmlUrl = "U_SII_XmlUrl";
        public const string PdfUrl = "U_SII_PdfUrl";
        public const string IdemKey = "U_SII_IdemKey";
        public const string IndTraslado = "U_SII_IndTraslado";
        /// <summary>OBSOLETO (texto libre): reemplazado por los UDF estructurados de traslado (Res. Ex. SII 144/2026).</summary>
        public const string Transporte = "U_SII_Transporte";
        public const string CatTraslado = "U_SII_CatTraslado";
        public const string DirOrigen = "U_SII_DirOrigen";
        public const string CmnaOrigen = "U_SII_CmnaOrigen";
        public const string RutTrans = "U_SII_RutTrans";
        public const string RutChofer = "U_SII_RutChofer";
        public const string NomChofer = "U_SII_NomChofer";
        public const string Patente = "U_SII_Patente";
        public const string PatenteCarro = "U_SII_PatenteCarro";
        public const string FchSalida = "U_SII_FchSalida";
        public const string HraSalida = "U_SII_HraSalida";
        public const string FchLlegada = "U_SII_FchLlegada";
        public const string CodRef = "U_SII_CodRef";
        public const string RazonRef = "U_SII_RazonRef";
        public const string TipoDocRef = "U_SII_TipoDocRef";
        public const string FolioRef = "U_SII_FolioRef";
        public const string Giro = "U_SII_Giro";
    }
}
