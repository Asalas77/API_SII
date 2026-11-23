using System;
using System.Collections.Generic;

namespace SapB1Addon.Core.Modelos
{
    public class LineaDocumento
    {
        public int LineNum { get; set; }
        public string? ItemCode { get; set; }
        public string? ItemDescription { get; set; }
        public string? FreeText { get; set; }
        public decimal Quantity { get; set; }
        /// <summary>Precio neto (antes de impuestos).</summary>
        public decimal? UnitPrice { get; set; }
        /// <summary>Precio con impuestos incluidos.</summary>
        public decimal? PriceAfterVat { get; set; }
        public decimal? DiscountPercent { get; set; }
        public string? TaxCode { get; set; }
        public decimal? TaxPercentagePerRow { get; set; }
        public string? MeasureUnit { get; set; }
        public string? UoMCode { get; set; }
        /// <summary>ObjType del documento base (-1 o 0 si la línea no se copió de otro documento).</summary>
        public int? BaseType { get; set; }
        public int? BaseEntry { get; set; }
        public int? BaseLine { get; set; }
    }

    /// <summary>Cabecera de un documento de marketing (OINV, ORIN, ODLN) con sus UDF <c>U_SII_*</c>.</summary>
    public class CabeceraDocumento
    {
        /// <summary>13 factura de deudores, 14 nota de crédito, 15 entrega.</summary>
        public int ObjType { get; set; }
        /// <summary>0 mientras el documento no se ha agregado (validación previa al "Agregar").</summary>
        public int DocEntry { get; set; }
        public int? DocNum { get; set; }
        public DateTime? DocDate { get; set; }
        public DateTime? DocDueDate { get; set; }
        public string CardCode { get; set; } = "";
        public string? CardName { get; set; }
        public string? Address { get; set; }
        public string? PayToCode { get; set; }
        public int? PaymentGroupCode { get; set; }
        /// <summary>Descuento de cabecera (%).</summary>
        public decimal? DiscountPercent { get; set; }
        public int? AttachmentEntry { get; set; }
        public List<LineaDocumento> Lines { get; set; } = new List<LineaDocumento>();

        // UDF (mismos nombres que el worker; ver clase Udf).
        public string? SiiTipoDte { get; set; }
        public string? SiiEstado { get; set; }
        public long? SiiFolio { get; set; }
        public string? SiiTrackId { get; set; }
        public string? SiiGlosa { get; set; }
        public string? SiiDocId { get; set; }
        public string? SiiXmlUrl { get; set; }
        public string? SiiPdfUrl { get; set; }
        public string? SiiIdemKey { get; set; }
        public string? SiiIndTraslado { get; set; }
        public string? SiiTransporte { get; set; }
        public string? SiiCodRef { get; set; }
        public string? SiiRazonRef { get; set; }
        public string? SiiTipoDocRef { get; set; }
        public string? SiiFolioRef { get; set; }
    }

    public class DireccionSocio
    {
        public string? AddressName { get; set; }
        /// <summary>"bo_BillTo" (facturación) o "bo_ShipTo"; vacío se trata como facturación.</summary>
        public string? AddressType { get; set; }
        public string? Street { get; set; }
        public string? StreetNo { get; set; }
        public string? City { get; set; }
        /// <summary>En la localización Chile se usa como comuna (supuesto, igual que el worker).</summary>
        public string? County { get; set; }
    }

    public class SocioNegocio
    {
        public string CardCode { get; set; } = "";
        public string? CardName { get; set; }
        /// <summary>RUT del socio (<c>OCRD.LicTradNum</c>).</summary>
        public string? LicTradNum { get; set; }
        /// <summary>Giro (UDF <c>U_SII_Giro</c> u otro campo configurado por el adaptador).</summary>
        public string? Giro { get; set; }
        public string? EmailAddress { get; set; }
        public string? Phone1 { get; set; }
        public List<DireccionSocio> Direcciones { get; set; } = new List<DireccionSocio>();
    }

    /// <summary>Datos del documento base necesarios para armar referencias (notas 61/56).</summary>
    public class BaseInfo
    {
        public int ObjType { get; set; }
        public int DocEntry { get; set; }
        public DateTime? DocDate { get; set; }
        public long? Folio { get; set; }
        public int? TipoDte { get; set; }
    }
}
