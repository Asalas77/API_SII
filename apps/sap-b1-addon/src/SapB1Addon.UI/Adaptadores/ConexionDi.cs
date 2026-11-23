using System;
using System.Runtime.InteropServices;

namespace SapB1Addon.UI.Adaptadores
{
    /// <summary>
    /// DI API sobre la sesión ya abierta de la UI API (<c>Company.GetDICompany()</c>): comparte
    /// usuario, company y licencia del cliente B1; no hace Connect propio.
    /// </summary>
    internal sealed class ConexionDi : IDisposable
    {
        private readonly SAPbouiCOM.Application _app;
        private SAPbobsCOM.Company? _company;

        public ConexionDi(SAPbouiCOM.Application app)
        {
            _app = app;
        }

        public SAPbobsCOM.Company Company
        {
            get
            {
                if (_company == null)
                {
                    _company = (SAPbobsCOM.Company)_app.Company.GetDICompany();
                }
                if (!_company.Connected) throw new InvalidOperationException("La DI API no está conectada a la company de B1.");
                return _company;
            }
        }

        /// <summary>Nombre de la base de la company (para separar la configuración por company).</summary>
        public string CompanyDb => _app.Company.DatabaseName;

        public SAPbobsCOM.BoObjectTypes TipoDocumento(int objType)
        {
            switch (objType)
            {
                case 13: return SAPbobsCOM.BoObjectTypes.oInvoices;
                case 14: return SAPbobsCOM.BoObjectTypes.oCreditNotes;
                case 15: return SAPbobsCOM.BoObjectTypes.oDeliveryNotes;
                default: throw new NotSupportedException("ObjType no soportado por el add-on: " + objType);
            }
        }

        /// <summary>Mensaje de error de la última operación de la DI API.</summary>
        public string UltimoError()
        {
            int codigo;
            string mensaje;
            Company.GetLastError(out codigo, out mensaje);
            return "DI API " + codigo + ": " + mensaje;
        }

        public void Dispose()
        {
            if (_company != null)
            {
                try
                {
                    Marshal.ReleaseComObject(_company);
                }
                catch
                {
                    // ya liberado
                }
                _company = null;
            }
        }
    }
}
