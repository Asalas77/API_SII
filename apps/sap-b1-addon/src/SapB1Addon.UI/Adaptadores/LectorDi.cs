using System;
using System.Collections.Generic;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>Lee documentos guardados, socios de negocios y documentos base con la DI API.</summary>
    internal sealed class LectorDi
    {
        private readonly ConexionDi _di;

        public LectorDi(ConexionDi di)
        {
            _di = di;
        }

        /// <summary>Cabecera y líneas de un documento ya agregado. Los nombres equivalen a los de Service Layer que usa el worker.</summary>
        public CabeceraDocumento LeerDocumento(int objType, int docEntry)
        {
            var doc = (SAPbobsCOM.Documents)_di.Company.GetBusinessObject(_di.TipoDocumento(objType));
            try
            {
                if (!doc.GetByKey(docEntry)) throw new InvalidOperationException("No existe el documento (ObjType " + objType + ", DocEntry " + docEntry + ").");
                var c = new CabeceraDocumento
                {
                    ObjType = objType,
                    DocEntry = docEntry,
                    DocNum = doc.DocNum,
                    DocDate = doc.DocDate,
                    DocDueDate = doc.DocDueDate,
                    CardCode = doc.CardCode ?? "",
                    CardName = doc.CardName,
                    Address = doc.Address,
                    PayToCode = doc.PayToCode,
                    PaymentGroupCode = doc.PaymentGroupCode,
                    DiscountPercent = Com.Decimal(doc.DiscountPercent),
                    AttachmentEntry = doc.AttachmentEntry,
                    Comments = doc.Comments,
                    Address2 = doc.Address2,
                };
                LeerEntrega(doc, c);
                LeerUdf(doc, c);

                var lineas = doc.Lines;
                try
                {
                    for (int i = 0; i < lineas.Count; i++)
                    {
                        lineas.SetCurrentLine(i);
                        c.Lines.Add(new LineaDocumento
                        {
                            LineNum = lineas.LineNum,
                            ItemCode = lineas.ItemCode,
                            ItemDescription = lineas.ItemDescription,
                            FreeText = lineas.FreeText,
                            Quantity = Com.Decimal(lineas.Quantity) ?? 0,
                            UnitPrice = Com.Decimal(lineas.UnitPrice),
                            PriceAfterVat = Com.Decimal(lineas.PriceAfterVAT),
                            DiscountPercent = Com.Decimal(lineas.DiscountPercent),
                            TaxCode = lineas.TaxCode,
                            TaxPercentagePerRow = Com.Decimal(lineas.TaxPercentagePerRow),
                            MeasureUnit = lineas.MeasureUnit,
                            BaseType = lineas.BaseType,
                            BaseEntry = lineas.BaseEntry,
                            BaseLine = lineas.BaseLine,
                        });
                    }
                }
                finally
                {
                    Com.Liberar(lineas);
                }
                return c;
            }
            finally
            {
                Com.Liberar(doc);
            }
        }

        private static void LeerUdf(SAPbobsCOM.Documents doc, CabeceraDocumento c)
        {
            var campos = doc.UserFields.Fields;
            try
            {
                c.SiiTipoDte = TextoUdf(campos, Core.Modelos.Udf.TipoDte);
                c.SiiEstado = TextoUdf(campos, Core.Modelos.Udf.Estado);
                var folio = Com.Decimal(Valor(campos, Core.Modelos.Udf.Folio));
                c.SiiFolio = folio.HasValue && folio.Value > 0 ? (long?)Convert.ToInt64(folio.Value) : null;
                c.SiiTrackId = TextoUdf(campos, Core.Modelos.Udf.TrackId);
                c.SiiGlosa = TextoUdf(campos, Core.Modelos.Udf.Glosa);
                c.SiiDocId = TextoUdf(campos, Core.Modelos.Udf.DocId);
                c.SiiXmlUrl = TextoUdf(campos, Core.Modelos.Udf.XmlUrl);
                c.SiiPdfUrl = TextoUdf(campos, Core.Modelos.Udf.PdfUrl);
                c.SiiIdemKey = TextoUdf(campos, Core.Modelos.Udf.IdemKey);
                c.SiiIndTraslado = TextoUdf(campos, Core.Modelos.Udf.IndTraslado);
                c.SiiTransporte = TextoUdf(campos, Core.Modelos.Udf.Transporte);
                c.SiiCatTraslado = TextoUdf(campos, Core.Modelos.Udf.CatTraslado);
                c.SiiDirOrigen = TextoUdf(campos, Core.Modelos.Udf.DirOrigen);
                c.SiiCmnaOrigen = TextoUdf(campos, Core.Modelos.Udf.CmnaOrigen);
                c.SiiRutTrans = TextoUdf(campos, Core.Modelos.Udf.RutTrans);
                c.SiiRutChofer = TextoUdf(campos, Core.Modelos.Udf.RutChofer);
                c.SiiNomChofer = TextoUdf(campos, Core.Modelos.Udf.NomChofer);
                c.SiiPatente = TextoUdf(campos, Core.Modelos.Udf.Patente);
                c.SiiPatenteCarro = TextoUdf(campos, Core.Modelos.Udf.PatenteCarro);
                c.SiiFchSalida = FechaUdf(campos, Core.Modelos.Udf.FchSalida);
                c.SiiHraSalida = TextoUdf(campos, Core.Modelos.Udf.HraSalida);
                c.SiiFchLlegada = FechaUdf(campos, Core.Modelos.Udf.FchLlegada);
                c.SiiCodRef = TextoUdf(campos, Core.Modelos.Udf.CodRef);
                c.SiiRazonRef = TextoUdf(campos, Core.Modelos.Udf.RazonRef);
                c.SiiTipoDocRef = TextoUdf(campos, Core.Modelos.Udf.TipoDocRef);
                c.SiiFolioRef = TextoUdf(campos, Core.Modelos.Udf.FolioRef);
            }
            finally
            {
                Com.Liberar(campos);
            }
        }

        private static object? Valor(SAPbobsCOM.Fields campos, string nombre)
        {
            SAPbobsCOM.Field? f = null;
            try
            {
                f = campos.Item(nombre);
                return f.Value;
            }
            catch (System.Runtime.InteropServices.COMException)
            {
                // El UDF no existe en esta tabla (p. ej. U_SII_IndTraslado en facturas): se trata como vacío.
                return null;
            }
            finally
            {
                Com.Liberar(f);
            }
        }

        private static string TextoUdf(SAPbobsCOM.Fields campos, string nombre) => Com.Cadena(Valor(campos, nombre));

        /// <summary>UDF de fecha: la DI API devuelve DateTime; una fecha vacía llega como 1899-12-30 o menor a 2000 y se trata como ausente.</summary>
        private static DateTime? FechaUdf(SAPbobsCOM.Fields campos, string nombre)
        {
            var v = Valor(campos, nombre);
            if (v is DateTime d && d.Year >= 2000) return d.Date;
            return null;
        }

        /// <summary>Dirección de entrega estructurada (<c>AddressExtension.ShipTo*</c>); ShipToCounty = comuna (supuesto).</summary>
        private static void LeerEntrega(SAPbobsCOM.Documents doc, CabeceraDocumento c)
        {
            SAPbobsCOM.AddressExtension? ext = null;
            try
            {
                ext = doc.AddressExtension;
                c.EntregaCalle = ext.ShipToStreet;
                c.EntregaNumero = ext.ShipToStreetNo;
                c.EntregaCiudad = ext.ShipToCity;
                c.EntregaComuna = ext.ShipToCounty;
            }
            catch (System.Runtime.InteropServices.COMException)
            {
                // Documento sin extensión de dirección: el destino queda vacío y el validador lo informa.
            }
            finally
            {
                Com.Liberar(ext);
            }
        }

        /// <summary>Socio de negocios (RUT, giro, correo, teléfono y direcciones); null si no existe.</summary>
        public SocioNegocio? LeerSocio(string cardCode, string campoGiro)
        {
            var bp = (SAPbobsCOM.BusinessPartners)_di.Company.GetBusinessObject(SAPbobsCOM.BoObjectTypes.oBusinessPartners);
            try
            {
                if (!bp.GetByKey(cardCode)) return null;
                var s = new SocioNegocio
                {
                    CardCode = cardCode,
                    CardName = bp.CardName,
                    LicTradNum = bp.FederalTaxID,
                    EmailAddress = bp.EmailAddress,
                    Phone1 = bp.Phone1,
                };
                var campos = bp.UserFields.Fields;
                try
                {
                    s.Giro = Com.Cadena(Valor(campos, campoGiro));
                }
                finally
                {
                    Com.Liberar(campos);
                }
                var dirs = bp.Addresses;
                try
                {
                    for (int i = 0; i < dirs.Count; i++)
                    {
                        dirs.SetCurrentLine(i);
                        s.Direcciones.Add(new DireccionSocio
                        {
                            AddressName = dirs.AddressName,
                            AddressType = dirs.AddressType == SAPbobsCOM.BoAddressType.bo_BillTo ? "bo_BillTo" : "bo_ShipTo",
                            Street = dirs.Street,
                            StreetNo = dirs.StreetNo,
                            City = dirs.City,
                            County = dirs.County,
                        });
                    }
                }
                finally
                {
                    Com.Liberar(dirs);
                }
                return s;
            }
            finally
            {
                Com.Liberar(bp);
            }
        }

        /// <summary>Folio, tipo y fecha del documento base (consulta de solo lectura con enteros: sin riesgo de inyección).</summary>
        public BaseInfo? LeerBase(int objType, int docEntry)
        {
            string tabla;
            switch (objType)
            {
                case 13: tabla = "OINV"; break;
                case 14: tabla = "ORIN"; break;
                case 15: tabla = "ODLN"; break;
                default: return null;
            }
            var rs = (SAPbobsCOM.Recordset)_di.Company.GetBusinessObject(SAPbobsCOM.BoObjectTypes.BoRecordset);
            try
            {
                // Comillas dobles: obligatorias en HANA y válidas en SQL Server (QUOTED_IDENTIFIER ON).
                rs.DoQuery("SELECT \"DocDate\", \"U_SII_Folio\", \"U_SII_TipoDTE\" FROM \"" + tabla + "\" WHERE \"DocEntry\" = " + docEntry.ToString(System.Globalization.CultureInfo.InvariantCulture));
                if (rs.EoF) return null;
                var folio = Com.Decimal(rs.Fields.Item("U_SII_Folio").Value);
                var tipo = Com.Cadena(rs.Fields.Item("U_SII_TipoDTE").Value);
                return new BaseInfo
                {
                    ObjType = objType,
                    DocEntry = docEntry,
                    DocDate = rs.Fields.Item("DocDate").Value as DateTime?,
                    Folio = folio.HasValue && folio.Value > 0 ? (long?)Convert.ToInt64(folio.Value) : null,
                    TipoDte = int.TryParse(tipo, out var t) ? t : (int?)null,
                };
            }
            finally
            {
                Com.Liberar(rs);
            }
        }
    }
}
