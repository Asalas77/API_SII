import {
  USER_AGENT_SII,
  baseBoleta,
  baseEnvioBoleta,
  hostDte,
  urlDte,
} from './ambientes.js';

describe('ambientes', () => {
  it('resuelve hosts DTE y rutas', () => {
    expect(hostDte('certificacion')).toBe('https://maullin.sii.cl');
    expect(hostDte('produccion')).toBe('https://palena.sii.cl');
    expect(urlDte('produccion', 'upload')).toBe('https://palena.sii.cl/cgi_dte/UPL/DTEUpload');
    expect(urlDte('certificacion', 'semilla')).toBe('https://maullin.sii.cl/DTEWS/CrSeed.jws');
    expect(urlDte('certificacion', 'token')).toBe('https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws');
    expect(urlDte('certificacion', 'estadoEnvio')).toBe('https://maullin.sii.cl/DTEWS/QueryEstUp.jws');
    expect(urlDte('certificacion', 'estadoDte')).toBe('https://maullin.sii.cl/DTEWS/QueryEstDte.jws');
  });

  it('resuelve bases de boleta y host alternativo de envío', () => {
    expect(baseBoleta('certificacion')).toBe('https://apicert.sii.cl/recursos/v1');
    expect(baseBoleta('produccion')).toBe('https://api.sii.cl/recursos/v1');
    expect(baseEnvioBoleta('certificacion')).toBe('https://apicert.sii.cl/recursos/v1');
    expect(baseEnvioBoleta('certificacion', true)).toBe('https://pangal.sii.cl/recursos/v1');
    expect(baseEnvioBoleta('produccion', true)).toBe('https://rahue.sii.cl/recursos/v1');
  });

  it('expone el User-Agent exigido', () => {
    expect(USER_AGENT_SII).toContain('YComp 5.0.2.4');
  });
});
