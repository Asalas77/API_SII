using System;
using System.Linq;
using SapB1Addon.Core;
using SapB1Addon.Core.Modelos;
using Xunit;

namespace SapB1Addon.Core.Tests
{
    /// <summary>Traslado de la guía (Res. Ex. SII 144/2026): mismo mapeo y mensajes que <c>mapeador.spec.ts</c> del worker.</summary>
    public class TrasladoTests
    {
        private static CabeceraDocumento Completa(Action<CabeceraDocumento>? cambiar = null)
        {
            var g = Datos.Guia();
            g.SiiCatTraslado = "AUTOGESTIONADO";
            g.SiiDirOrigen = "Bodega Central 100";
            g.SiiCmnaOrigen = "Quilicura";
            g.SiiRutTrans = "76.543.210-3";
            g.SiiRutChofer = "11.222.333-9";
            g.SiiNomChofer = "Juan Pérez Soto";
            g.SiiPatente = "BCDF12";
            g.SiiPatenteCarro = "AB1234";
            g.SiiFchSalida = new DateTime(2026, 11, 23);
            g.SiiHraSalida = "09:30";
            g.SiiFchLlegada = new DateTime(2026, 11, 23);
            g.EntregaCalle = "Los Leones";
            g.EntregaNumero = "99";
            g.EntregaComuna = "Ñuñoa";
            g.EntregaCiudad = "Santiago";
            cambiar?.Invoke(g);
            return g;
        }

        private static ResultadoValidacion Validar(CabeceraDocumento c) =>
            ValidadorDocumento.Validar(new DocumentoFalso(c), Datos.Config());

        [Fact]
        public void Sin_categoria_la_guia_se_rechaza_localmente_y_transporte_obsoleto_no_la_reemplaza()
        {
            var r = Validar(Datos.Guia());
            Assert.False(r.Ok);
            Assert.Contains(r.Errores, e => e.Contains("sin datos de traslado") && e.Contains("U_SII_CatTraslado") && e.Contains("Res. Ex. SII 144") && e.Contains("obsoleto"));
        }

        [Fact]
        public void Autogestionada_mapea_udf_estructurados_y_destino_desde_la_entrega()
        {
            var r = Validar(Completa());
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            var t = r.Cuerpo!.Traslado!;
            Assert.Equal("autogestionado", t.Categoria);
            Assert.Equal("Bodega Central 100", t.Origen!.Direccion);
            Assert.Equal("Quilicura", t.Origen.Comuna);
            Assert.Equal("Los Leones 99", t.Destino!.Direccion);
            Assert.Equal("Ñuñoa", t.Destino.Comuna);
            Assert.Equal("Santiago", t.Destino.Ciudad);
            Assert.Equal("76543210-3", t.Transportista!.Rut);
            Assert.Equal("11222333-9", t.Chofer!.Rut);
            Assert.Equal("Juan Pérez Soto", t.Chofer.Nombre);
            Assert.Equal("BCDF12", t.Patente);
            Assert.Equal("AB1234", t.PatenteCarro);
            Assert.Equal("2026-11-23", t.FechaSalida);
            Assert.Equal("09:30", t.HoraSalida);
            Assert.Equal("2026-11-23", t.FechaLlegada);
            Assert.Null(t.Diferido);
        }

        [Fact]
        public void Autogestionada_incompleta_informa_cada_udf()
        {
            var r = Validar(Completa(g => { g.SiiPatente = null; g.SiiRutChofer = ""; g.SiiFchSalida = null; g.EntregaCalle = null; g.EntregaNumero = null; g.Address2 = null; }));
            var e = string.Join(" | ", r.Errores);
            Assert.Contains("U_SII_Patente es obligatorio", e);
            Assert.Contains("U_SII_RutChofer es obligatorio", e);
            Assert.Contains("U_SII_FchSalida es obligatorio", e);
            Assert.Contains("dirección de entrega", e);
            Assert.Null(r.Cuerpo);
        }

