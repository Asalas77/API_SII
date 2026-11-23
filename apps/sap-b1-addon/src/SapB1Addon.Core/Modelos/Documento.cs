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
        /// <summary>Moneda de la línea; en un documento en moneda extranjera debe ser la del documento.</summary>
        public string? Currency { get; set; }
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
        /// <summary>Moneda del documento (código de B1, p. ej. USD); en exportación es la moneda de la operación.</summary>
        public string? DocCurrency { get; set; }
        /// <summary>Tipo de cambio del documento (pesos por unidad de <see cref="DocCurrency"/>).</summary>
        public decimal? DocRate { get; set; }
        /// <summary>Total del documento en su moneda (informativo: se contrasta con el calculado).</summary>
        public decimal? DocTotalFc { get; set; }
        public string? Comments { get; set; }
        /// <summary>Dirección de entrega en texto libre (<c>Address2</c>).</summary>
        public string? Address2 { get; set; }
        /// <summary>Dirección de entrega estructurada (<c>AddressExtension.ShipTo*</c>; <c>ShipToCounty</c> = comuna, supuesto).</summary>
        public string? EntregaCalle { get; set; }
        public string? EntregaNumero { get; set; }
        public string? EntregaComuna { get; set; }
        public string? EntregaCiudad { get; set; }
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
        /// <summary>OBSOLETO: texto libre; se conserva como metadato en <c>origen.transporte</c>.</summary>
        public string? SiiTransporte { get; set; }
        /// <summary>AUTOGESTIONADO | TERCERIZADO | REGIMEN_ESPECIAL (Res. Ex. SII 144/2026).</summary>
        public string? SiiCatTraslado { get; set; }
        public string? SiiDirOrigen { get; set; }
        public string? SiiCmnaOrigen { get; set; }
        public string? SiiRutTrans { get; set; }
        public string? SiiRutChofer { get; set; }
        public string? SiiNomChofer { get; set; }
        public string? SiiPatente { get; set; }
        public string? SiiPatenteCarro { get; set; }
        public DateTime? SiiFchSalida { get; set; }
        /// <summary>HH:MM o HH:MM:SS.</summary>
        public string? SiiHraSalida { get; set; }
        public DateTime? SiiFchLlegada { get; set; }
        public string? SiiCodRef { get; set; }
        public string? SiiRazonRef { get; set; }
        public string? SiiTipoDocRef { get; set; }
        public string? SiiFolioRef { get; set; }
        // Exportación (110-112): códigos de Aduana en texto; el mapeo valida el formato y la API las tablas.
        public string? SiiModVenta { get; set; }
        public string? SiiClausulaVenta { get; set; }
        /// <summary>Total de la cláusula de venta en la moneda del documento (por defecto <see cref="DocTotalFc"/>).</summary>
        public string? SiiTotClausula { get; set; }
        public string? SiiViaTransp { get; set; }
        public string? SiiPtoEmbarque { get; set; }
        public string? SiiPtoDesemb { get; set; }
        public string? SiiPaisReceptor { get; set; }
        public string? SiiPaisDestino { get; set; }
        public string? SiiTotBultos { get; set; }
        public string? SiiTipoBulto { get; set; }
        public string? SiiFormaPagoExp { get; set; }
        /// <summary>3 a 6 si la exportación es de servicios; vacío para bienes.</summary>
        public string? SiiIndServicio { get; set; }
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
