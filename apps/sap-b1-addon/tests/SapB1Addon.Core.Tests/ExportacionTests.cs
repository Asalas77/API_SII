using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using SapB1Addon.Core;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;
using Xunit;

namespace SapB1Addon.Core.Tests
{
    /// <summary>Exportación 110, 111 y 112: mismo mapeo y mensajes que "exportación" en <c>mapeador.spec.ts</c> del worker.</summary>
    public class ExportacionTests
    {
        private static SocioNegocio SocioExtranjero(bool conDireccion = true) => new SocioNegocio
        {
            CardCode = "C30000",
            CardName = "ACME IMPORT INC",
            LicTradNum = "US-12-3456789",
            EmailAddress = "buyer@acme.example.com",
            Direcciones =
            {
                new DireccionSocio { AddressName = "HQ", AddressType = "bo_BillTo", Street = conDireccion ? "350 Fifth Avenue" : "", City = "New York", County = "" },
            },
        };

        private static LineaDocumento LineaUsd(int n, decimal cantidad, decimal precio) => new LineaDocumento
        {
            LineNum = n,
            ItemCode = "VINO" + (n + 1),
            ItemDescription = "Vino " + (n + 1),
            Quantity = cantidad,
            UnitPrice = precio,
            TaxCode = "EXE",
            MeasureUnit = "CJ",
            Currency = "USD",
        };

        private static CabeceraDocumento Factura(Action<CabeceraDocumento>? cambiar = null)
        {
            var c = new CabeceraDocumento
            {
                ObjType = 13,
                DocEntry = 400,
                DocDate = new DateTime(2026, 3, 16),
                CardCode = "C30000",
                CardName = "ACME IMPORT INC",
                PayToCode = "HQ",
                PaymentGroupCode = 2,
                SiiEstado = EstadoSii.Pendiente,
                SiiTipoDte = "110",
                DocCurrency = "USD",
                DocRate = 925.4567m,
                DocTotalFc = 7192.83m,
                Lines = { LineaUsd(0, 100, 45.5m), LineaUsd(1, 50.5m, 52.3333m) },
                SiiModVenta = "1",
                SiiClausulaVenta = "5",
                SiiViaTransp = "1",
                SiiPtoEmbarque = "905",
                SiiPtoDesemb = "134",
                SiiPaisReceptor = "225",
                SiiPaisDestino = "225",
                SiiTotBultos = "151",
                SiiTipoBulto = "10",
                SiiFormaPagoExp = "11",
            };
            cambiar?.Invoke(c);
            return c;
        }

        private static ResultadoValidacion Validar(CabeceraDocumento c, ConfiguracionAddon? cfg = null, SocioNegocio? socio = null, Action<DocumentoFalso>? doc = null)
        {
            var d = new DocumentoFalso(c) { Socio = socio ?? SocioExtranjero() };
            doc?.Invoke(d);
            return ValidadorDocumento.Validar(d, cfg ?? Datos.Config());
        }

        [Fact]
        public void Factura_110_moneda_tipo_de_cambio_receptor_sin_rut_y_aduana()
        {
            var r = Validar(Factura());
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            var c = r.Cuerpo!;
            Assert.Equal(110, c.IdDoc.TipoDte);
            Assert.Null(c.Receptor!.Rut);
            Assert.Equal("ACME IMPORT INC", c.Receptor.RazonSocial);
            Assert.Equal("350 Fifth Avenue", c.Receptor.Direccion);
            var x = c.Exportacion!;
            Assert.Equal("DOLAR USA", x.Moneda);
            Assert.Equal(925.4567m, x.TipoCambio);
            Assert.Equal(11, x.FormaPagoExportacion);
            Assert.Equal("US-12-3456789", x.Extranjero.NumId);
            Assert.Equal(225, x.Extranjero.Nacionalidad);
            var a = x.Aduana!;
            Assert.Equal(1, a.CodigoModalidadVenta);
            Assert.Equal(5, a.CodigoClausulaVenta);
            Assert.Equal(7192.83m, a.TotalClausulaVenta);
            Assert.Equal(1, a.CodigoViaTransporte);
            Assert.Equal(905, a.CodigoPuertoEmbarque);
            Assert.Equal(134, a.CodigoPuertoDesembarque);
            Assert.Equal(151, a.TotalBultos);
            Assert.Equal(10, a.Bultos!.Single().CodigoTipo);
            Assert.Equal(52.3333m, c.Detalle[1].PrecioUnitario);
            Assert.DoesNotContain(c.Detalle, d => d.Exento == true);
            Assert.Empty(r.Advertencias);
        }

