using System.Collections.Generic;
using SapB1Addon.Core.Modelos;

namespace SapB1Addon.Core
{
    /// <summary>
    /// Acceso al documento de B1 sobre el que actúa el usuario (formulario abierto o DocEntry vía DI API).
    /// La implementación real vive en SapB1Addon.UI; las pruebas usan un fake.
    /// </summary>
    public interface IDocumentoB1
    {
        /// <summary>Cabecera y líneas con los UDF. <c>DocEntry</c> es 0 si el documento aún no se ha agregado.</summary>
        CabeceraDocumento LeerCabecera();

        /// <summary>Socio de negocios; null si no existe. Lanza ante fallos transitorios.</summary>
        SocioNegocio? LeerSocio(string cardCode);

        /// <summary>Documento base (folio, tipo y fecha); null si no se puede leer.</summary>
        BaseInfo? LeerBase(int objType, int docEntry);
    }

    /// <summary>Escribe UDF <c>U_SII_*</c> en un documento ya agregado (DI API) y refresca el formulario.</summary>
    public interface IEscritorUdf
    {
        /// <summary>Claves: nombre del UDF (clase <see cref="Udf"/>); valores: string, long o null (vacía el campo).</summary>
        void Escribir(int objType, int docEntry, IReadOnlyDictionary<string, object?> cambios);
    }

    /// <summary>Adjunta el PDF al documento (opcional; un fallo no bloquea la emisión).</summary>
    public interface IAdjuntadorPdf
    {
        /// <returns>true si quedó adjunto.</returns>
        bool Adjuntar(int objType, int docEntry, string rutaPdf);
    }

    public enum NivelMensaje
    {
        Informacion,
        Exito,
        Advertencia,
        Error,
    }

    /// <summary>Barra de estado y cuadros de diálogo de B1.</summary>
    public interface IMensajes
    {
        /// <summary>Mensaje breve (StatusBar).</summary>
        void Estado(string texto, NivelMensaje nivel);

        /// <summary>Cuadro de diálogo con el detalle (MessageBox).</summary>
        void Aviso(string titulo, string texto);
    }

    public interface IAbridorArchivos
    {
        void Abrir(string ruta);
    }

    public interface IAlmacenConfiguracion
    {
        ConfiguracionAddon Cargar();
        void Guardar(ConfiguracionAddon configuracion);
    }
}
