using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core
{
    public class ContextoMapeo
    {
        public ConfiguracionAddon Config { get; set; } = new ConfiguracionAddon();
        /// <summary>Socio de negocios ya leído; null si no se pudo leer.</summary>
        public SocioNegocio? Socio { get; set; }
        /// <summary>Documentos base ya leídos, por <see cref="MapeadorDocumento.ClaveBase"/>.</summary>
        public IReadOnlyDictionary<string, BaseInfo> Bases { get; set; } = new Dictionary<string, BaseInfo>();
    }

    public class ResultadoMapeo
    {
        public bool Ok => Errores.Count == 0;
        public CuerpoDocumento? Cuerpo { get; set; }
        public int TipoDte { get; set; }
        public List<string> Errores { get; } = new List<string>();
        public List<string> Advertencias { get; } = new List<string>();
    }

    /// <summary>
    /// Convierte un documento de B1 en el cuerpo de emisión de la API. Es un port 1:1 de
    /// <c>apps/sap-b1-worker/src/mapeador.ts</c>: si difieren, manda el del worker. Función pura:
    /// todo lo que requiere E/S (socio, documentos base) llega ya leído en el contexto.
    /// </summary>
    public static class MapeadorDocumento
    {
        public const int MaxLineasDte = 60;
        public const int MaxLineasBoleta = 1000;

        public static string ClaveBase(int objType, int docEntry) => objType + ":" + docEntry;

        private static string Trunc(string? v, int max)
        {
            var t = (v ?? "").Trim();
            return t.Length > max ? t.Substring(0, max) : t;
        }

        private static string Fecha(DateTime? d) => d.HasValue ? d.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "";

        private static decimal Redondear(decimal n, int dec) => Math.Round(n, dec, MidpointRounding.AwayFromZero);

        /// <summary>Documentos base (BaseType/BaseEntry) que referencian las líneas, sin repetir y en orden.</summary>
        public static List<KeyValuePair<int, int>> BasesDe(CabeceraDocumento doc)
        {
            var vistos = new HashSet<string>();
            var salida = new List<KeyValuePair<int, int>>();
            foreach (var l in doc.Lines)
            {
                if (l.BaseType.HasValue && l.BaseType.Value > 0 && l.BaseEntry.HasValue)
                {
                    if (vistos.Add(ClaveBase(l.BaseType.Value, l.BaseEntry.Value)))
                        salida.Add(new KeyValuePair<int, int>(l.BaseType.Value, l.BaseEntry.Value));
                }
            }
            return salida;
        }

        /// <summary>Si el documento necesita leer documentos base (notas 61 y 56).</summary>
        public static bool RequiereBases(CabeceraDocumento doc) =>
            doc.ObjType == 14 || (doc.SiiTipoDte ?? "").Trim() == "56";

        /// <summary>Tipo de DTE: <c>U_SII_TipoDTE</c> si está, o el derivado (OINV 33/34, ORIN 61, ODLN 52).</summary>
        public static bool ResolverTipo(CabeceraDocumento doc, Func<LineaDocumento, bool> esExenta, out int tipo, out string? error)
        {
            tipo = 0;
            error = null;
            var crudo = (doc.SiiTipoDte ?? "").Trim();
            var entidad = TiposDte.NombreEntidad(doc.ObjType);
            var permitidos = TiposDte.PorObjType(doc.ObjType);
            if (permitidos.Count == 0)
            {
                error = "El add-on no maneja el ObjType " + doc.ObjType + " (solo 13, 14 y 15)";
                return false;
            }
            if (crudo.Length > 0)
            {
                if (!int.TryParse(crudo, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || !TiposDte.Validos.Contains(n))
                {
                    error = "U_SII_TipoDTE \"" + crudo + "\" no es un tipo válido (" + string.Join(", ", TiposDte.Validos) + ")";
                    return false;
                }
                if (!permitidos.Contains(n))
                {
                    error = "U_SII_TipoDTE " + n + " no corresponde a " + entidad + " (admite " + string.Join(", ", permitidos) + ")";
                    return false;
                }
                tipo = n;
                return true;
            }
            if (doc.ObjType == 13 && doc.Lines.Count > 0 && doc.Lines.All(esExenta))
            {
                tipo = 34;
                return true;
            }
            tipo = TiposDte.PorDefecto(doc.ObjType);
            return true;
        }

        public static ResultadoMapeo Mapear(CabeceraDocumento doc, ContextoMapeo ctx)
        {
            var r = new ResultadoMapeo();
            var errores = r.Errores;
            var exentos = new HashSet<string>(ctx.Config.CodigosExentos.Select(x => x.Trim()));
            Func<LineaDocumento, bool> esExenta = l => exentos.Contains((l.TaxCode ?? "").Trim());
            var lineasB1 = doc.Lines;

            if (!ResolverTipo(doc, esExenta, out var tipo, out var errTipo))
            {
                errores.Add(errTipo!);
                return r;
            }
            r.TipoDte = tipo;
            bool boleta = TiposDte.EsBoleta(tipo);

            // Fechas
            var fechaEmision = Fecha(doc.DocDate);
            if (fechaEmision.Length == 0) errores.Add("DocDate inválida (el documento no tiene fecha de contabilización)");

            // Líneas
            if (lineasB1.Count == 0) errores.Add("El documento no tiene líneas");
            int max = boleta ? MaxLineasBoleta : MaxLineasDte;
            if (lineasB1.Count > max)
                errores.Add("El tipo " + tipo + " admite como máximo " + max + " líneas (el documento tiene " + lineasB1.Count + ")");
            bool hayAfecta = lineasB1.Any(l => !esExenta(l));
            bool hayExenta = lineasB1.Any(esExenta);
            if ((tipo == 33 || tipo == 39) && lineasB1.Count > 0 && !hayAfecta)
                errores.Add("El tipo " + tipo + " requiere al menos un ítem afecto; para ventas exentas use " + (tipo == 33 ? 34 : 41));
            if ((tipo == 34 || tipo == 41) && hayAfecta)
                errores.Add("El tipo " + tipo + " solo admite ítems exentos (códigos de impuesto exentos: " +
                            (exentos.Count > 0 ? string.Join(", ", exentos) : "ninguno configurado") + ")");

            var detalle = new List<CuerpoDetalle>();
            for (int i = 0; i < lineasB1.Count; i++)
            {
                var l = lineasB1[i];
                var rf = "Línea " + (l.LineNum + 1);
                if (!(l.Quantity > 0))
                {
                    errores.Add(rf + ": la cantidad debe ser mayor que 0");
                    continue;
                }
                bool exenta = esExenta(l);
                decimal? precio;
                if (boleta)
                {
                    // Boletas: precios con IVA incluido.
                    precio = l.PriceAfterVat;
                    if (precio == null)
                    {
                        var neto = l.UnitPrice;
                        precio = neto == null ? null : exenta ? neto : Redondear(neto.Value * (1 + (l.TaxPercentagePerRow ?? 0) / 100m), 2);
                    }
                }
                else
                {
                    precio = l.UnitPrice;
                }
                if (precio == null || !(precio >= 0))
                {
                    errores.Add(rf + ": sin precio unitario válido");
                    continue;
                }
                var texto = (l.ItemDescription ?? "").Trim();
                if (texto.Length == 0) texto = (l.ItemCode ?? "").Trim();
                if (texto.Length == 0)
                {
                    errores.Add(rf + ": sin descripción ni código de artículo");
                    continue;
                }
                var d = new CuerpoDetalle
                {
                    Nombre = texto.Length > 80 ? texto.Substring(0, 80) : texto,
                    Cantidad = l.Quantity,
                    PrecioUnitario = precio.Value,
                };
                var extra = texto.Length > 80 ? texto : (l.FreeText ?? "").Trim();
                if (extra.Length > 0) d.Descripcion = extra.Length > 1000 ? extra.Substring(0, 1000) : extra;
                var codigo = Trunc(l.ItemCode, 35);
                if (codigo.Length > 0) d.CodigoItem = codigo;
                var unidad = Trunc(l.MeasureUnit ?? l.UoMCode, 4);
                if (unidad.Length > 0) d.Unidad = unidad;
                var desc = l.DiscountPercent ?? 0;
                if (desc > 0) d.DescuentoPorcentaje = Math.Min(desc, 100);
                if (exenta || tipo == 34 || tipo == 41) d.Exento = true;
                detalle.Add(d);
            }

            // Receptor
            CuerpoReceptor? receptor = null;
            var socio = ctx.Socio;
            var rutCrudo = (socio?.LicTradNum ?? "").Trim();
            var rutNorm = Rut.Normalizar(rutCrudo);
            if (socio == null)
            {
                errores.Add("No se pudo leer el socio de negocios " + doc.CardCode);
            }
            else if (boleta && (rutCrudo.Length == 0 || rutNorm == Rut.Generico))
            {
                receptor = null; // consumidor final: la API usa 66666666-6
            }
            else if (rutCrudo.Length == 0)
            {
                errores.Add("El socio " + doc.CardCode + " no tiene RUT (LicTradNum)");
            }
            else if (rutNorm == null)
            {
                errores.Add("RUT del receptor inválido (dígito verificador o formato): \"" + rutCrudo + "\"");
            }
            else if (rutNorm == Rut.Generico && !boleta)
            {
                errores.Add("El RUT genérico 66666666-6 solo es válido en boletas");
            }
            else
            {
                var razon = Trunc(doc.CardName ?? socio.CardName, 100);
                if (razon.Length == 0) errores.Add("El socio " + doc.CardCode + " no tiene nombre (CardName)");
                receptor = new CuerpoReceptor { Rut = rutNorm, RazonSocial = razon };
                var giro = Trunc(socio.Giro, 40);
                if (giro.Length > 0) receptor.Giro = giro;
                else if (!boleta) r.Advertencias.Add("El socio " + doc.CardCode + " no informa giro (" + Udf.Giro + ")");
                var dir = DireccionDe(socio, doc);
                if (dir.Direccion.Length > 0) receptor.Direccion = dir.Direccion;
                if (dir.Comuna.Length > 0) receptor.Comuna = dir.Comuna;
                if (dir.Ciudad.Length > 0) receptor.Ciudad = dir.Ciudad;
                var correo = Trunc(socio.EmailAddress, 80);
                if (Regex.IsMatch(correo, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) receptor.Correo = correo;
                var tel = Trunc(socio.Phone1, 20);
                if (tel.Length > 0) receptor.Telefono = tel;
            }

            var idDoc = new CuerpoIdDoc { TipoDte = tipo, FechaEmision = fechaEmision };

            // Forma de pago y vencimiento (no aplican a boletas ni a guías)
            if (!boleta && tipo != 52)
            {
                var grupo = doc.PaymentGroupCode;
                idDoc.FormaPago = grupo.HasValue && ctx.Config.GruposPagoContado.Contains(grupo.Value) ? 1 : 2;
                if (doc.DocDueDate.HasValue && doc.DocDate.HasValue && doc.DocDueDate.Value.Date >= doc.DocDate.Value.Date)
                    idDoc.FechaVencimiento = Fecha(doc.DocDueDate);
            }

            // Guía de despacho
            if (tipo == 52)
            {
                if (!int.TryParse((doc.SiiIndTraslado ?? "").Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var ind) || ind < 1 || ind > 9)
                    errores.Add("Guía de despacho: U_SII_IndTraslado es obligatorio (1 a 9)");
                else
                    idDoc.IndTraslado = ind;
            }

            // Descuento de cabecera: afecto y exento por separado si el documento es mixto.
            var descGlobal = doc.DiscountPercent ?? 0;
            List<CuerpoDescuentoRecargo>? descuentos = null;
            if (descGlobal > 0)
            {
                var valor = Math.Min(descGlobal, 100);
                descuentos = new List<CuerpoDescuentoRecargo>();
                if (hayAfecta && tipo != 34 && tipo != 41)
                    descuentos.Add(new CuerpoDescuentoRecargo { Tipo = "D", Glosa = "Descuento", TipoValor = "%", Valor = valor });
                if (hayExenta || tipo == 34 || tipo == 41)
                    descuentos.Add(new CuerpoDescuentoRecargo { Tipo = "D", Glosa = "Descuento", TipoValor = "%", Valor = valor, Exento = true });
            }

            // Referencias (notas de crédito y débito)
            List<CuerpoReferencia>? referencias = null;
            if (tipo == 61 || tipo == 56) referencias = ReferenciasDe(doc, ctx.Bases, errores);

            var origen = new Dictionary<string, object>
            {
                { "sistema", "SAP_B1" },
                { "objType", doc.ObjType },
                { "docEntry", doc.DocEntry },
            };
            if (doc.DocNum.HasValue) origen["docNum"] = doc.DocNum.Value;
            var transporte = Trunc(doc.SiiTransporte, 254);
            if (tipo == 52 && transporte.Length > 0) origen["transporte"] = transporte;

            if (errores.Count > 0) return r;

            var cuerpo = new CuerpoDocumento { IdDoc = idDoc, Detalle = detalle, Origen = origen };
            if (receptor != null) cuerpo.Receptor = receptor;
            if (descuentos != null && descuentos.Count > 0) cuerpo.DescuentosRecargos = descuentos;
            if (referencias != null && referencias.Count > 0) cuerpo.Referencias = referencias;
            r.Cuerpo = cuerpo;
            return r;
        }

        private class Dir
        {
            public string Direccion = "";
            public string Comuna = "";
            public string Ciudad = "";
        }

        private static Dir DireccionDe(SocioNegocio socio, CabeceraDocumento doc)
        {
            var dirs = socio.Direcciones;
            var facturacion = dirs.Where(d => string.IsNullOrEmpty(d.AddressType) || d.AddressType == "bo_BillTo").ToList();
            DireccionSocio? elegida = null;
            if (!string.IsNullOrEmpty(doc.PayToCode)) elegida = facturacion.FirstOrDefault(d => d.AddressName == doc.PayToCode);
            elegida = elegida ?? facturacion.FirstOrDefault() ?? dirs.FirstOrDefault();
            if (elegida != null)
            {
                var calle = string.Join(" ", new[] { elegida.Street, elegida.StreetNo }.Select(s => (s ?? "").Trim()).Where(s => s.Length > 0));
                return new Dir
                {
                    Direccion = calle.Length > 70 ? calle.Substring(0, 70) : calle,
                    Comuna = Trunc(elegida.County, 20),
                    Ciudad = Trunc(elegida.City, 20),
                };
            }
            var primera = (doc.Address ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.None)[0];
            return new Dir { Direccion = Trunc(primera, 70) };
        }

        private static List<CuerpoReferencia> ReferenciasDe(CabeceraDocumento doc, IReadOnlyDictionary<string, BaseInfo> bases, List<string> errores)
        {
            var crudo = (doc.SiiCodRef ?? "").Trim();
            int codRef = 3;
            if (crudo.Length > 0)
            {
                if (crudo == "1" || crudo == "2" || crudo == "3") codRef = int.Parse(crudo, CultureInfo.InvariantCulture);
                else errores.Add("U_SII_CodRef \"" + crudo + "\" inválido (1 anula, 2 corrige texto, 3 corrige montos)");
            }
            var razonRef = Trunc(doc.SiiRazonRef, 90);
            var refs = new List<CuerpoReferencia>();
            int erroresAntes = errores.Count;

            foreach (var b in BasesDe(doc))
            {
                if (!bases.TryGetValue(ClaveBase(b.Key, b.Value), out var info))
                {
                    errores.Add("No se pudo leer el documento base (ObjType " + b.Key + ", DocEntry " + b.Value + ")");
                    continue;
                }
                if (!info.Folio.HasValue)
                {
                    errores.Add("El documento base (ObjType " + b.Key + ", DocEntry " + b.Value +
                                ") no tiene folio (U_SII_Folio): debe emitirse antes de la nota");
                    continue;
                }
                int tipoRef = info.TipoDte ?? TiposDte.PorDefecto(b.Key);
                if (tipoRef == 0)
                {
                    errores.Add("El documento base de ObjType " + b.Key + " no tiene un tipo DTE conocido");
                    continue;
                }
                var rf = new CuerpoReferencia
                {
                    TipoDocRef = tipoRef.ToString(CultureInfo.InvariantCulture),
                    FolioRef = info.Folio.Value.ToString(CultureInfo.InvariantCulture),
                    CodRef = codRef,
                };
                var f = Fecha(info.DocDate);
                if (f.Length > 0) rf.FechaRef = f;
                if (razonRef.Length > 0) rf.RazonRef = razonRef;
                refs.Add(rf);
            }

            if (refs.Count == 0 && errores.Count == erroresAntes)
            {
                // Sin líneas copiadas desde otro documento: referencia manual por UDF.
                var tipoDocRef = Trunc(doc.SiiTipoDocRef, 3);
                var folioRef = Trunc(doc.SiiFolioRef, 18);
                if (tipoDocRef.Length > 0 && folioRef.Length > 0)
                {
                    var rf = new CuerpoReferencia { TipoDocRef = tipoDocRef, FolioRef = folioRef, CodRef = codRef };
                    if (razonRef.Length > 0) rf.RazonRef = razonRef;
                    refs.Add(rf);
                }
                else
                {
                    errores.Add("La nota debe referenciar el documento que modifica: cree la nota copiando desde el documento base o complete U_SII_TipoDocRef y U_SII_FolioRef");
                }
            }
            return refs;
        }
    }
}
