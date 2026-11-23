using System;
using System.Linq;
using SapB1Addon.Core;
using SapB1Addon.Core.Modelos;
using Xunit;

namespace SapB1Addon.Core.Tests
{
    public class ValidacionTests
    {
        private static ResultadoValidacion Validar(DocumentoFalso doc, ConfiguracionAddon? cfg = null) =>
            ValidadorDocumento.Validar(doc, cfg ?? Datos.Config());

        private static DocumentoFalso Factura() => new DocumentoFalso(Datos.Factura());

        [Fact]
        public void Factura_correcta_es_valida_y_genera_cuerpo()
        {
            var r = Validar(Factura());
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal(33, r.TipoDte);
            Assert.NotNull(r.Cuerpo);
            Assert.Equal(Constantes.RutCliente, r.Cuerpo!.Receptor!.Rut);
        }

        [Theory]
        [InlineData("12345678-9")]
        [InlineData("abc")]
        [InlineData("12.345.678-K")]
        public void Rut_con_dv_o_formato_invalido_se_rechaza(string rut)
        {
            var d = Factura();
            d.Socio = Datos.Socio(rut);
            var r = Validar(d);
            Assert.False(r.Ok);
            Assert.Contains(r.Errores, e => e.Contains("RUT del receptor inválido"));
        }

        [Theory]
        [InlineData("12.345.678-5")]
        [InlineData("123456785")]
        [InlineData("012345678-5")]
        public void Rut_valido_en_distintos_formatos_se_normaliza(string rut)
        {
            var d = Factura();
            d.Socio = Datos.Socio(rut);
            var r = Validar(d);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal("12345678-5", r.Cuerpo!.Receptor!.Rut);
        }

        [Fact]
        public void Socio_sin_rut_es_error_y_rut_generico_solo_vale_en_boletas()
        {
            var d = Factura();
            d.Socio = Datos.Socio("");
            Assert.Contains(Validar(d).Errores, e => e.Contains("no tiene RUT"));

            d.Socio = Datos.Socio("66666666-6");
            Assert.Contains(Validar(d).Errores, e => e.Contains("genérico"));
        }

        [Fact]
        public void Falta_giro_en_factura_es_error_pero_se_puede_relajar()
        {
            var d = Factura();
            d.Socio = Datos.Socio(giro: null);
            var r = Validar(d);
            Assert.False(r.Ok);
            Assert.Contains(r.Errores, e => e.Contains("giro"));

            var cfg = Datos.Config();
            cfg.ExigirDatosReceptor = false;
            var relajada = Validar(d, cfg);
            Assert.True(relajada.Ok);
            Assert.Contains(relajada.Advertencias, a => a.Contains("giro"));
        }

        [Fact]
        public void Falta_direccion_o_comuna_es_error_en_factura()
        {
            var d = Factura();
            d.Socio = Datos.Socio();
            d.Socio.Direcciones.Clear();
            var sinDireccion = Validar(d);
            Assert.Contains(sinDireccion.Errores, e => e.Contains("dirección"));
            Assert.Contains(sinDireccion.Errores, e => e.Contains("comuna"));

            d.Socio.Direcciones.Add(new DireccionSocio { Street = "Calle 1", City = "Santiago" });
            var sinComuna = Validar(d);
            Assert.DoesNotContain(sinComuna.Errores, e => e.Contains("no tiene dirección"));
            Assert.Contains(sinComuna.Errores, e => e.Contains("comuna"));
        }

        [Fact]
        public void Socio_inexistente_o_sin_leer_es_error()
        {
            var d = Factura();
            d.Socio = null;
            Assert.Contains(Validar(d).Errores, e => e.Contains("No se pudo leer el socio"));

            var d2 = Factura();
            d2.FallaAlLeerSocio = new InvalidOperationException("DI API desconectada");
            Assert.Contains(Validar(d2).Errores, e => e.Contains("DI API desconectada"));
        }

        [Fact]
        public void Sin_socio_seleccionado_pide_el_cliente()
        {
            var d = Factura();
            d.Cab.CardCode = "";
            Assert.Contains(Validar(d).Errores, e => e.Contains("socio de negocios"));
        }

        [Theory]
        [InlineData("61", 13)]
        [InlineData("52", 13)]
        [InlineData("33", 14)]
        [InlineData("33", 15)]
        [InlineData("61", 15)]
        public void Tipo_sii_no_permitido_para_el_objeto_se_rechaza(string tipo, int objType)
        {
            var cab = objType == 13 ? Datos.Factura() : objType == 14 ? Datos.NotaCredito() : Datos.Guia();
            cab.SiiTipoDte = tipo;
            var r = Validar(new DocumentoFalso(cab));
            Assert.False(r.Ok);
            Assert.Contains(r.Errores, e => e.Contains("no corresponde a"));
        }

