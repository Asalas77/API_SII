using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using SapB1Addon.Core;
using SapB1Addon.Core.Controladores;
using SapB1Addon.Core.Modelos;
using Xunit;

namespace SapB1Addon.Core.Tests
{
    public class EmitirTests
    {
        [Fact]
        public void Emitir_escribe_EMITIDO_con_folio_docid_y_clave()
        {
            using var e = new Escenario();
            var r = e.Emitir().Ejecutar();

            Assert.True(r.Exito, r.Mensaje);
            Assert.Equal(EstadoSii.Emitido, r.EstadoB1);
            var c = e.Doc.Cab;
            Assert.Equal(EstadoSii.Emitido, c.SiiEstado);
            Assert.Equal(1000, c.SiiFolio);
            Assert.Equal("doc-1", c.SiiDocId);
            Assert.Equal("33", c.SiiTipoDte);
            Assert.Equal("b1:76086428-5:13:100", c.SiiIdemKey);
            Assert.Equal("https://api.prueba.cl/v1/documentos/doc-1/pdf", c.SiiPdfUrl);
            Assert.Equal("https://api.prueba.cl/v1/documentos/doc-1/xml", c.SiiXmlUrl);
            Assert.Equal("", c.SiiGlosa);
            // Primero ENVIANDO (bloqueo lógico frente al worker), luego EMITIDO.
            Assert.Equal(new[] { EstadoSii.Enviando, EstadoSii.Emitido }, e.Udf.Estados.ToArray());
        }

        [Fact]
        public void La_peticion_lleva_bearer_idempotency_key_y_ruta_correctas()
        {
            using var e = new Escenario();
            e.Emitir().Ejecutar();
            var p = e.Servidor.Emisiones.Single();
            Assert.Equal("/v1/empresas/76086428-5/documentos", p.Ruta);
            Assert.Equal("b1:76086428-5:13:100", p.ClaveIdempotencia);
            Assert.Equal("Bearer " + Constantes.ApiKey, p.Autorizacion);
        }

        [Fact]
        public void Documento_nuevo_sin_docentry_no_se_emite()
        {
            using var e = new Escenario(Datos.Factura(0));
            var r = e.Emitir().Ejecutar();
            Assert.False(r.Exito);
            Assert.Contains("Agregue el documento", r.Mensaje);
            Assert.Empty(e.Servidor.Peticiones);
            Assert.Empty(e.Udf.Escrituras);
        }

        [Theory]
        [InlineData("EMITIDO")]
        [InlineData("ENVIADO")]
        [InlineData("ACEPTADO")]
        [InlineData("REPAROS")]
        [InlineData("RECHAZADO")]
        public void Documento_ya_emitido_no_se_vuelve_a_emitir(string estado)
        {
            var cab = Datos.Factura();
            cab.SiiEstado = estado;
            cab.SiiFolio = 777;
            cab.SiiDocId = "doc-x";
            using var e = new Escenario(cab);

            Assert.False(Disponibilidad.De(cab).Emitir);
            var r = e.Emitir().Ejecutar();

            Assert.False(r.Exito);
            Assert.Contains("ya fue emitido", r.Mensaje);
            Assert.Contains("777", r.Mensaje);
            Assert.Empty(e.Servidor.Peticiones);
            Assert.Empty(e.Udf.Escrituras);
        }

        [Fact]
        public void Emitir_dos_veces_seguidas_la_segunda_se_rechaza_sin_llamar_a_la_api()
        {
            using var e = new Escenario();
            Assert.True(e.Emitir().Ejecutar().Exito);
            var segunda = e.Emitir().Ejecutar();
            Assert.False(segunda.Exito);
            Assert.Single(e.Servidor.Emisiones);
            Assert.Equal(1, e.Servidor.FoliosAsignados);
        }

