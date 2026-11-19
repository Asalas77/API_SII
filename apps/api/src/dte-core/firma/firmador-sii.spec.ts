import { generarCertificadoPrueba } from '../testing/testing.js';
import { verificarFirmaXml } from './firma.js';
import { crearFirmadorSii } from './firmador-sii.js';

const firmador = crearFirmadorSii(generarCertificadoPrueba({ rut: '12345678-9' }));

describe('crearFirmadorSii', () => {
  it('sin idReferencia firma el documento completo', () => {
    const f = firmador.firmarXml('<getToken><item><Semilla>1</Semilla></item></getToken>');
    expect(f).toContain('<Reference URI="">');
    expect(verificarFirmaXml(f).valida).toBe(true);
  });

  it('con idReferencia firma el elemento por ID', () => {
    const f = firmador.firmarXml('<Envio><SetDoc ID="SetDoc"><a>1</a></SetDoc></Envio>', 'SetDoc');
    expect(f).toContain('<Reference URI="#SetDoc">');
    expect(verificarFirmaXml(f).valida).toBe(true);
  });
});