        [Fact]
        public void Tipo_desconocido_se_rechaza()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "99";
            Assert.Contains(Validar(new DocumentoFalso(cab)).Errores, e => e.Contains("no es un tipo válido"));
        }

        [Fact]
        public void Guia_exige_ind_traslado_entre_1_y_9()
        {
            foreach (var malo in new string?[] { null, "", "0", "10", "x" })
            {
                var cab = Datos.Guia();
                cab.SiiIndTraslado = malo;
                var r = Validar(new DocumentoFalso(cab));
                Assert.Contains(r.Errores, e => e.Contains("U_SII_IndTraslado"));
            }
            var ok = Validar(new DocumentoFalso(Datos.Guia()));
            Assert.True(ok.Ok, string.Join("; ", ok.Errores));
            Assert.Equal(1, ok.Cuerpo!.IdDoc.IndTraslado);
        }

        [Fact]
        public void Factura_33_exige_al_menos_un_item_afecto()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "33";
            cab.Lines.ForEach(l => l.TaxCode = "IVA_EXE");
            var r = Validar(new DocumentoFalso(cab));
            Assert.Contains(r.Errores, e => e.Contains("al menos un ítem afecto"));

            // Sin tipo explícito, todo exento se deriva a 34.
            var cab2 = Datos.Factura();
            cab2.Lines.ForEach(l => l.TaxCode = "IVA_EXE");
            var r2 = Validar(new DocumentoFalso(cab2));
            Assert.True(r2.Ok, string.Join("; ", r2.Errores));
            Assert.Equal(34, r2.TipoDte);
            Assert.All(r2.Cuerpo!.Detalle, d => Assert.True(d.Exento));
        }

        [Fact]
        public void Boleta_39_exige_item_afecto_y_41_solo_exentos()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "39";
            cab.Lines.ForEach(l => l.TaxCode = "IVA_EXE");
            Assert.Contains(Validar(new DocumentoFalso(cab)).Errores, e => e.Contains("al menos un ítem afecto"));

            var cab2 = Datos.Factura();
            cab2.SiiTipoDte = "41";
            Assert.Contains(Validar(new DocumentoFalso(cab2)).Errores, e => e.Contains("solo admite ítems exentos"));
        }

        [Fact]
        public void Limites_de_lineas_60_en_dte_y_1000_en_boletas()
        {
            var cab = Datos.Factura();
            cab.Lines.Clear();
            for (int i = 0; i < 61; i++) cab.Lines.Add(Datos.Linea(i));
            Assert.Contains(Validar(new DocumentoFalso(cab)).Errores, e => e.Contains("máximo 60 líneas"));

            cab.Lines.RemoveAt(60);
            Assert.True(Validar(new DocumentoFalso(cab)).Ok);

            var boleta = Datos.Factura();
            boleta.SiiTipoDte = "39";
            boleta.Lines.Clear();
            for (int i = 0; i < 1000; i++) boleta.Lines.Add(Datos.Linea(i));
            var d = new DocumentoFalso(boleta) { Socio = Datos.Socio("") };
            Assert.True(Validar(d).Ok, string.Join("; ", Validar(d).Errores));
            boleta.Lines.Add(Datos.Linea(1000));
            Assert.Contains(Validar(d).Errores, e => e.Contains("máximo 1000 líneas"));
        }

        [Fact]
        public void Documento_sin_lineas_o_con_cantidad_cero_es_error()
        {
            var cab = Datos.Factura();
            cab.Lines.Clear();
            Assert.Contains(Validar(new DocumentoFalso(cab)).Errores, e => e.Contains("no tiene líneas"));

            var cab2 = Datos.Factura();
            cab2.Lines[0].Quantity = 0;
            Assert.Contains(Validar(new DocumentoFalso(cab2)).Errores, e => e.Contains("cantidad"));
        }

        [Fact]
        public void Nota_de_credito_sin_referencia_es_error()
        {
            var cab = Datos.NotaCredito();
            cab.Lines[0].BaseType = null;
            cab.Lines[0].BaseEntry = null;
            var r = Validar(new DocumentoFalso(cab));
            Assert.Contains(r.Errores, e => e.Contains("debe referenciar el documento"));
        }

        [Fact]
        public void Nota_de_credito_con_base_sin_folio_es_error()
        {
            var d = new DocumentoFalso(Datos.NotaCredito());
            d.Bases["13:100"] = new BaseInfo { ObjType = 13, DocEntry = 100, DocDate = new DateTime(2026, 3, 10), Folio = null };
            var r = Validar(d);
            Assert.Contains(r.Errores, e => e.Contains("no tiene folio"));
        }

        [Fact]
        public void Nota_de_credito_con_base_ilegible_es_error()
        {
            var r = Validar(new DocumentoFalso(Datos.NotaCredito()));
            Assert.Contains(r.Errores, e => e.Contains("No se pudo leer el documento base"));
        }

        [Fact]
        public void Nota_de_credito_con_base_con_folio_arma_la_referencia()
        {
            var d = new DocumentoFalso(Datos.NotaCredito());
            d.Bases["13:100"] = new BaseInfo { ObjType = 13, DocEntry = 100, DocDate = new DateTime(2026, 3, 10), Folio = 4321, TipoDte = null };
            var r = Validar(d);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            var rf = Assert.Single(r.Cuerpo!.Referencias!);
            Assert.Equal("33", rf.TipoDocRef);
            Assert.Equal("4321", rf.FolioRef);
            Assert.Equal("2026-03-10", rf.FechaRef);
            Assert.Equal(1, rf.CodRef);
            Assert.Equal("Anula factura", rf.RazonRef);
        }

        [Fact]
        public void Nota_de_credito_manual_por_udf_de_referencia()
        {
            var cab = Datos.NotaCredito();
            cab.Lines[0].BaseType = null;
            cab.Lines[0].BaseEntry = null;
            cab.SiiTipoDocRef = "33";
            cab.SiiFolioRef = "777";
            var r = Validar(new DocumentoFalso(cab));
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal("777", r.Cuerpo!.Referencias![0].FolioRef);
        }

        [Fact]
        public void Cod_ref_invalido_es_error()
        {
            var cab = Datos.NotaCredito();
            cab.SiiCodRef = "7";
            var d = new DocumentoFalso(cab);
            d.Bases["13:100"] = new BaseInfo { ObjType = 13, DocEntry = 100, Folio = 1 };
            Assert.Contains(Validar(d).Errores, e => e.Contains("U_SII_CodRef"));
        }

        [Fact]
        public void Nota_de_debito_56_sobre_factura_exige_referencia_con_folio()
        {
            var cab = Datos.Factura();
            cab.SiiTipoDte = "56";
            cab.Lines[0].BaseType = 13;
            cab.Lines[0].BaseEntry = 99;
            var d = new DocumentoFalso(cab);
            Assert.Contains(Validar(d).Errores, e => e.Contains("No se pudo leer el documento base"));
            d.Bases["13:99"] = new BaseInfo { ObjType = 13, DocEntry = 99, DocDate = new DateTime(2026, 3, 1), Folio = 55, TipoDte = 33 };
            var r = Validar(d);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal(56, r.TipoDte);
        }

        [Fact]
        public void Controlador_Validar_muestra_errores_y_PermiteAgregar_bloquea()
        {
            using var e = new Escenario(Datos.Factura());
            e.Doc.Socio = Datos.Socio("11111111-2");
            Assert.False(e.Validar().PermiteAgregar());
            Assert.Contains(e.Msg.Avisos, a => a.Texto.Contains("RUT del receptor inválido"));
            Assert.Empty(e.Udf.Escrituras); // validar no escribe en B1
        }

        [Fact]
        public void PermiteAgregar_no_toca_documentos_no_marcados_para_el_sii()
        {
            var cab = Datos.Factura();
            cab.SiiEstado = null;
            cab.SiiTipoDte = null;
            using var e = new Escenario(cab);
            e.Doc.Socio = Datos.Socio("11111111-2");
            Assert.True(e.Validar().PermiteAgregar());
            Assert.Empty(e.Msg.Avisos);
        }

        [Fact]
        public void PermiteAgregar_no_bloquea_si_falla_la_lectura_del_formulario()
        {
            using var e = new Escenario(Datos.Factura());
            var servicios = new SapB1Addon.Core.Controladores.ServiciosAddon(new Explota(), e.Udf, e.Msg, e.Servicios.Api, () => e.Config);
            Assert.True(new SapB1Addon.Core.Controladores.ValidarControlador(servicios).PermiteAgregar());
            Assert.Contains(e.Msg.EnEstado, m => m.Nivel == NivelMensaje.Advertencia);
        }

        private class Explota : IDocumentoB1
        {
            public CabeceraDocumento LeerCabecera() => throw new InvalidOperationException("formulario no disponible");
            public SocioNegocio? LeerSocio(string cardCode) => null;
            public BaseInfo? LeerBase(int objType, int docEntry) => null;
        }
    }
}