        [Fact]
        public void Error_transitorio_deja_ENVIANDO_y_el_reintento_usa_la_misma_clave_sin_doble_folio()
        {
            using var e = new Escenario();
            int llamadas = 0;
            e.Servidor.Interceptor = p =>
            {
                if (p.Ruta.EndsWith("/documentos") && ++llamadas == 1)
                    return ApiSimulada.Problema(HttpStatusCode.ServiceUnavailable, "NO_DISPONIBLE", "mantenimiento");
                return null;
            };

            var primera = e.Emitir().Ejecutar();
            Assert.False(primera.Exito);
            Assert.Equal(EstadoSii.Enviando, e.Doc.Cab.SiiEstado);
            Assert.Contains("misma Idempotency-Key", primera.Mensaje);
            Assert.Equal("b1:76086428-5:13:100", e.Doc.Cab.SiiIdemKey);

            Assert.True(Disponibilidad.De(e.Doc.Cab).Emitir); // se puede reintentar
            var segunda = e.Emitir().Ejecutar();
            Assert.True(segunda.Exito, segunda.Mensaje);

            var claves = e.Servidor.Emisiones.Select(p => p.ClaveIdempotencia).ToArray();
            Assert.Equal(2, claves.Length);
            Assert.Equal(claves[0], claves[1]);
            Assert.Equal(1, e.Servidor.FoliosAsignados);
            Assert.Equal(1000, e.Doc.Cab.SiiFolio);
        }

        [Fact]
        public void Respuesta_perdida_tras_crear_el_documento_no_consume_otro_folio()
        {
            using var e = new Escenario();
            e.Servidor.PerderRespuestaTrasCrear = true;

            var primera = e.Emitir().Ejecutar();
            Assert.False(primera.Exito);
            Assert.Equal(EstadoSii.Enviando, e.Doc.Cab.SiiEstado);

            var segunda = e.Emitir().Ejecutar();
            Assert.True(segunda.Exito, segunda.Mensaje);
            Assert.Contains("mismo folio", segunda.Mensaje); // 200 Idempotent-Replayed
            Assert.Equal(1, e.Servidor.FoliosAsignados);
            Assert.Equal(1000, e.Doc.Cab.SiiFolio);
        }

        [Fact]
        public void Estado_ENVIANDO_heredado_del_worker_reutiliza_su_clave()
        {
            var cab = Datos.Factura();
            cab.SiiEstado = EstadoSii.Enviando;
            cab.SiiIdemKey = "b1:76086428-5:13:100";
            using var e = new Escenario(cab);
            Assert.True(e.Emitir().Ejecutar().Exito);
            Assert.Equal("b1:76086428-5:13:100", e.Servidor.Emisiones.Single().ClaveIdempotencia);
        }

        [Fact]
        public void Error_422_pasa_a_ERROR_con_glosa_y_no_reintenta()
        {
            using var e = new Escenario();
            e.Servidor.Interceptor = p => p.Ruta.EndsWith("/documentos")
                ? ApiSimulada.Problema(HttpStatusCode.UnprocessableEntity, "DOCUMENTO_INVALIDO", "El documento no es válido", "detalle[0].cantidad debe ser positiva")
                : null;

            var r = e.Emitir().Ejecutar();

            Assert.False(r.Exito);
            Assert.Equal(EstadoSii.Error, e.Doc.Cab.SiiEstado);
            Assert.Contains("DOCUMENTO_INVALIDO", e.Doc.Cab.SiiGlosa);
            Assert.Contains("cantidad debe ser positiva", e.Doc.Cab.SiiGlosa);
            Assert.Contains("cantidad debe ser positiva", e.Msg.Todo);
            Assert.Single(e.Servidor.Emisiones);
            Assert.True(Disponibilidad.De(e.Doc.Cab).Emitir); // corregido el dato, se puede volver a emitir
        }

        [Fact]
        public void Error_409_sin_folios_pasa_a_ERROR_con_glosa()
        {
            using var e = new Escenario();
            e.Servidor.Interceptor = p => p.Ruta.EndsWith("/documentos")
                ? ApiSimulada.Problema(HttpStatusCode.Conflict, "SIN_FOLIOS_DISPONIBLES", "No hay folios disponibles para el tipo 33")
                : null;

            var r = e.Emitir().Ejecutar();

            Assert.False(r.Exito);
            Assert.Equal(EstadoSii.Error, e.Doc.Cab.SiiEstado);
            Assert.Contains("SIN_FOLIOS_DISPONIBLES", e.Doc.Cab.SiiGlosa);
            Assert.Null(e.Doc.Cab.SiiFolio);
            Assert.Equal(0, e.Servidor.FoliosAsignados);
        }

        [Theory]
        [InlineData(401)]
        [InlineData(403)]
        [InlineData(429)]
        [InlineData(500)]
        public void Estados_http_transitorios_dejan_ENVIANDO(int status)
        {
            using var e = new Escenario();
            e.Servidor.Interceptor = p => ApiSimulada.Problema((HttpStatusCode)status, "X", "falla");
            var r = e.Emitir().Ejecutar();
            Assert.False(r.Exito);
            Assert.Equal(EstadoSii.Enviando, e.Doc.Cab.SiiEstado);
            if (status == 401 || status == 403) Assert.Contains("API key", r.Mensaje);
        }

