using System;
using System.Linq;
using System.Text.Json;
using SapB1Addon.Core;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;
using Xunit;

namespace SapB1Addon.Core.Tests
{
    public class MapeoTests
    {
        private static CuerpoDocumento Mapear(DocumentoFalso d, ConfiguracionAddon? cfg = null)
        {
            var r = ValidadorDocumento.Validar(d, cfg ?? Datos.Config());
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            return r.Cuerpo!;
        }

        [Fact]
        public void Tipo_33_factura_afecta_con_credito_y_vencimiento()
        {
            var c = Mapear(new DocumentoFalso(Datos.Factura()));
            Assert.Equal(33, c.IdDoc.TipoDte);
            Assert.Equal("2026-03-10", c.IdDoc.FechaEmision);
            Assert.Equal(2, c.IdDoc.FormaPago); // PaymentGroupCode 2 no es contado
            Assert.Equal("2026-04-09", c.IdDoc.FechaVencimiento);
            Assert.Equal(2, c.Detalle.Count);
            Assert.Equal(1000m, c.Detalle[0].PrecioUnitario);
            Assert.Equal(10m, c.Detalle[1].DescuentoPorcentaje);
            Assert.Equal("UN", c.Detalle[0].Unidad);
            Assert.Equal("A1", c.Detalle[0].CodigoItem);
            Assert.Equal("Providencia", c.Receptor!.Comuna);
            Assert.Equal("Av. Siempre Viva 742", c.Receptor.Direccion);
            Assert.Equal("contacto@cliente.cl", c.Receptor.Correo);
            Assert.Equal("SAP_B1", c.Origen!["sistema"]);
            Assert.Equal(13, c.Origen["objType"]);
            Assert.Equal(100, c.Origen["docEntry"]);
        }

        [Fact]
        public void Pago_contado_segun_grupos_configurados()
        {
            var cab = Datos.Factura();
            cab.PaymentGroupCode = -1;
            Assert.Equal(1, Mapear(new DocumentoFalso(cab)).IdDoc.FormaPago);
            cab.PaymentGroupCode = 7;
            var cfg = Datos.Config();
            cfg.GruposPagoContado = new System.Collections.Generic.List<int> { 7 };
            Assert.Equal(1, Mapear(new DocumentoFalso(cab), cfg).IdDoc.FormaPago);
        }

        [Fact]
        public void Vencimiento_anterior_a_la_emision_se_omite()
        {
            var cab = Datos.Factura();
            cab.DocDueDate = new DateTime(2026, 3, 1);
            Assert.Null(Mapear(new DocumentoFalso(cab)).IdDoc.FechaVencimiento);
        }

        [Fact]
        public void Tipo_34_todas_las_lineas_exentas()
        {
            var cab = Datos.Factura();
            cab.Lines.ForEach(l => l.TaxCode = "EXE");
            var c = Mapear(new DocumentoFalso(cab));
            Assert.Equal(34, c.IdDoc.TipoDte);
            Assert.All(c.Detalle, d => Assert.True(d.Exento));
        }

        [Fact]
        public void Tipo_39_boleta_usa_precio_con_iva_y_consumidor_final_sin_receptor()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "39";
            cab.Lines.Clear();
            cab.Lines.Add(new LineaDocumento { LineNum = 0, ItemDescription = "Café", Quantity = 2, UnitPrice = 840.34m, PriceAfterVat = 1000m, TaxCode = "IVA" });
            cab.Lines.Add(new LineaDocumento { LineNum = 1, ItemDescription = "Pan", Quantity = 1, UnitPrice = 1000m, TaxPercentagePerRow = 19, TaxCode = "IVA" });
            var d = new DocumentoFalso(cab) { Socio = Datos.Socio("") };
            var c = Mapear(d);
            Assert.Equal(39, c.IdDoc.TipoDte);
            Assert.Null(c.Receptor);
            Assert.Null(c.IdDoc.FormaPago);
            Assert.Null(c.IdDoc.FechaVencimiento);
            Assert.Equal(1000m, c.Detalle[0].PrecioUnitario);
            Assert.Equal(1190m, c.Detalle[1].PrecioUnitario); // neto * (1 + IVA)
        }

