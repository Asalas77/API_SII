import { parsearCaf } from './caf/caf.js';
import { verificarFirmaXml, firmarXml } from './firma/firma.js';
import { generarCafPrueba, generarCertificadoPrueba } from './testing/testing.js';
import { generarTed, verificarTed } from './ted/ted.js';
import { aIso88591, desdeIso88591 } from './xml/xml.util.js';
import { validarXsd } from './xsd/xsd.js';

/** Integración: CAF de prueba -> TED -> DTE firmado -> XSD oficial. */
describe('integración dte-core', () => {
  const caf = parsearCaf(generarCafPrueba({ tipoDte: 33, folioDesde: 1, folioHasta: 10, rutEmisor: '76086428-5' }));
  const cert = generarCertificadoPrueba({ rut: '12345678-5' });

  it('un DTE completo con TED y firma valida contra DTE_v10.xsd', () => {
    const ted = generarTed(
      {
        rutEmisor: '76086428-5', tipoDte: 33, folio: 1, fechaEmision: '2026-02-01',
        rutReceptor: '66666666-6', razonSocialReceptor: 'Cliente Ñandú', monto: 1190,
        itemPrimero: 'Servicio', timestamp: '2026-02-01T10:00:00',
      },
      caf,
    );
    expect(verificarTed(ted, caf.clavePublicaPem)).toBe(true);

    const dte =
      '<DTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><Documento ID="F1T33"><Encabezado>' +
      '<IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>2026-02-01</FchEmis></IdDoc>' +
      '<Emisor><RUTEmisor>76086428-5</RUTEmisor><RznSoc>EMPRESA DE PRUEBA SPA</RznSoc><GiroEmis>Servicios</GiroEmis>' +
      '<Acteco>620200</Acteco><CmnaOrigen>Santiago</CmnaOrigen></Emisor>' +
      '<Receptor><RUTRecep>66666666-6</RUTRecep><RznSocRecep>Cliente Ñandú</RznSocRecep><GiroRecep>Comercio</GiroRecep>' +
      '<DirRecep>Calle 1</DirRecep><CmnaRecep>Santiago</CmnaRecep></Receptor>' +
      '<Totales><MntNeto>1000</MntNeto><TasaIVA>19</TasaIVA><IVA>190</IVA><MntTotal>1190</MntTotal></Totales></Encabezado>' +
      '<Detalle><NroLinDet>1</NroLinDet><NmbItem>Servicio</NmbItem><QtyItem>1</QtyItem><PrcItem>1000</PrcItem><MontoItem>1000</MontoItem></Detalle>' +
      `${ted}<TmstFirma>2026-02-01T10:00:00</TmstFirma></Documento></DTE>`;

    const firmado = firmarXml(dte, { ...cert, idReferencia: 'F1T33' });
    expect(verificarFirmaXml(firmado).valida).toBe(true);

    // El XML se envía en ISO-8859-1: la firma debe seguir verificando tras la ida y vuelta.
    const bytes = aIso88591(firmado);
    expect(verificarFirmaXml(desdeIso88591(bytes)).valida).toBe(true);

    const r = validarXsd(bytes, 'DTE');
    expect(r.errores).toEqual([]);
    expect(r.valido).toBe(true);
  });
});