        [Fact]
        public void Validacion_fallida_escribe_ERROR_y_no_llama_a_la_api()
        {
            using var e = new Escenario();
            e.Doc.Socio = Datos.Socio("12345678-0");
            var r = e.Emitir().Ejecutar();
            Assert.False(r.Exito);
            Assert.Equal(EstadoSii.Error, e.Doc.Cab.SiiEstado);
            Assert.Contains("RUT del receptor inválido", e.Doc.Cab.SiiGlosa);
            Assert.Empty(e.Servidor.Peticiones);
        }

        [Fact]
        public void Configuracion_incompleta_no_llama_a_la_api()
        {
            using var e = new Escenario(config: new ConfiguracionAddon { ApiUrl = "", RutEmpresa = "1-2", ApiKey = "" });
            var r = e.Emitir().Ejecutar();
            Assert.False(r.Exito);
            Assert.Contains("Configure el add-on", r.Mensaje);
            Assert.Empty(e.Servidor.Peticiones);
        }

        [Fact]
        public void Falla_al_guardar_en_b1_tras_emitir_se_recupera_reintentando_sin_doble_folio()
        {
            using var e = new Escenario();
            int intentos = 0;
            e.Udf.Falla = cambios => cambios.ContainsKey(Udf.Folio) && ++intentos == 1 ? new InvalidOperationException("documento bloqueado") : null;

            var primera = e.Emitir().Ejecutar();
            Assert.False(primera.Exito);
            Assert.Contains("1000", primera.Mensaje);
            Assert.Equal(EstadoSii.Enviando, e.Doc.Cab.SiiEstado);

            var segunda = e.Emitir().Ejecutar();
            Assert.True(segunda.Exito, segunda.Mensaje);
            Assert.Equal(1, e.Servidor.FoliosAsignados);
        }

        [Fact]
        public void Una_excepcion_en_la_capa_sap_nunca_escapa_del_controlador()
        {
            using var e = new Escenario();
            e.Udf.Falla = _ => new InvalidOperationException("COM murió");
            var r = e.Emitir().Ejecutar(); // no lanza
            Assert.False(r.Exito);
            Assert.Contains("COM murió", r.Mensaje);
            Assert.Contains(e.Msg.EnEstado, m => m.Nivel == NivelMensaje.Error);
        }

        [Fact]
        public void Guia_y_nota_de_credito_se_emiten_con_su_clave_por_objtype()
        {
            using var g = new Escenario(Datos.Guia(300));
            Assert.True(g.Emitir().Ejecutar().Exito);
            Assert.Equal("b1:76086428-5:15:300", g.Doc.Cab.SiiIdemKey);
            Assert.Equal("52", g.Doc.Cab.SiiTipoDte);

            using var n = new Escenario(Datos.NotaCredito(200, 100));
            n.Doc.Bases["13:100"] = new BaseInfo { ObjType = 13, DocEntry = 100, DocDate = new DateTime(2026, 3, 10), Folio = 4321, TipoDte = 33 };
            var r = n.Emitir().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            Assert.Equal("b1:76086428-5:14:200", n.Doc.Cab.SiiIdemKey);
            Assert.Contains("\"folioRef\":\"4321\"", n.Servidor.Emisiones.Single().Cuerpo);
        }

        [Fact]
        public void Emitir_adjunta_el_pdf_y_un_fallo_del_adjunto_no_bloquea()
        {
            using var e = new Escenario();
            Assert.True(e.Emitir().Ejecutar().Exito);
            var a = Assert.Single(e.Adjuntador.Llamadas);
            Assert.Equal((13, 100), (a.ObjType, a.DocEntry));
            Assert.True(File.Exists(a.Ruta));

            using var e2 = new Escenario();
            e2.Adjuntador.Lanza = true;
            var r = e2.Emitir().Ejecutar();
            Assert.True(r.Exito);
            Assert.Equal(EstadoSii.Emitido, e2.Doc.Cab.SiiEstado);
            Assert.Contains(e2.Msg.Avisos, x => x.Texto.Contains("No se pudo adjuntar"));
        }