        [Fact]
        public void Boleta_con_rut_generico_es_consumidor_final_y_con_rut_real_lo_informa()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "39";
            var generico = new DocumentoFalso(cab) { Socio = Datos.Socio("66666666-6") };
            Assert.Null(Mapear(generico).Receptor);
            var real = new DocumentoFalso(cab) { Socio = Datos.Socio() };
            Assert.Equal(Constantes.RutCliente, Mapear(real).Receptor!.Rut);
        }

        [Fact]
        public void Tipo_41_boleta_exenta()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "41";
            cab.Lines.ForEach(l => { l.TaxCode = "IVA_EXE"; l.PriceAfterVat = null; });
            var c = Mapear(new DocumentoFalso(cab) { Socio = Datos.Socio("") });
            Assert.Equal(41, c.IdDoc.TipoDte);
            Assert.All(c.Detalle, d => Assert.True(d.Exento));
            Assert.Equal(1000m, c.Detalle[0].PrecioUnitario); // exento: el neto es el precio
        }

        [Fact]
        public void Tipo_52_guia_con_traslado_sin_forma_de_pago_y_transporte_en_origen()
        {
            var c = Mapear(new DocumentoFalso(Datos.Guia()));
            Assert.Equal(52, c.IdDoc.TipoDte);
            Assert.Equal(1, c.IdDoc.IndTraslado);
            Assert.Null(c.IdDoc.FormaPago);
            Assert.Equal("Patente AB1234; chofer Juan", c.Origen!["transporte"]);
            Assert.Equal(15, c.Origen["objType"]);
        }

        [Fact]
        public void Tipo_56_nota_de_debito_sobre_factura_con_referencia()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "56";
            cab.Lines[0].BaseType = 13;
            cab.Lines[0].BaseEntry = 99;
            cab.SiiCodRef = null; // por defecto 3
            var d = new DocumentoFalso(cab);
            d.Bases["13:99"] = new BaseInfo { ObjType = 13, DocEntry = 99, DocDate = new DateTime(2026, 3, 1), Folio = 55, TipoDte = 33 };
            var c = Mapear(d);
            Assert.Equal(56, c.IdDoc.TipoDte);
            var rf = Assert.Single(c.Referencias!);
            Assert.Equal("33", rf.TipoDocRef);
            Assert.Equal("55", rf.FolioRef);
            Assert.Equal(3, rf.CodRef);
        }

        [Fact]
        public void Tipo_61_nota_de_credito_con_dos_lineas_del_mismo_base_una_sola_referencia()
        {
            var cab = Datos.NotaCredito();
            cab.Lines.Add(new LineaDocumento { LineNum = 1, ItemDescription = "Otro", Quantity = 1, UnitPrice = 10, TaxCode = "IVA", BaseType = 13, BaseEntry = 100 });
            var d = new DocumentoFalso(cab);
            d.Bases["13:100"] = new BaseInfo { ObjType = 13, DocEntry = 100, DocDate = new DateTime(2026, 3, 10), Folio = 4321, TipoDte = 33 };
            var c = Mapear(d);
            Assert.Equal(61, c.IdDoc.TipoDte);
            Assert.Single(c.Referencias!);
        }

        [Fact]
        public void Descuento_de_cabecera_en_documento_mixto_genera_dos_descuentos()
        {
            var cab = Datos.Factura();
            cab.DiscountPercent = 5;
            cab.Lines[1].TaxCode = "IVA_EXE";
            var c = Mapear(new DocumentoFalso(cab));
            Assert.Equal(2, c.DescuentosRecargos!.Count);
            Assert.Contains(c.DescuentosRecargos, x => x.Exento != true && x.Valor == 5m && x.TipoValor == "%");
            Assert.Contains(c.DescuentosRecargos, x => x.Exento == true);
        }

        [Fact]
        public void Nombre_largo_se_trunca_a_80_y_pasa_completo_a_descripcion()
        {
            var cab = Datos.Factura();
            cab.Lines[0].ItemDescription = new string('x', 120);
            var c = Mapear(new DocumentoFalso(cab));
            Assert.Equal(80, c.Detalle[0].Nombre.Length);
            Assert.Equal(120, c.Detalle[0].Descripcion!.Length);
        }

        [Fact]
        public void Serializacion_json_usa_camelCase_y_omite_nulos()
        {
            using var e = new Escenario(Datos.Factura());
            var r = e.Emitir().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            var cuerpo = e.Servidor.Emisiones.Single().Cuerpo;
            using var j = JsonDocument.Parse(cuerpo);
            var raiz = j.RootElement;
            Assert.Equal(33, raiz.GetProperty("idDoc").GetProperty("tipoDte").GetInt32());
            Assert.False(raiz.TryGetProperty("referencias", out _));
            Assert.False(raiz.GetProperty("idDoc").TryGetProperty("indTraslado", out _));
            Assert.Equal("SAP_B1", raiz.GetProperty("origen").GetProperty("sistema").GetString());
        }

        [Theory]
        [InlineData("76.086.428-5", "76086428-5")]
        [InlineData("76086428-5", "76086428-5")]
        [InlineData("760864285", "76086428-5")]
        [InlineData("1-9", "1-9")]
        [InlineData("11.111.111-1", "11111111-1")]
        public void Rut_normaliza(string entrada, string esperado) => Assert.Equal(esperado, Rut.Normalizar(entrada));

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("76086428-4")]
        [InlineData("0-0")]
        [InlineData("1234567890-1")]
        public void Rut_invalido_devuelve_null(string? entrada) => Assert.Null(Rut.Normalizar(entrada));

        [Theory]
        [InlineData("emitido", "EMITIDO")]
        [InlineData("encolado", "EMITIDO")]
        [InlineData("enviado", "ENVIADO")]
        [InlineData("aceptado", "ACEPTADO")]
        [InlineData("aceptado_con_reparos", "REPAROS")]
        [InlineData("rechazado", "RECHAZADO")]
        [InlineData("anulado", "RECHAZADO")]
        [InlineData("otra-cosa", null)]
        public void Traduccion_de_estados_api_a_udf(string api, string? esperado) => Assert.Equal(esperado, TraductorEstados.Desde(api));

        [Fact]
        public void Clave_de_idempotencia_es_la_del_worker()
        {
            Assert.Equal("b1:76086428-5:13:100", ClaveIdempotencia.De("76086428-5", 13, 100));
        }

        [Fact]
        public void Estados_y_udf_coinciden_con_el_worker()
        {
            Assert.Equal(new[] { "PENDIENTE", "ENVIANDO", "EMITIDO", "ENVIADO", "ACEPTADO", "REPAROS", "RECHAZADO", "ERROR" }, EstadoSii.Todos);
            Assert.Equal("U_SII_TipoDTE", Udf.TipoDte);
            Assert.Equal("U_SII_IdemKey", Udf.IdemKey);
            Assert.Equal("U_SII_IndTraslado", Udf.IndTraslado);
            Assert.Equal("U_SII_Giro", Udf.Giro);
        }
    }
}
