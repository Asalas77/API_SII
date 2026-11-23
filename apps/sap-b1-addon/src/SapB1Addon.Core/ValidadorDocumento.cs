using System;
using System.Collections.Generic;
using System.Linq;
using SapB1Addon.Core.Api;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core
{
    public class ResultadoValidacion
    {
        public CabeceraDocumento Cabecera { get; set; } = new CabeceraDocumento();
        /// <summary>Cuerpo de emisión listo para la API; null si hay errores.</summary>
        public CuerpoDocumento? Cuerpo { get; set; }
        public int TipoDte { get; set; }
        public List<string> Errores { get; } = new List<string>();
        public List<string> Advertencias { get; } = new List<string>();
        public bool Ok => Errores.Count == 0;
    }

    /// <summary>
    /// Validaciones previas al "Agregar" y a la emisión: RUT/DV del receptor, giro, dirección y comuna,
    /// tipo SII permitido para el objeto, IndTraslado en entregas, ítem afecto en 33/39, límites de
    /// líneas y referencia con folio en notas. Reutiliza <see cref="MapeadorDocumento"/> (reglas del
    /// worker) y agrega la exigencia de giro/dirección/comuna en facturas 33/34.
    /// </summary>
    public static class ValidadorDocumento
    {
        public static ResultadoValidacion Validar(IDocumentoB1 documento, ConfiguracionAddon config)
        {
            var cab = documento.LeerCabecera();
            return Validar(documento, cab, config);
        }

        public static ResultadoValidacion Validar(IDocumentoB1 documento, CabeceraDocumento cab, ConfiguracionAddon config)
        {
            var res = new ResultadoValidacion { Cabecera = cab };

            SocioNegocio? socio = null;
            try
            {
                if (!string.IsNullOrWhiteSpace(cab.CardCode)) socio = documento.LeerSocio(cab.CardCode);
            }
            catch (Exception e)
            {
                res.Errores.Add("No se pudo leer el socio de negocios " + cab.CardCode + ": " + Secretos.Redactar(e.Message, config.ApiKey));
                return res;
            }
            if (string.IsNullOrWhiteSpace(cab.CardCode))
            {
                res.Errores.Add("Seleccione el socio de negocios (cliente) del documento");
                return res;
            }

            var bases = new Dictionary<string, BaseInfo>();
            if (MapeadorDocumento.RequiereBases(cab))
            {
                foreach (var b in MapeadorDocumento.BasesDe(cab))
                {
                    try
                    {
                        var info = documento.LeerBase(b.Key, b.Value);
                        if (info != null) bases[MapeadorDocumento.ClaveBase(b.Key, b.Value)] = info;
                    }
                    catch (Exception e)
                    {
                        res.Errores.Add("No se pudo leer el documento base (ObjType " + b.Key + ", DocEntry " + b.Value + "): " +
                                        Secretos.Redactar(e.Message, config.ApiKey));
                        return res;
                    }
                }
            }

            var mapeo = MapeadorDocumento.Mapear(cab, new ContextoMapeo { Config = config, Socio = socio, Bases = bases });
            res.TipoDte = mapeo.TipoDte;
            res.Errores.AddRange(mapeo.Errores);
            res.Advertencias.AddRange(mapeo.Advertencias);

            // Más estricto que el worker: SII exige giro, dirección y comuna del receptor en facturas.
            if (mapeo.Ok && config.ExigirDatosReceptor && (mapeo.TipoDte == 33 || mapeo.TipoDte == 34) && mapeo.Cuerpo?.Receptor != null)
            {
                var r = mapeo.Cuerpo.Receptor;
                if (string.IsNullOrEmpty(r.Giro))
                {
                    res.Errores.Add("El socio " + cab.CardCode + " no tiene giro (" + Udf.Giro + "): las facturas lo requieren");
                    res.Advertencias.RemoveAll(a => a.Contains(Udf.Giro));
                }
                if (string.IsNullOrEmpty(r.Direccion)) res.Errores.Add("El socio " + cab.CardCode + " no tiene dirección de facturación");
                if (string.IsNullOrEmpty(r.Comuna)) res.Errores.Add("El socio " + cab.CardCode + " no tiene comuna en su dirección de facturación");
            }

            if (res.Errores.Count == 0) res.Cuerpo = mapeo.Cuerpo;
            return res;
        }

        /// <summary>Texto multilínea con los errores (para MessageBox y U_SII_Glosa).</summary>
        public static string Resumen(IEnumerable<string> lineas, int max = 2000)
        {
            var t = string.Join("\n", lineas);
            return t.Length > max ? t.Substring(0, max - 3) + "..." : t;
        }
    }
}