        [Fact]
        public void Con_EnviarAlEmitir_se_envia_al_sii_y_queda_ENVIADO_con_track_id()
        {
            var cfg = Datos.Config();
            cfg.EnviarAlEmitir = true;
            using var e = new Escenario(config: cfg);
            var r = e.Emitir().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            Assert.Equal(EstadoSii.Enviado, e.Doc.Cab.SiiEstado);
            Assert.Equal("9876543210", e.Doc.Cab.SiiTrackId);
            Assert.Contains(e.Servidor.Peticiones, p => p.Ruta == "/v1/empresas/76086428-5/envios");
        }

        [Fact]
        public void Si_el_envio_falla_el_documento_queda_EMITIDO_y_se_avisa()
        {
            var cfg = Datos.Config();
            cfg.EnviarAlEmitir = true;
            using var e = new Escenario(config: cfg);
            e.Servidor.Interceptor = p => p.Ruta.EndsWith("/envios") ? ApiSimulada.Problema(HttpStatusCode.BadGateway, "SII_NO_DISPONIBLE", "SII caído") : null;
            var r = e.Emitir().Ejecutar();
            Assert.True(r.Exito);
            Assert.Equal(EstadoSii.Emitido, e.Doc.Cab.SiiEstado);
            Assert.Contains(r.Advertencias, a => a.Contains("envío al SII falló"));
        }
    }

    public class ReenviarYEstadoTests
    {
        private static CabeceraDocumento Emitida(string estado = EstadoSii.Emitido)
        {
            var c = Datos.Factura();
            c.SiiEstado = estado;
            c.SiiFolio = 1000;
            c.SiiDocId = "doc-1";
            c.SiiTipoDte = "33";
            c.SiiIdemKey = "b1:76086428-5:13:100";
            return c;
        }

        [Fact]
        public void Reenviar_envia_un_documento_EMITIDO()
        {
            using var e = new Escenario(Emitida());
            Assert.True(Disponibilidad.De(e.Doc.Cab).Reenviar);
            var r = e.Reenviar().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            Assert.Equal(EstadoSii.Enviado, e.Doc.Cab.SiiEstado);
            Assert.Equal("9876543210", e.Doc.Cab.SiiTrackId);
        }

        [Fact]
        public void Reenviar_no_aplica_a_ENVIADO_ni_a_documentos_sin_emitir()
        {
            using var e = new Escenario(Emitida(EstadoSii.Enviado));
            var r = e.Reenviar().Ejecutar();
            Assert.False(r.Exito);
            Assert.Contains("Consultar estado", r.Mensaje);
            Assert.False(Disponibilidad.De(e.Doc.Cab).Reenviar);

            using var e2 = new Escenario(Datos.Factura());
            Assert.False(e2.Reenviar().Ejecutar().Exito);
            Assert.Empty(e2.Servidor.Peticiones);
        }

        [Fact]
        public void Reenviar_con_409_sincroniza_con_el_estado_de_la_api()
        {
            using var e = new Escenario(Emitida());
            e.Servidor.EstadoApi = "aceptado";
            e.Servidor.Interceptor = p => p.Ruta.EndsWith("/envios") ? ApiSimulada.Problema(HttpStatusCode.Conflict, "ESTADO_INVALIDO", "ya enviado") : null;
            var r = e.Reenviar().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            Assert.Equal(EstadoSii.Aceptado, e.Doc.Cab.SiiEstado);
        }

        [Theory]
        [InlineData("aceptado", "ACEPTADO")]
        [InlineData("aceptado_con_reparos", "REPAROS")]
        [InlineData("rechazado", "RECHAZADO")]
        public void Consultar_estado_traduce_el_resultado_del_sii(string estadoApi, string esperado)
        {
            using var e = new Escenario(Emitida(EstadoSii.Enviado));
            e.Servidor.EstadoApi = estadoApi;
            e.Servidor.EstadoSii = estadoApi == "rechazado" ? "RCH" : "DOK";
            e.Servidor.GlosaSii = estadoApi == "rechazado" ? "Rechazado por error en firma" : "Documento recibido";
            e.Servidor.Reparos = estadoApi == "aceptado_con_reparos" ? "Giro del receptor no coincide" : null;

            var r = e.Consultar().Ejecutar();

            Assert.Equal(esperado, e.Doc.Cab.SiiEstado);
            Assert.Equal(esperado, r.EstadoB1);
            Assert.Equal(estadoApi != "rechazado", r.Exito);
            Assert.Equal("9876543210", e.Doc.Cab.SiiTrackId);
            if (esperado == "REPAROS") Assert.Contains("Reparos: Giro del receptor no coincide", e.Doc.Cab.SiiGlosa);
            if (esperado == "RECHAZADO") Assert.Contains("Rechazado por error en firma", e.Doc.Cab.SiiGlosa);
        }

