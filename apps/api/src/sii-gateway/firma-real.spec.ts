/**
 * Integración gateway + firma real de dte-core: la semilla que llega al SII debe traer una firma
 * XMLDSig verificable (URI="" enveloped) y respetar el formato de dos líneas del token.
 */
import { crearFirmadorSii, verificarFirmaXml } from '../dte-core/index.js';
import { generarCertificadoPrueba } from '../dte-core/testing/testing.js';
import { BoletaApiClient } from './boleta/boleta-api.client.js';
import { almacenNuevo, crearFetchSimulado, resp, sinEspera } from './comun/testing.js';
import { escaparXml } from './comun/xml.js';
import { DteSiiClient } from './dte/dte-sii.client.js';

const cert = generarCertificadoPrueba({ rut: '8315495-0' });
const firmador = crearFirmadorSii(cert);
const SEMILLA = '030530912644';

function soap(operacion: string, retorno: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soapenv:Body><ns1:${operacion}Response xmlns:ns1="x"><${operacion}Return>${escaparXml(retorno)}</${operacion}Return>` +
    `</ns1:${operacion}Response></soapenv:Body></soapenv:Envelope>`
  );
}

function verificarSemillaFirmada(xml: string): void {
  expect(xml.split('\n')).toHaveLength(2);
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item>')).toBe(true);
  expect(xml).toContain(`<Semilla>${SEMILLA}</Semilla>`);
  expect(xml).toContain('<Reference URI="">');
  expect(xml.endsWith('</Signature></getToken>')).toBe(true);
  expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
}

describe('gateway + firma real (semilla)', () => {
  it('BoletaApiClient.obtenerToken envía la semilla con firma válida', async () => {
    const f = crearFetchSimulado([
      resp(
        `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>${SEMILLA}</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`,
      ),
      resp(
        '<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>TOK1</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>',
      ),
    ]);
    const cliente = new BoletaApiClient({
      ambiente: 'certificacion',
      rutEmpresa: '45000054',
      dvEmpresa: 'K',
      rutUsuario: '8315495',
      dvUsuario: '0',
      firmador,
      fetchImpl: f,
      reintentos: { esperar: sinEspera() },
      cacheToken: { almacen: almacenNuevo() },
    });
    expect(await cliente.obtenerToken()).toBe('TOK1');
    verificarSemillaFirmada((f.mock.calls[1][1]?.body as string));
  });

  it('DteSiiClient.obtenerToken envía en pszXml la semilla con firma válida', async () => {
    const respuesta = (op: string, cuerpo: string) =>
      resp(
        soap(
          op,
          `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR><SII:RESP_BODY>${cuerpo}</SII:RESP_BODY></SII:RESPUESTA>`,
        ),
        200,
        'text/xml',
      );
    const f = crearFetchSimulado([
      respuesta('getSeed', `<SEMILLA>${SEMILLA}</SEMILLA>`),
      respuesta('getToken', '<TOKEN>TOK2</TOKEN>'),
    ]);
    const cliente = new DteSiiClient({
      ambiente: 'certificacion',
      rutEmpresa: '76123456',
      dvEmpresa: '7',
      rutUsuario: '8315495',
      dvUsuario: '0',
      firmador,
      fetchImpl: f,
      reintentos: { esperar: sinEspera() },
      cacheToken: { almacen: almacenNuevo() },
    });
    expect(await cliente.obtenerToken()).toBe('TOK2');
    const envelope = (f.mock.calls[1][1]?.body as string);
    const m = /<pszXml>([\s\S]*)<\/pszXml>/.exec(envelope);
    expect(m).not.toBeNull();
    const desescapado = m![1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    verificarSemillaFirmada(desescapado);
  });
});

describe('DteSiiClient: clasificación de estados en las consultas', () => {
  it('getEstUp y getEstDte devuelven descripcionEstado y esFinal', async () => {
    const hdr = (estado: string) =>
      `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>${estado}</ESTADO><GLOSA>g</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`;
    const ok = (op: string, c: string) => resp(soap(op, c), 200, 'text/xml');
    const f = crearFetchSimulado([
      ok('getSeed', hdr('00').replace('</SII:RESP_HDR>', `</SII:RESP_HDR><SII:RESP_BODY><SEMILLA>${SEMILLA}</SEMILLA></SII:RESP_BODY>`)),
      ok('getToken', hdr('00').replace('</SII:RESP_HDR>', '</SII:RESP_HDR><SII:RESP_BODY><TOKEN>T</TOKEN></SII:RESP_BODY>')),
      ok('getEstUp', hdr('RSC')),
      ok('getEstUp', hdr('PDR')),
      ok('getEstDte', hdr('FAU')),
    ]);
    const cliente = new DteSiiClient({
      ambiente: 'certificacion',
      rutEmpresa: '76123456',
      dvEmpresa: '7',
      rutUsuario: '8315495',
      dvUsuario: '0',
      firmador,
      fetchImpl: f,
      reintentos: { esperar: sinEspera() },
      cacheToken: { almacen: almacenNuevo() },
    });
    expect(await cliente.consultarEstadoEnvio(1)).toMatchObject({
      estado: 'RSC',
      descripcionEstado: 'Rechazado por error en schema',
      esFinal: true,
    });
    expect(await cliente.consultarEstadoEnvio(1)).toMatchObject({ estado: 'PDR', esFinal: false });
    const r = await cliente.consultarEstadoDte({
      rutEmisor: '76123456', dvEmisor: '7', rutReceptor: '1', dvReceptor: '9', tipoDte: 33, folio: 1, fechaEmision: '14062024', monto: 100,
    });
    expect(r).toMatchObject({ estado: 'FAU', esFinal: false });
  });
});