        [Fact]
        public void Valida_rut_nombre_y_origen_en_par()
        {
            var r = Validar(Completa(g => { g.SiiRutTrans = "76543210-0"; g.SiiNomChofer = new string('X', 31); g.SiiCmnaOrigen = ""; }));
            var e = string.Join(" | ", r.Errores);
            Assert.Contains("U_SII_RutTrans inválido", e);
            Assert.Contains("U_SII_NomChofer admite hasta 30", e);
            Assert.Contains("U_SII_DirOrigen y U_SII_CmnaOrigen", e);
        }

        [Fact]
        public void Tercerizada_informa_diferido_lo_vacio_y_respeta_sin_dato()
        {
            var r = Validar(Completa(g =>
            {
                g.SiiCatTraslado = "tercerizado";
                g.SiiRutTrans = "";
                g.SiiRutChofer = "";
                g.SiiNomChofer = "Sin dato";
                g.SiiPatente = "";
                g.SiiFchSalida = null;
                g.SiiHraSalida = null;
            }));
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            var t = r.Cuerpo!.Traslado!;
            Assert.Equal(new[] { "transportista", "choferRut", "patente", "fechaSalida" }, t.Diferido);
            Assert.Equal(new[] { "choferNombre" }, t.SinDato);
            Assert.Null(t.Chofer);
            Assert.Equal("AB1234", t.PatenteCarro);
        }

        [Fact]
        public void Regimen_especial_basta_con_lo_minimo_y_motivo_sin_precio_desde_comments()
        {
            var g = Datos.Guia();
            g.SiiCatTraslado = "REGIMEN_ESPECIAL";
            g.SiiIndTraslado = "6";
            g.Lines[0].UnitPrice = 0;
            g.Comments = "Guía habilitante SAG";
            var r = Validar(g);
            Assert.True(r.Ok, string.Join("; ", r.Errores));
            Assert.Equal("regimen_especial", r.Cuerpo!.Traslado!.Categoria);
            Assert.Equal("Guía habilitante SAG", r.Cuerpo.Traslado.MotivoSinPrecio);
            Assert.Null(r.Cuerpo.Traslado.Destino);
        }

        [Fact]
        public void Categoria_invalida_gdt_y_traslado_prolongado()
        {
            Assert.Contains(Validar(Completa(g => g.SiiCatTraslado = "OTRA")).Errores, e => e.Contains("U_SII_CatTraslado \"OTRA\""));
            Assert.Contains(Validar(Completa(g => g.SiiIndTraslado = "10")).Errores, e => e.Contains("GDT"));
            Assert.Contains(Validar(Completa(g => g.SiiIndTraslado = "13")).Errores, e => e.Contains("1 a 12"));

            var sin = string.Join(" | ", Validar(Completa(g => { g.SiiIndTraslado = "11"; g.SiiFchLlegada = null; g.Comments = null; })).Errores);
            Assert.Contains("U_SII_FchLlegada", sin);
            Assert.Contains("Comments", sin);

            var ok = Validar(Completa(g => { g.SiiIndTraslado = "11"; g.Comments = "Distancia Arica-Santiago"; }));
            Assert.True(ok.Ok, string.Join("; ", ok.Errores));
            Assert.Equal(11, ok.Cuerpo!.IdDoc.IndTraslado);
            Assert.Equal("Distancia Arica-Santiago", ok.Cuerpo.Traslado!.DescripcionProlongado);
        }

        [Fact]
        public void Udf_nuevos_coinciden_con_el_worker()
        {
            Assert.Equal("U_SII_CatTraslado", Udf.CatTraslado);
            Assert.Equal("U_SII_DirOrigen", Udf.DirOrigen);
            Assert.Equal("U_SII_CmnaOrigen", Udf.CmnaOrigen);
            Assert.Equal("U_SII_RutTrans", Udf.RutTrans);
            Assert.Equal("U_SII_RutChofer", Udf.RutChofer);
            Assert.Equal("U_SII_NomChofer", Udf.NomChofer);
            Assert.Equal("U_SII_Patente", Udf.Patente);
            Assert.Equal("U_SII_PatenteCarro", Udf.PatenteCarro);
            Assert.Equal("U_SII_FchSalida", Udf.FchSalida);
            Assert.Equal("U_SII_HraSalida", Udf.HraSalida);
            Assert.Equal("U_SII_FchLlegada", Udf.FchLlegada);
        }
    }
}
