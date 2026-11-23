using System;
using SapB1Addon.Core;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>Metadatos de los formularios de documento de B1 que el add-on maneja.</summary>
    internal static class FormulariosSoportados
    {
        /// <summary>
        /// Tipo de formulario (<c>Form.TypeEx</c>) → ObjType de B1. SUPUESTOS (no verificados sin cliente B1):
        /// 133 = Factura de deudores; 179 = Nota de crédito de deudores; 140 = Entrega;
        /// 60091 = Factura de reserva de deudores (se guarda en OINV, ObjType 13, igual que la entidad
        /// <c>Invoices</c> del worker). 65300 (factura de anticipo de deudores) NO se habilita: es ObjType 203,
        /// que ni el worker ni el núcleo mapean todavía.
        /// </summary>
        public static bool TryObjType(string? formTypeEx, out int objType)
        {
            switch (formTypeEx)
            {
                case "133":
                case "60091":
                    objType = 13;
                    return true;
                case "179":
                    objType = 14;
                    return true;
                case "140":
                    objType = 15;
                    return true;
                default:
                    objType = 0;
                    return false;
            }
        }

        public static string Cabecera(int objType) => objType == 13 ? "OINV" : objType == 14 ? "ORIN" : "ODLN";
        public static string Lineas(int objType) => objType == 13 ? "INV1" : objType == 14 ? "RIN1" : "DLN1";
    }

    /// <summary>
    /// Documento B1 sobre el que actúa el usuario. Si el documento ya está agregado (DocEntry &gt; 0) se lee
    /// de la base con la DI API (fuente de verdad, igual que el worker con Service Layer); si aún no se
    /// agrega (validación previa al "Agregar") se lee del formulario.
    /// </summary>
    internal sealed class DocumentoB1Sap : IDocumentoB1
    {
        private readonly SAPbouiCOM.Form _form;
        private readonly int _objType;
        private readonly LectorDi _di;
        private readonly string _campoGiro;

        public DocumentoB1Sap(SAPbouiCOM.Form form, int objType, LectorDi di, string campoGiro = Udf.Giro)
        {
            _form = form;
            _objType = objType;
            _di = di;
            _campoGiro = campoGiro;
        }

        public CabeceraDocumento LeerCabecera()
        {
            int docEntry = LectorFormulario.DocEntry(_form, _objType);
            return docEntry > 0 && _form.Mode != SAPbouiCOM.BoFormMode.fm_ADD_MODE
                ? _di.LeerDocumento(_objType, docEntry)
                : LectorFormulario.Leer(_form, _objType);
        }

        public SocioNegocio? LeerSocio(string cardCode) => _di.LeerSocio(cardCode, _campoGiro);

        public BaseInfo? LeerBase(int objType, int docEntry) => _di.LeerBase(objType, docEntry);
    }

    /// <summary>Documento ya agregado identificado por su DocEntry (sin formulario): lectura solo por DI API.</summary>
    internal sealed class DocumentoB1PorClave : IDocumentoB1
    {
        private readonly int _objType;
        private readonly int _docEntry;
        private readonly LectorDi _di;
        private readonly string _campoGiro;

        public DocumentoB1PorClave(int objType, int docEntry, LectorDi di, string campoGiro = Udf.Giro)
        {
            _objType = objType;
            _docEntry = docEntry;
            _di = di;
            _campoGiro = campoGiro;
        }

        public CabeceraDocumento LeerCabecera() => _di.LeerDocumento(_objType, _docEntry);

        public SocioNegocio? LeerSocio(string cardCode) => _di.LeerSocio(cardCode, _campoGiro);

        public BaseInfo? LeerBase(int objType, int docEntry) => _di.LeerBase(objType, docEntry);
    }

    /// <summary>
    /// Lectura de un documento aún no agregado desde los DBDataSources del formulario.
    /// SUPUESTOS: tablas OINV/INV1, ORIN/RIN1, ODLN/DLN1; matriz de líneas con UID "38"; campos de línea
    /// <c>PriceBefDi</c> (precio unitario antes de descuento = UnitPrice de Service Layer), <c>PriceAfVAT</c>,
    /// <c>DiscPrcnt</c>, <c>VatGroup</c>, <c>VatPrcnt</c>, <c>unitMsr</c>, <c>FreeTxt</c>, <c>BaseType</c>/<c>BaseEntry</c>.
    /// Los valores de DBDataSource vienen en formato interno (fechas <c>yyyyMMdd</c>, decimales con punto).
    /// </summary>
    internal static class LectorFormulario
    {
        public static int DocEntry(SAPbouiCOM.Form form, int objType)
        {
            var v = Valor(form, FormulariosSoportados.Cabecera(objType), "DocEntry", 0);
            return int.TryParse(v, out var n) ? n : 0;
        }

        public static CabeceraDocumento Leer(SAPbouiCOM.Form form, int objType)
        {
            var tabla = FormulariosSoportados.Cabecera(objType);
            try
            {
                // Vuelca la matriz al DBDataSource de líneas para ver también lo recién tecleado.
                var matriz = (SAPbouiCOM.Matrix)form.Items.Item("38").Specific;
                matriz.FlushToDataSource();
            }
            catch (Exception)
            {
                // Formulario sin matriz "38" (otra localización): se usa el DBDataSource tal como está.
            }

            var c = new CabeceraDocumento
            {
                ObjType = objType,
                DocEntry = DocEntry(form, objType),
                DocNum = int.TryParse(Valor(form, tabla, "DocNum", 0), out var dn) ? dn : (int?)null,
                DocDate = Com.FechaInterna(Valor(form, tabla, "DocDate", 0)),
                DocDueDate = Com.FechaInterna(Valor(form, tabla, "DocDueDate", 0)),
                CardCode = Valor(form, tabla, "CardCode", 0),
                CardName = Valor(form, tabla, "CardName", 0),
                Address = Valor(form, tabla, "Address", 0),
                PayToCode = Valor(form, tabla, "PayToCode", 0),
                PaymentGroupCode = Com.Entero(Valor(form, tabla, "GroupNum", 0)),
                DiscountPercent = Com.Decimal(Valor(form, tabla, "DiscPrcnt", 0)),
                AttachmentEntry = Com.Entero(Valor(form, tabla, "AtcEntry", 0)),
                Comments = Valor(form, tabla, "Comments", 0),
                Address2 = Valor(form, tabla, "Address2", 0),
                // Dirección de entrega (ShipTo): columnas StreetS/StreetNoS/CityS/CountyS de la cabecera (SUPUESTO: sin verificar contra un B1 real).
                EntregaCalle = Valor(form, tabla, "StreetS", 0),
                EntregaNumero = Valor(form, tabla, "StreetNoS", 0),
                EntregaCiudad = Valor(form, tabla, "CityS", 0),
                EntregaComuna = Valor(form, tabla, "CountyS", 0),
                SiiTipoDte = Valor(form, tabla, Udf.TipoDte, 0),
                SiiEstado = Valor(form, tabla, Udf.Estado, 0),
                SiiTrackId = Valor(form, tabla, Udf.TrackId, 0),
                SiiGlosa = Valor(form, tabla, Udf.Glosa, 0),
                SiiDocId = Valor(form, tabla, Udf.DocId, 0),
                SiiXmlUrl = Valor(form, tabla, Udf.XmlUrl, 0),
                SiiPdfUrl = Valor(form, tabla, Udf.PdfUrl, 0),
                SiiIdemKey = Valor(form, tabla, Udf.IdemKey, 0),
                SiiIndTraslado = Valor(form, tabla, Udf.IndTraslado, 0),
                SiiTransporte = Valor(form, tabla, Udf.Transporte, 0),
                SiiCatTraslado = Valor(form, tabla, Udf.CatTraslado, 0),
                SiiDirOrigen = Valor(form, tabla, Udf.DirOrigen, 0),
                SiiCmnaOrigen = Valor(form, tabla, Udf.CmnaOrigen, 0),
                SiiRutTrans = Valor(form, tabla, Udf.RutTrans, 0),
                SiiRutChofer = Valor(form, tabla, Udf.RutChofer, 0),
                SiiNomChofer = Valor(form, tabla, Udf.NomChofer, 0),
                SiiPatente = Valor(form, tabla, Udf.Patente, 0),
                SiiPatenteCarro = Valor(form, tabla, Udf.PatenteCarro, 0),
                SiiFchSalida = Com.FechaInterna(Valor(form, tabla, Udf.FchSalida, 0)),
                SiiHraSalida = Valor(form, tabla, Udf.HraSalida, 0),
                SiiFchLlegada = Com.FechaInterna(Valor(form, tabla, Udf.FchLlegada, 0)),
                SiiCodRef = Valor(form, tabla, Udf.CodRef, 0),
                SiiRazonRef = Valor(form, tabla, Udf.RazonRef, 0),
                SiiTipoDocRef = Valor(form, tabla, Udf.TipoDocRef, 0),
                SiiFolioRef = Valor(form, tabla, Udf.FolioRef, 0),
            };
            var folio = Com.Decimal(Valor(form, tabla, Udf.Folio, 0));
            c.SiiFolio = folio.HasValue && folio.Value > 0 ? (long?)Convert.ToInt64(folio.Value) : null;

            var lineasDs = FormulariosSoportados.Lineas(objType);
            var ds = form.DataSources.DBDataSources.Item(lineasDs);
            for (int i = 0; i < ds.Size; i++)
            {
                var codigo = Valor(form, lineasDs, "ItemCode", i);
                var descripcion = Valor(form, lineasDs, "Dscription", i);
                if (codigo.Length == 0 && descripcion.Length == 0) continue; // fila vacía final de la matriz
                c.Lines.Add(new LineaDocumento
                {
                    LineNum = c.Lines.Count,
                    ItemCode = codigo,
                    ItemDescription = descripcion,
                    FreeText = Valor(form, lineasDs, "FreeTxt", i),
                    Quantity = Com.Decimal(Valor(form, lineasDs, "Quantity", i)) ?? 0,
                    UnitPrice = Com.Decimal(Valor(form, lineasDs, "PriceBefDi", i)),
                    PriceAfterVat = Com.Decimal(Valor(form, lineasDs, "PriceAfVAT", i)),
                    DiscountPercent = Com.Decimal(Valor(form, lineasDs, "DiscPrcnt", i)),
                    TaxCode = Valor(form, lineasDs, "VatGroup", i),
                    TaxPercentagePerRow = Com.Decimal(Valor(form, lineasDs, "VatPrcnt", i)),
                    MeasureUnit = Valor(form, lineasDs, "unitMsr", i),
                    BaseType = Com.Entero(Valor(form, lineasDs, "BaseType", i)),
                    BaseEntry = Com.Entero(Valor(form, lineasDs, "BaseEntry", i)),
                    BaseLine = Com.Entero(Valor(form, lineasDs, "BaseLine", i)),
                });
            }
            return c;
        }

        /// <summary>Valor de un campo del DBDataSource; vacío si el campo no existe (p. ej. un UDF no instalado).</summary>
        public static string Valor(SAPbouiCOM.Form form, string dataSource, string campo, int fila)
        {
            try
            {
                return (form.DataSources.DBDataSources.Item(dataSource).GetValue(campo, fila) ?? "").Trim();
            }
            catch (Exception)
            {
                return "";
            }
        }
    }
}