        [Fact]
        public void Consultar_estado_con_el_sii_aun_procesando_no_cambia_el_estado()
        {
            using var e = new Escenario(Emitida(EstadoSii.Enviado));
            e.Servidor.EstadoApi = "enviado";
            var r = e.Consultar().Ejecutar();
            Assert.True(r.Exito);
            Assert.Equal(EstadoSii.Enviado, e.Doc.Cab.SiiEstado);
            Assert.Empty(e.Udf.Escrituras);
        }

        [Fact]
        public void Consultar_estado_con_409_vuelve_a_EMITIDO()
        {
            using var e = new Escenario(Emitida(EstadoSii.Enviado));
            e.Servidor.Interceptor = p => p.Ruta.EndsWith("/consultar-estado") ? ApiSimulada.Problema(HttpStatusCode.Conflict, "NO_ENVIADO", "El documento aún no se envió") : null;
            var r = e.Consultar().Ejecutar();
            Assert.False(r.Exito);
            Assert.Equal(EstadoSii.Emitido, e.Doc.Cab.SiiEstado);
        }

        [Fact]
        public void Consultar_estado_solo_aplica_a_ENVIADO()
        {
            using var e = new Escenario(Emitida(EstadoSii.Aceptado));
            Assert.False(Disponibilidad.De(e.Doc.Cab).ConsultarEstado);
            var r = e.Consultar().Ejecutar();
            Assert.True(r.Exito);
            Assert.Contains("final", r.Mensaje);
            Assert.Empty(e.Servidor.Peticiones);

            using var e2 = new Escenario(Emitida(EstadoSii.Emitido));
            Assert.False(e2.Consultar().Ejecutar().Exito);
        }
    }

    public class VerPdfTests
    {
        private static CabeceraDocumento Emitida()
        {
            var c = Datos.Factura();
            c.SiiEstado = EstadoSii.Emitido;
            c.SiiFolio = 1000;
            c.SiiDocId = "doc-1";
            c.SiiTipoDte = "33";
            return c;
        }

        [Fact]
        public void Ver_pdf_guarda_en_la_carpeta_temporal_y_lo_abre()
        {
            using var e = new Escenario(Emitida());
            var r = e.VerPdf().Ejecutar();
            Assert.True(r.Exito, r.Mensaje);
            var ruta = Assert.Single(e.Abridor.Abiertos);
            Assert.StartsWith(e.Carpeta, ruta);
            Assert.EndsWith("DTE_33_1000.pdf", ruta);
            Assert.True(File.Exists(ruta));
            Assert.Equal(e.Servidor.Pdf, File.ReadAllBytes(ruta));
            Assert.Contains(e.Servidor.Peticiones, p => p.Ruta == "/v1/documentos/doc-1/pdf" && p.Autorizacion == "Bearer " + Constantes.ApiKey);
        }

        [Fact]
        public void El_nombre_del_archivo_nunca_lo_dicta_el_servidor()
        {
            // El simulador responde con filename "../../peligroso.pdf".
            using var e = new Escenario(Emitida());
            e.VerPdf().Ejecutar();
            var ruta = Assert.Single(e.Abridor.Abiertos);
            Assert.DoesNotContain("peligroso", ruta);
            Assert.Equal(Path.GetFullPath(e.Carpeta), Path.GetDirectoryName(Path.GetFullPath(ruta)));
        }

        [Fact]
        public void Ver_pdf_sin_emitir_o_con_error_de_api_no_abre_nada()
        {
            using var e = new Escenario(Datos.Factura());
            Assert.False(e.VerPdf().Ejecutar().Exito);

            using var e2 = new Escenario(Emitida());
            e2.Servidor.Interceptor = p => ApiSimulada.Problema(HttpStatusCode.NotFound, "NO_ENCONTRADO", "documento inexistente");
            var r = e2.VerPdf().Ejecutar();
            Assert.False(r.Exito);
            Assert.Empty(e2.Abridor.Abiertos);
        }
    }

