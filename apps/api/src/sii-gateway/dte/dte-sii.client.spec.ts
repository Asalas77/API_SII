import { USER_AGENT_SII } from '../ambientes.js';
import {
  SiiAutenticacionError,
  SiiEnvioDteError,
  SiiError,
  SiiServidorError,
} from '../comun/errores.js';
import {
  almacenNuevo,
  cabecera,
  crearFetchSimulado,
  crearFirmadorFalso,
  resp,
  sinEspera,
} from '../comun/testing.js';
import { escaparXml } from '../comun/xml.js';
import { DteSiiClient } from './dte-sii.client.js';

/** Envuelve un XML SII:RESPUESTA escapado, como lo hace Axis (rpc/encoded). */
function soapRespuesta(operacion: string, retorno: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<soapenv:Body><ns1:${operacion}Response soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:ns1="https://maullin.sii.cl/DTEWS/X.jws">` +
    `<${operacion}Return xsi:type="xsd:string">${escaparXml(retorno)}</${operacion}Return>` +
    `</ns1:${operacion}Response></soapenv:Body></soapenv:Envelope>`
  );
}

const SEMILLA = soapRespuesta(
  'getSeed',
  '<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR><SII:RESP_BODY><SEMILLA>1234567890123</SEMILLA></SII:RESP_BODY></SII:RESPUESTA>',
);
const token = (t = 'ABCDEF123', estado = '00') =>
  soapRespuesta(
    'getToken',
    `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>${estado}</ESTADO></SII:RESP_HDR><SII:RESP_BODY><TOKEN>${t}</TOKEN></SII:RESP_BODY></SII:RESPUESTA>`,
  );

const recepcion = (status: string, extra = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><RECEPCIONDTE><RUTSENDER>8315495-0</RUTSENDER><RUTCOMPANY>76123456-7</RUTCOMPANY><FILE>envio.xml</FILE><TIMESTAMP>2024-06-14 16:44:20</TIMESTAMP><STATUS>${status}</STATUS>${extra}</RECEPCIONDTE>`;

const ESTUP_EPR = soapRespuesta(
  'getEstUp',
  '<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><TRACKID>53292</TRACKID><ESTADO>EPR</ESTADO><GLOSA>Envio Procesado</GLOSA></SII:RESP_HDR><SII:RESP_BODY><TIPO_DOCTO>56</TIPO_DOCTO><INFORMADOS>1</INFORMADOS><ACEPTADOS>0</ACEPTADOS><RECHAZADOS>1</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY></SII:RESPUESTA>',
);

const ESTDTE_DNK = soapRespuesta(
  'getEstDte',
  '<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>DNK</ESTADO><GLOSA>DTE Recibido</GLOSA><ERR_CODE>1</ERR_CODE><GLOSA_ERR>Documento Recibido por el SII pero Datos NO Coinciden con los registrados</GLOSA_ERR></SII:RESP_HDR></SII:RESPUESTA>',
);

function crear(f: ReturnType<typeof crearFetchSimulado>, extra: Record<string, unknown> = {}) {
  const firmador = crearFirmadorFalso();
  const esperar = sinEspera();
  const cliente = new DteSiiClient({
    ambiente: 'certificacion',
    rutEmpresa: '76123456',
    dvEmpresa: '7',
    rutUsuario: '8315495',
    dvUsuario: '0',
    firmador,
    fetchImpl: f,
    reintentos: { esperar, esperaBaseMs: 10 },
    cacheToken: { almacen: almacenNuevo() },
    ...extra,
  });
  return { cliente, firmador, esperar };
}

describe('DteSiiClient', () => {
  describe('obtenerSemilla', () => {
    it('envía SOAP getSeed y des-escapa getSeedReturn', async () => {
      const f = crearFetchSimulado([resp(SEMILLA, 200, 'text/xml')]);
      expect(await crear(f).cliente.obtenerSemilla()).toBe('1234567890123');
      const [url, init] = f.mock.calls[0];
      expect(url).toBe('https://maullin.sii.cl/DTEWS/CrSeed.jws');
      expect(init?.method).toBe('POST');
      expect(cabecera(init, 'SOAPAction')).toBe('""');
      expect(cabecera(init, 'Content-Type')).toBe('text/xml; charset=utf-8');
      expect(init?.body).toBe(
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><getSeed/></soapenv:Body></soapenv:Envelope>',
      );
    });

    it('lanza SiiAutenticacionError si ESTADO != 00', async () => {
      const mala = soapRespuesta('getSeed', '<SII:RESPUESTA xmlns:SII="x"><SII:RESP_HDR><ESTADO>-1</ESTADO></SII:RESP_HDR></SII:RESPUESTA>');
      const f = crearFetchSimulado([resp(mala)]);
      await expect(crear(f).cliente.obtenerSemilla()).rejects.toBeInstanceOf(SiiAutenticacionError);
    });

    it('lanza SiiError ante SOAP Fault', async () => {
      const fault = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>x</faultcode><faultstring>boom</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>';
      const f = crearFetchSimulado([resp(fault)]);
      await expect(crear(f).cliente.obtenerSemilla()).rejects.toThrow(/boom/);
    });

    it('un 500 SOAP se reintenta y termina en SiiServidorError', async () => {
      const e = () => resp('<fault/>', 500, 'text/xml');
      const f = crearFetchSimulado([e(), e(), e()]);
      await expect(crear(f).cliente.obtenerSemilla()).rejects.toBeInstanceOf(SiiServidorError);
      expect(f).toHaveBeenCalledTimes(3);
    });
  });

  describe('obtenerToken', () => {
    it('firma getToken, escapa el XML en pszXml y parsea TOKEN', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token())]);
      const { cliente, firmador } = crear(f);
      expect(await cliente.obtenerToken()).toBe('ABCDEF123');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>1234567890123</Semilla></item></getToken>';
      expect(firmador.firmarXml).toHaveBeenCalledWith(xml);
      const [url, init] = f.mock.calls[1];
      expect(url).toBe('https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws');
      expect(String(init?.body as string)).toContain(`<getToken><pszXml>${escaparXml(`${xml}<!--firmado-->`)}</pszXml></getToken>`);
      expect(String(init?.body as string)).not.toContain('<Semilla>');
    });

    it('cachea el token (segunda llamada sin semilla)', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token())]);
      const { cliente } = crear(f);
      await cliente.obtenerToken();
      await cliente.obtenerToken();
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('ESTADO != 00 lanza SiiAutenticacionError', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token('', '10'))]);
      await expect(crear(f).cliente.obtenerToken()).rejects.toBeInstanceOf(SiiAutenticacionError);
    });
  });

  describe('enviarDte', () => {
    it('hace upload multipart y devuelve el trackId', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(recepcion('0', '<TRACKID>39</TRACKID>'))]);
      const r = await crear(f).cliente.enviarDte('<EnvioDTE/>', 'envio');
      expect(r).toEqual({ trackId: '39', status: '0', mensaje: 'Upload OK' });
      const [url, init] = f.mock.calls[2];
      expect(url).toBe('https://maullin.sii.cl/cgi_dte/UPL/DTEUpload');
      expect(init?.method).toBe('POST');
      expect(cabecera(init, 'User-Agent')).toBe(USER_AGENT_SII);
      expect(cabecera(init, 'Cookie')).toBe('TOKEN=ABCDEF123');
      const form = init?.body as FormData;
      expect(form.get('rutSender')).toBe('8315495');
      expect(form.get('dvSender')).toBe('0');
      expect(form.get('rutCompany')).toBe('76123456');
      expect(form.get('dvCompany')).toBe('7');
      const archivo = form.get('archivo') as File;
      expect(archivo.name).toBe('envio.xml');
      expect(await archivo.text()).toBe('<EnvioDTE/>');
    });

    it('usa palena en producción', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(recepcion('0', '<TRACKID>1</TRACKID>'))]);
      await crear(f, { ambiente: 'produccion' }).cliente.enviarDte('<a/>', 'a.xml');
      expect(f.mock.calls[2][0]).toBe('https://palena.sii.cl/cgi_dte/UPL/DTEUpload');
    });

    it.each([
      ['1', /permiso/],
      ['2', /tamaño/],
      ['3', /cortado/],
      ['6', /no autorizada/],
      ['7', /Esquema/],
      ['8', /Firma/],
      ['9', /bloqueado/],
      ['99', /interno/],
      ['42', /interno/],
    ])('STATUS %s lanza SiiEnvioDteError', async (status, glosa) => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(recepcion(status))]);
      const err = await crear(f).cliente.enviarDte('<a/>', 'a.xml').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SiiEnvioDteError);
      expect((err as SiiEnvioDteError).status).toBe(status);
      expect((err as SiiEnvioDteError).glosa).toMatch(glosa);
    });

    it('STATUS 7 incluye los ERROR del esquema', async () => {
      const cuerpo = recepcion('7', '<DETAIL><ERROR>LSX-00265: mal</ERROR><ERROR>LSX-00213: otro</ERROR></DETAIL>');
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(cuerpo)]);
      const err = (await crear(f).cliente.enviarDte('<a/>', 'a.xml').catch((e: unknown) => e)) as SiiEnvioDteError;
      expect(err.errores).toEqual(['LSX-00265: mal', 'LSX-00213: otro']);
    });

    it('STATUS 5 renueva el token una vez y reintenta', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA), resp(token('VIEJO')),
        resp(recepcion('5')),
        resp(SEMILLA), resp(token('NUEVO')),
        resp(recepcion('0', '<TRACKID>77</TRACKID>')),
      ]);
      const r = await crear(f).cliente.enviarDte('<a/>', 'a.xml');
      expect(r.trackId).toBe('77');
      expect(cabecera(f.mock.calls[5][1], 'Cookie')).toBe('TOKEN=NUEVO');
    });

    it('HTTP 401 también renueva el token', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA), resp(token('VIEJO')),
        resp('', 401, 'text/plain'),
        resp(SEMILLA), resp(token('NUEVO')),
        resp(recepcion('0', '<TRACKID>8</TRACKID>')),
      ]);
      expect((await crear(f).cliente.enviarDte('<a/>', 'a.xml')).trackId).toBe('8');
    });

    it('STATUS 0 sin TRACKID es error', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(recepcion('0'))]);
      await expect(crear(f).cliente.enviarDte('<a/>', 'a.xml')).rejects.toBeInstanceOf(SiiError);
    });
  });

  describe('consultarEstadoEnvio', () => {
    it('envía getEstUp con token y parsea la respuesta', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(ESTUP_EPR)]);
      const r = await crear(f).cliente.consultarEstadoEnvio(53292);
      expect(r.estado).toBe('EPR');
      expect(r.glosa).toBe('Envio Procesado');
      expect(r.xmlRespuesta).toContain('<SII:RESPUESTA');
      expect(r.cuerpo).toMatchObject({ TIPO_DOCTO: '56', RECHAZADOS: '1' });
      const [url, init] = f.mock.calls[2];
      expect(url).toBe('https://maullin.sii.cl/DTEWS/QueryEstUp.jws');
      expect(cabecera(init, 'SOAPAction')).toBe('""');
      expect(String(init?.body as string)).toContain(
        '<getEstUp><RutCompania>76123456</RutCompania><DvCompania>7</DvCompania><TrackId>53292</TrackId><Token>ABCDEF123</Token></getEstUp>',
      );
    });

    it('ESTADO 002 (token inactivo) renueva y reintenta', async () => {
      const inactivo = soapRespuesta('getEstUp', '<SII:RESPUESTA xmlns:SII="x"><SII:RESP_HDR><ESTADO>002</ESTADO><GLOSA>Token inactivo</GLOSA></SII:RESP_HDR></SII:RESPUESTA>');
      const f = crearFetchSimulado([
        resp(SEMILLA), resp(token('A')), resp(inactivo),
        resp(SEMILLA), resp(token('B')), resp(ESTUP_EPR),
      ]);
      const r = await crear(f).cliente.consultarEstadoEnvio('53292');
      expect(r.estado).toBe('EPR');
      expect(String(f.mock.calls[5][1]?.body as string)).toContain('<Token>B</Token>');
    });

    it('rechaza trackId no numérico', async () => {
      await expect(crear(crearFetchSimulado([])).cliente.consultarEstadoEnvio('x')).rejects.toThrow(/trackId/);
    });
  });

  describe('consultarEstadoDte', () => {
    const params = {
      rutEmisor: '76123456', dvEmisor: '7', rutReceptor: '66666666', dvReceptor: '6',
      tipoDte: 33, folio: 1234, fechaEmision: '14062024', monto: 119000,
    };

    it('envía getEstDte con todos los parámetros y parsea estado', async () => {
      const f = crearFetchSimulado([resp(SEMILLA), resp(token()), resp(ESTDTE_DNK)]);
      const r = await crear(f).cliente.consultarEstadoDte(params);
      expect(r.estado).toBe('DNK');
      expect(r.glosa).toBe('DTE Recibido');
      expect(r.cabecera).toMatchObject({ ERR_CODE: '1' });
      const [url, init] = f.mock.calls[2];
      expect(url).toBe('https://maullin.sii.cl/DTEWS/QueryEstDte.jws');
      expect(String(init?.body as string)).toContain(
        '<getEstDte><RutConsultante>8315495</RutConsultante><DvConsultante>0</DvConsultante>' +
          '<RutCompania>76123456</RutCompania><DvCompania>7</DvCompania>' +
          '<RutReceptor>66666666</RutReceptor><DvReceptor>6</DvReceptor>' +
          '<TipoDte>33</TipoDte><FolioDte>1234</FolioDte><FechaEmisionDte>14062024</FechaEmisionDte>' +
          '<MontoDte>119000</MontoDte><Token>ABCDEF123</Token></getEstDte>',
      );
    });

    it('valida el formato ddmmyyyy', async () => {
      await expect(
        crear(crearFetchSimulado([])).cliente.consultarEstadoDte({ ...params, fechaEmision: '2024-06-14' }),
      ).rejects.toThrow(/ddmmyyyy/);
    });
  });
});