        [Fact]
        public void El_json_no_incluye_rut_y_usa_los_nombres_de_la_api()
        {
            var r = Validar(Factura());
            var json = JsonSerializer.Serialize(r.Cuerpo, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
            Assert.DoesNotContain("\"rut\"", json);
            Assert.Contains("\"exportacion\":{\"moneda\":\"DOLAR USA\",\"tipoCambio\":925.4567", json);
            Assert.Contains("\"nacionalidad\":225", json);
            Assert.Contains("\"codigoViaTransporte\":1", json);
        }

        [Fact]
        public void Moneda_local_sin_moneda_sin_tipo_de_cambio_o_sin_glosa_son_errores_y_la_configuracion_la_define()
        {
            Assert.Contains(Validar(Factura(c => c.DocCurrency = "CLP")).Errores, e => e.Contains("moneda extranjera"));
            Assert.Contains(Validar(Factura(c => c.DocCurrency = null)).Errores, e => e.Contains("DocCurrency"));
            Assert.Contains(Validar(Factura(c => c.DocRate = 0)).Errores, e => e.Contains("DocRate"));
            void Brl(CabeceraDocumento c)
            {
                c.DocCurrency = "BRL";
                c.Lines.Clear();
                c.Lines.Add(new LineaDocumento { LineNum = 0, ItemCode = "A", ItemDescription = "A", Quantity = 1, UnitPrice = 10, Currency = "BRL" });
                c.DocTotalFc = 10;
                c.SiiTotClausula = "10";
            }
            Assert.Contains(Validar(Factura(Brl)).Errores, e => e.Contains("glosa del SII"));
            var cfg = Datos.Config();
            cfg.MonedasSii["BRL"] = "OTRAS MONEDAS";
            var r = Validar(Factura(Brl), cfg);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal("OTRAS MONEDAS", r.Cuerpo!.Exportacion!.Moneda);
        }

        [Fact]
        public void La_factura_exige_los_udf_de_aduana_salvo_en_servicios()
        {
            var r = Validar(Factura(c =>
            {
                c.SiiModVenta = c.SiiClausulaVenta = c.SiiViaTransp = c.SiiPtoEmbarque = c.SiiPtoDesemb = null;
                c.SiiPaisReceptor = c.SiiPaisDestino = c.SiiTotBultos = null;
            }));
            var texto = string.Join("\n", r.Errores);
            foreach (var udf in new[] { Udf.PaisReceptor, Udf.ModVenta, Udf.ClausulaVenta, Udf.ViaTransp, Udf.PtoEmbarque, Udf.PtoDesemb, Udf.PaisDestino, Udf.TotBultos })
                Assert.Contains(udf, texto);

            var hoteleria = Validar(Factura(c =>
            {
                c.SiiIndServicio = "4";
                c.SiiModVenta = c.SiiClausulaVenta = c.SiiViaTransp = c.SiiPtoEmbarque = c.SiiPtoDesemb = null;
                c.SiiPaisDestino = c.SiiTotBultos = c.SiiTipoBulto = null;
            }));
            Assert.True(hoteleria.Ok, string.Join("; ", hoteleria.Errores));
            Assert.Equal(4, hoteleria.Cuerpo!.IdDoc.IndServicio);
            Assert.Equal(225, hoteleria.Cuerpo.Exportacion!.Aduana!.CodigoPaisReceptor);
            Assert.Null(hoteleria.Cuerpo.Exportacion.Aduana.CodigoViaTransporte);
            Assert.Contains(Validar(Factura(c => c.SiiIndServicio = "2")).Errores, e => e.Contains("U_SII_IndServicio"));
        }

        [Fact]
        public void Codigos_no_numericos_linea_en_otra_moneda_y_socio_sin_direccion_son_errores()
        {
            Assert.Contains(Validar(Factura(c => c.SiiViaTransp = "MAR")).Errores, e => e.Contains("U_SII_ViaTransp"));
            Assert.Contains(Validar(Factura(c => c.Lines[0].Currency = "EUR")).Errores, e => e.Contains("moneda de la línea"));
            Assert.Contains(Validar(Factura(), socio: SocioExtranjero(conDireccion: false)).Errores, e => e.Contains("dirección en el extranjero"));
        }

        [Fact]
        public void Total_de_la_clausula_por_udf_advertencia_por_docTotalFc_y_descuento_de_cabecera_sin_exento()
        {
            var r = Validar(Factura(c =>
            {
                c.SiiTotClausula = "7000,5";
                c.DocTotalFc = 9999m;
                c.DiscountPercent = 5m;
            }));
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal(7000.5m, r.Cuerpo!.Exportacion!.Aduana!.TotalClausulaVenta);
            var d = Assert.Single(r.Cuerpo.DescuentosRecargos!);
            Assert.Equal(5m, d.Valor);
            Assert.Null(d.Exento);
            Assert.Contains(r.Advertencias, a => a.Contains("DocTotalFC"));
        }

        [Fact]
        public void Nota_de_credito_112_desde_ORIN_referencia_la_factura_110()
        {
            var nc = new CabeceraDocumento
            {
                ObjType = 14,
                DocEntry = 500,
                DocDate = new DateTime(2026, 3, 20),
                CardCode = "C30000",
                CardName = "ACME IMPORT INC",
                SiiEstado = EstadoSii.Pendiente,
                SiiTipoDte = "112",
                DocCurrency = "USD",
                DocRate = 930.12m,
                SiiPaisReceptor = "225",
                SiiCodRef = "1",
                SiiRazonRef = "Anula factura de exportación",
                Lines = { new LineaDocumento { LineNum = 0, ItemCode = "V", ItemDescription = "Vino", Quantity = 10, UnitPrice = 45.5m, Currency = "USD", BaseType = 13, BaseEntry = 400 } },
            };
            Assert.True(MapeadorDocumento.RequiereBases(nc));
            var doc = new DocumentoFalso(nc) { Socio = SocioExtranjero() };
            doc.Bases[MapeadorDocumento.ClaveBase(13, 400)] = new BaseInfo { ObjType = 13, DocEntry = 400, DocDate = new DateTime(2026, 3, 10), Folio = 12, TipoDte = 110 };
            var r = ValidadorDocumento.Validar(doc, Datos.Config());
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal(112, r.Cuerpo!.IdDoc.TipoDte);
            var rf = Assert.Single(r.Cuerpo.Referencias!);
            Assert.Equal("110", rf.TipoDocRef);
            Assert.Equal("12", rf.FolioRef);
            Assert.Equal(1, rf.CodRef);
            Assert.Equal("DOLAR USA", r.Cuerpo.Exportacion!.Moneda);
            Assert.Equal(225, r.Cuerpo.Exportacion.Aduana!.CodigoPaisReceptor);
        }

        [Fact]
        public void Nota_de_debito_111_desde_OINV_con_referencia_manual_y_tipos_incompatibles()
        {
            var nd = Factura(c =>
            {
                c.SiiTipoDte = "111";
                c.SiiTipoDocRef = "110";
                c.SiiFolioRef = "12";
                c.SiiCodRef = "3";
                c.SiiRazonRef = "Ajuste de precio";
            });
            var r = Validar(nd);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal(111, r.Cuerpo!.IdDoc.TipoDte);
            var rf = Assert.Single(r.Cuerpo.Referencias!);
            Assert.Equal("110", rf.TipoDocRef);
            Assert.Equal(3, rf.CodRef);
            Assert.Contains(Validar(Factura(c => c.SiiTipoDte = "112")).Errores, e => e.Contains("no corresponde"));
        }
    }
}