    public class SeguridadTests
    {
        [Fact]
        public void La_api_key_no_aparece_en_mensajes_aunque_el_servidor_la_devuelva_en_el_error()
        {
            using var e = new Escenario();
            e.Servidor.Interceptor = p => ApiSimulada.Problema(HttpStatusCode.UnprocessableEntity, "DOCUMENTO_INVALIDO",
                "Credencial " + Constantes.ApiKey + " no autorizada", "clave=" + Constantes.ApiKey);

            var r = e.Emitir().Ejecutar();

            Assert.False(r.Exito);
            AssertSinClave(r.Mensaje);
            AssertSinClave(e.Msg.Todo);
            AssertSinClave(e.Doc.Cab.SiiGlosa);
            foreach (var w in e.Udf.Escrituras) foreach (var v in w.Values) AssertSinClave(v as string);
        }

        [Fact]
        public void La_api_key_no_aparece_en_errores_de_red()
        {
            using var e = new Escenario();
            e.Servidor.Interceptor = p => throw new HttpRequestException("fallo conectando con Authorization: Bearer " + Constantes.ApiKey);
            var r = e.Emitir().Ejecutar();
            Assert.False(r.Exito);
            AssertSinClave(r.Mensaje);
            AssertSinClave(e.Msg.Todo);
        }

        [Fact]
        public void La_api_key_solo_viaja_en_la_cabecera_authorization()
        {
            using var e = new Escenario();
            e.Emitir().Ejecutar();
            foreach (var p in e.Servidor.Peticiones)
            {
                Assert.DoesNotContain(Constantes.ApiKey, p.Cuerpo);
                Assert.DoesNotContain(Constantes.ApiKey, p.Ruta);
            }
            foreach (var w in e.Udf.Escrituras) foreach (var v in w.Values) AssertSinClave(v as string);
        }

        [Fact]
        public void La_configuracion_oculta_la_clave_en_ToString()
        {
            AssertSinClave(Datos.Config().ToString());
            Assert.Contains("***", Datos.Config().ToString());
        }

        [Fact]
        public void Serializar_la_configuracion_nunca_incluye_la_api_key()
        {
            var json = System.Text.Json.JsonSerializer.Serialize(Datos.Config());
            AssertSinClave(json);
            Assert.DoesNotContain("ApiKey", json);
            Assert.Contains("76.086.428-5", json);
        }

        [Fact]
        public void Excepcion_inesperada_con_la_clave_tambien_se_redacta()
        {
            using var e = new Escenario();
            e.Udf.Falla = _ => new InvalidOperationException("fallo con " + Constantes.ApiKey);
            var r = e.Emitir().Ejecutar();
            AssertSinClave(r.Mensaje);
            AssertSinClave(e.Msg.Todo);
        }

        [Theory]
        [InlineData("", "76086428-5", "k", false)]
        [InlineData("ftp://x", "76086428-5", "k", false)]
        [InlineData("https://api.cl", "76086428-4", "k", false)]
        [InlineData("https://api.cl", "76086428-5", "", false)]
        [InlineData("https://api.cl", "76.086.428-5", "k", true)]
        public void Verificador_de_configuracion(string url, string rut, string clave, bool ok)
        {
            var errores = VerificadorConfiguracion.Errores(new ConfiguracionAddon { ApiUrl = url, RutEmpresa = rut, ApiKey = clave });
            Assert.Equal(ok, errores.Count == 0);
        }

        private static void AssertSinClave(string? texto)
        {
            if (texto == null) return;
            Assert.DoesNotContain(Constantes.ApiKey, texto);
            Assert.DoesNotContain("secretoSECRETO", texto);
        }
    }

    public class DisponibilidadTests
    {
        [Fact]
        public void Botones_segun_estado()
        {
            var nuevo = Datos.Factura(0);
            var d0 = Disponibilidad.De(nuevo);
            Assert.False(d0.Emitir);
            Assert.True(d0.Validar);

            var pendiente = Datos.Factura();
            Assert.True(Disponibilidad.De(pendiente).Emitir);
            Assert.False(Disponibilidad.De(pendiente).VerPdf);

            var enviado = Datos.Factura();
            enviado.SiiEstado = EstadoSii.Enviado;
            enviado.SiiFolio = 5;
            enviado.SiiDocId = "d";
            var d = Disponibilidad.De(enviado);
            Assert.False(d.Emitir);
            Assert.False(d.Reenviar);
            Assert.True(d.VerPdf);
            Assert.True(d.ConsultarEstado);
        }
    }
}
