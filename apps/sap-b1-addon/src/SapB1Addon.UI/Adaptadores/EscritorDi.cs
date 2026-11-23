using System;
using System.Collections.Generic;
using System.IO;
using SapB1Addon.Core;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>Escribe los UDF <c>U_SII_*</c> con la DI API (<c>Documents.GetByKey</c> + <c>Update</c>).</summary>
    internal sealed class EscritorUdfDi : IEscritorUdf
    {
        private readonly ConexionDi _di;

        public EscritorUdfDi(ConexionDi di)
        {
            _di = di;
        }

        public void Escribir(int objType, int docEntry, IReadOnlyDictionary<string, object?> cambios)
        {
            var doc = (SAPbobsCOM.Documents)_di.Company.GetBusinessObject(_di.TipoDocumento(objType));
            SAPbobsCOM.Fields? campos = null;
            try
            {
                if (!doc.GetByKey(docEntry)) throw new InvalidOperationException("No existe el documento (ObjType " + objType + ", DocEntry " + docEntry + ").");
                campos = doc.UserFields.Fields;
                foreach (var kv in cambios)
                {
                    SAPbobsCOM.Field? f = null;
                    try
                    {
                        f = campos.Item(kv.Key);
                    }
                    catch (System.Runtime.InteropServices.COMException)
                    {
                        throw new InvalidOperationException("No existe el campo " + kv.Key + " en el documento. Ejecute `npm run instalar-udfs` del worker.");
                    }
                    try
                    {
                        // Numéricos (U_SII_Folio) como double; el resto como texto. null vacía el campo.
                        if (kv.Value == null) f.Value = "";
                        else if (kv.Value is long || kv.Value is int) f.Value = Convert.ToDouble(kv.Value);
                        else f.Value = Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture) ?? "";
                    }
                    finally
                    {
                        Com.Liberar(f);
                    }
                }
                int rc = doc.Update();
                if (rc != 0) throw new InvalidOperationException(_di.UltimoError());
            }
            finally
            {
                Com.Liberar(campos, doc);
            }
        }
    }

    /// <summary>
    /// Adjunta el PDF con <c>Attachments2</c> (DI API) y enlaza <c>AttachmentEntry</c> al documento.
    /// Requiere la carpeta de anexos configurada en B1 (Administración &gt; Inicialización del sistema &gt;
    /// Configuración general &gt; Rutas); el archivo se copia ahí.
    /// </summary>
    internal sealed class AdjuntadorPdfDi : IAdjuntadorPdf
    {
        private readonly ConexionDi _di;

        public AdjuntadorPdfDi(ConexionDi di)
        {
            _di = di;
        }

        public bool Adjuntar(int objType, int docEntry, string rutaPdf)
        {
            var att = (SAPbobsCOM.Attachments2)_di.Company.GetBusinessObject(SAPbobsCOM.BoObjectTypes.oAttachments2);
            SAPbobsCOM.Attachments2_Lines? lineas = null;
            try
            {
                lineas = att.Lines;
                lineas.Add();
                lineas.SourcePath = Path.GetDirectoryName(rutaPdf);
                lineas.FileName = Path.GetFileNameWithoutExtension(rutaPdf);
                lineas.FileExtension = Path.GetExtension(rutaPdf).TrimStart('.');
                if (att.Add() != 0) throw new InvalidOperationException(_di.UltimoError());
                int entrada = int.Parse(_di.Company.GetNewObjectKey(), System.Globalization.CultureInfo.InvariantCulture);

                var doc = (SAPbobsCOM.Documents)_di.Company.GetBusinessObject(_di.TipoDocumento(objType));
                try
                {
                    if (!doc.GetByKey(docEntry)) return false;
                    doc.AttachmentEntry = entrada;
                    if (doc.Update() != 0) throw new InvalidOperationException(_di.UltimoError());
                    return true;
                }
                finally
                {
                    Com.Liberar(doc);
                }
            }
            finally
            {
                Com.Liberar(lineas, att);
            }
        }
    }
}
