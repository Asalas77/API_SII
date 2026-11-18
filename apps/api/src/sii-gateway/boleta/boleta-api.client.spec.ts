import { USER_AGENT_SII } from '../ambientes.js';
import {
  SiiAutenticacionError,
  SiiLimiteExcedidoError,
  SiiNoEncontradoError,
  SiiPeticionInvalidaError,
  SiiServidorError,
} from '../comun/errores.js';
import {
  almacenNuevo,
  cabecera,
  crearFetchSimulado,
  crearFirmadorFalso,
  resp,
  respJson,
  sinEspera,
} from '../comun/testing.js';
import { BoletaApiClient } from './boleta-api.client.js';

const SEMILLA_XML =
  '<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>030530912644</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>';
const tokenXml = (t = 'P7VQKYLDNHJGP', estado = '00') =>
  `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>${t}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>${estado}</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;

const ENVIO_OK = {
  rut_emisor: '45000054-K',
  rut_envia: '8315495-0',
  trackid: 1014,
  fecha_recepcion: '2020-09-01 20:30:10',
  estado: 'REC',
  file: 'boleta-2020-09-01-001.xml',
};

const ESTADO_EPR = {
  rut_emisor: '45000054-K',
  rut_envia: '8315495-0',
  trackid: 1014,
  fecha_recepcion: '30/07/2020 07:57:42',
  estado: 'EPR',
  estadistica: [
    { tipo: 39, informados: 3, aceptados: 2, rechazados: 1, reparos: 0 },
    { tipo: 41, informados: 1, aceptados: 0, rechazados: 0, reparos: 1 },
  ],
  detalle_rep_rech: [
    {
      tipo: 39,
      folio: 1202,
      estado: 'RCH',
      descripcion: 'Dte Rechazado',
      error: [
        { seccion: 'CRT', linea: 155, nivel: 3, codigo: 11, descripcion: 'RUT envia diferente al Upload', detalle: 'x' },
      ],
    },
  ],
};

function crear(fetchImpl: ReturnType<typeof crearFetchSimulado>, extra: Record<string, unknown> = {}) {
  const firmador = crearFirmadorFalso();
  const esperar = sinEspera();
  const cliente = new BoletaApiClient({
    ambiente: 'certificacion',
    rutEmpresa: '45000054',
    dvEmpresa: 'k',
    rutUsuario: '8315495',
    dvUsuario: '0',
    firmador,
    fetchImpl,
    reintentos: { esperar, esperaBaseMs: 100 },
    cacheToken: { almacen: almacenNuevo() },
    ...extra,
  });
  return { cliente, firmador, esperar };
}

describe('BoletaApiClient', () => {
  describe('obtenerSemilla', () => {
    it('hace GET a la semilla y extrae SEMILLA', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML)]);
      const { cliente } = crear(f);
      expect(await cliente.obtenerSemilla()).toBe('030530912644');
      expect(f.mock.calls[0][0]).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla');
      expect(f.mock.calls[0][1]?.method).toBe('GET');
    });

    it('lanza SiiAutenticacionError si ESTADO != 00', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML.replace('<ESTADO>00', '<ESTADO>99'))]);
      await expect(crear(f).cliente.obtenerSemilla()).rejects.toBeInstanceOf(SiiAutenticacionError);
    });
  });

  describe('obtenerToken', () => {
    it('firma exactamente dos líneas y hace POST XML', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml())]);
      const { cliente, firmador } = crear(f);
      expect(await cliente.obtenerToken()).toBe('P7VQKYLDNHJGP');
      expect(firmador.firmarXml).toHaveBeenCalledWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>030530912644</Semilla></item></getToken>',
      );
      const [url, init] = f.mock.calls[1];
      expect(url).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica.token');
      expect(init?.method).toBe('POST');
      expect(cabecera(init, 'Content-Type')).toBe('application/xml');
      expect(cabecera(init, 'Accept')).toBe('application/xml');
      expect(String(init?.body as string)).toMatch(/<!--firmado-->$/);
    });

    it('cachea el token: la segunda llamada no pide semilla', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml())]);
      const { cliente } = crear(f);
      await cliente.obtenerToken();
      expect(await cliente.obtenerToken()).toBe('P7VQKYLDNHJGP');
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('expira el token según TTL', async () => {
      let ahora = 1_000;
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml('A')), resp(SEMILLA_XML), resp(tokenXml('B'))]);
      const { cliente } = crear(f, { cacheToken: { almacen: almacenNuevo(), ttlMs: 500, ahora: () => ahora } });
      expect(await cliente.obtenerToken()).toBe('A');
      ahora += 499;
      expect(await cliente.obtenerToken()).toBe('A');
      ahora += 2;
      expect(await cliente.obtenerToken()).toBe('B');
    });

    it('con cacheToken=false pide token cada vez', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), resp(SEMILLA_XML), resp(tokenXml())]);
      const { cliente } = crear(f, { cacheToken: false });
      await cliente.obtenerToken();
      await cliente.obtenerToken();
      expect(f).toHaveBeenCalledTimes(4);
    });

    it('lanza SiiAutenticacionError si ESTADO != 00', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml('', '10'))]);
      await expect(crear(f).cliente.obtenerToken()).rejects.toBeInstanceOf(SiiAutenticacionError);
    });
  });

  describe('enviarBoletas', () => {
    it('envía multipart con campos, headers y parsea la respuesta', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson(ENVIO_OK)]);
      const { cliente } = crear(f);
      const r = await cliente.enviarBoletas('<EnvioBOLETA/>', 'boleta-001');
      expect(r.trackId).toBe('1014');
      expect(r.estado).toBe('REC');
      expect(r.file).toBe('boleta-2020-09-01-001.xml');

      const [url, init] = f.mock.calls[2];
      expect(url).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica.envio');
      expect(init?.method).toBe('POST');
      expect(cabecera(init, 'User-Agent')).toBe(USER_AGENT_SII);
      expect(cabecera(init, 'Cookie')).toBe('TOKEN=P7VQKYLDNHJGP');
      expect(cabecera(init, 'Accept')).toBe('application/json');
      const form = init?.body as FormData;
      expect(form.get('rutSender')).toBe('8315495');
      expect(form.get('dvSender')).toBe('0');
      expect(form.get('rutCompany')).toBe('45000054');
      expect(form.get('dvCompany')).toBe('K');
      const archivo = form.get('archivo') as File;
      expect(archivo.name).toBe('boleta-001.xml');
      expect(archivo.type).toBe('application/xml');
      expect(await archivo.text()).toBe('<EnvioBOLETA/>');
    });

    it('codifica en ISO-8859-1 si el prólogo lo declara', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson(ENVIO_OK)]);
      const { cliente } = crear(f);
      await cliente.enviarBoletas('<?xml version="1.0" encoding="ISO-8859-1"?><a>ñ</a>', 'x.xml');
      const form = f.mock.calls[2][1]?.body as FormData;
      const archivo = form.get('archivo') as File;
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      expect(bytes[bytes.length - 5]).toBe(0xf1); // ñ en latin1
    });

    it('usa el host alternativo cuando se configura', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson(ENVIO_OK)]);
      const { cliente } = crear(f, { usarHostEnvioAlternativo: true });
      await cliente.enviarBoletas(Buffer.from('<a/>'), 'a.xml');
      expect(f.mock.calls[0][0]).toContain('apicert.sii.cl');
      expect(f.mock.calls[2][0]).toBe('https://pangal.sii.cl/recursos/v1/boleta.electronica.envio');
    });

    it('renueva el token una vez ante 401 y repite', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA_XML), resp(tokenXml('VIEJO')),
        resp('no autorizado', 401, 'text/plain'),
        resp(SEMILLA_XML), resp(tokenXml('NUEVO')),
        respJson(ENVIO_OK),
      ]);
      const { cliente } = crear(f);
      const r = await cliente.enviarBoletas('<a/>', 'a.xml');
      expect(r.trackId).toBe('1014');
      expect(cabecera(f.mock.calls[2][1], 'Cookie')).toBe('TOKEN=VIEJO');
      expect(cabecera(f.mock.calls[5][1], 'Cookie')).toBe('TOKEN=NUEVO');
    });

    it('falla si el 401 persiste tras renovar (solo una renovación)', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA_XML), resp(tokenXml('A')),
        resp('x', 401, 'text/plain'),
        resp(SEMILLA_XML), resp(tokenXml('B')),
        resp('x', 401, 'text/plain'),
      ]);
      await expect(crear(f).cliente.enviarBoletas('<a/>', 'a.xml')).rejects.toBeInstanceOf(SiiAutenticacionError);
      expect(f).toHaveBeenCalledTimes(6);
    });

    it('reintenta ante 405 con backoff exponencial', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA_XML), resp(tokenXml()),
        resp('Limite Excedido', 405, 'text/plain'),
        resp('Limite Excedido', 405, 'text/plain'),
        respJson(ENVIO_OK),
      ]);
      const { cliente, esperar } = crear(f);
      const r = await cliente.enviarBoletas('<a/>', 'a.xml');
      expect(r.trackId).toBe('1014');
      expect(esperar.mock.calls.map((c) => c[0])).toEqual([100, 200]);
    });

    it('lanza SiiLimiteExcedidoError al agotar intentos en 405', async () => {
      const l = () => resp('Limite', 405, 'text/plain');
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), l(), l(), l()]);
      await expect(crear(f).cliente.enviarBoletas('<a/>', 'a.xml')).rejects.toBeInstanceOf(SiiLimiteExcedidoError);
      expect(f).toHaveBeenCalledTimes(5);
    });

    it('reintenta ante 5xx y errores de red', async () => {
      const f = crearFetchSimulado([
        resp(SEMILLA_XML), resp(tokenXml()),
        resp('boom', 500, 'text/plain'),
        new TypeError('fetch failed'),
        respJson(ENVIO_OK),
      ]);
      const r = await crear(f).cliente.enviarBoletas('<a/>', 'a.xml');
      expect(r.estado).toBe('REC');
    });

    it('lanza SiiServidorError tras agotar reintentos en 5xx', async () => {
      const e = () => resp('boom', 503, 'text/plain');
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), e(), e(), e()]);
      await expect(crear(f).cliente.enviarBoletas('<a/>', 'a.xml')).rejects.toBeInstanceOf(SiiServidorError);
    });

    it('no reintenta 400', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), resp('rutSender invalido', 400, 'text/plain')]);
      const { cliente, esperar } = crear(f);
      const err = await cliente.enviarBoletas('<a/>', 'a.xml').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SiiPeticionInvalidaError);
      expect((err as SiiPeticionInvalidaError).statusHttp).toBe(400);
      expect((err as SiiPeticionInvalidaError).cuerpo).toBe('rutSender invalido');
      expect(esperar).not.toHaveBeenCalled();
      expect(f).toHaveBeenCalledTimes(3);
    });
  });

  describe('consultarEstadoEnvio', () => {
    it('hace GET con Cookie y enriquece el resultado', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson(ESTADO_EPR)]);
      const r = await crear(f).cliente.consultarEstadoEnvio(1014);
      const [url, init] = f.mock.calls[2];
      expect(url).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/45000054-K-1014');
      expect(init?.method).toBe('GET');
      expect(cabecera(init, 'Cookie')).toBe('TOKEN=P7VQKYLDNHJGP');
      expect(r.estado).toBe('EPR');
      expect(r.descripcionEstado).toBe('Envío procesado');
      expect(r.esFinal).toBe(true);
      expect(r.trackId).toBe('1014');
      expect(r.estadistica).toHaveLength(2);
      expect(r.detalle_rep_rech?.[0].error?.[0].seccion).toBe('CRT');
    });

    it.each([
      ['REC', false], ['PRD', false], ['CRT', false], ['FOK', false], ['SOK', false],
      ['EPR', true], ['RCH', true], ['RCO', true], ['RFR', true], ['RPR', true],
      ['RPT', true], ['RSC', true], ['RCT', true], ['VOF', true],
    ])('estado %s -> esFinal=%s', async (estado, esFinal) => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson({ ...ESTADO_EPR, estado })]);
      const r = await crear(f).cliente.consultarEstadoEnvio('1014');
      expect(r.esFinal).toBe(esFinal);
      expect(r.descripcionEstado).not.toMatch(/desconocido/);
    });

    it('estado desconocido no es final', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson({ ...ESTADO_EPR, estado: 'ZZZ' })]);
      const r = await crear(f).cliente.consultarEstadoEnvio(1);
      expect(r.esFinal).toBe(false);
      expect(r.descripcionEstado).toMatch(/desconocido/);
    });

    it('mapea 404 a SiiNoEncontradoError', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), resp('no existe', 404, 'text/plain')]);
      await expect(crear(f).cliente.consultarEstadoEnvio(5)).rejects.toBeInstanceOf(SiiNoEncontradoError);
    });

    it('rechaza trackId inválido', async () => {
      const f = crearFetchSimulado([]);
      await expect(crear(f).cliente.consultarEstadoEnvio('12a')).rejects.toThrow(/trackId/);
    });
  });

  describe('consultarEstadoBoleta', () => {
    it('arma URL con query y parsea la respuesta', async () => {
      const dok = { codigo: 'DOK', descripcion: 'Documento Recibido por el SII. Datos Coinciden con los Registrados' };
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson(dok)]);
      const r = await crear(f).cliente.consultarEstadoBoleta({
        tipo: 39, folio: 77, rutReceptor: '66666666', dvReceptor: 'k', monto: 1190, fechaEmision: '01-09-2020',
      });
      const url = new URL(f.mock.calls[2][0]);
      expect(url.origin + url.pathname).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica/45000054-K-39-77/estado');
      expect(url.searchParams.get('rut_receptor')).toBe('66666666');
      expect(url.searchParams.get('dv_receptor')).toBe('K');
      expect(url.searchParams.get('monto')).toBe('1190');
      expect(url.searchParams.get('fechaEmision')).toBe('01-09-2020');
      expect(cabecera(f.mock.calls[2][1], 'Cookie')).toBe('TOKEN=P7VQKYLDNHJGP');
      expect(r).toEqual(dok);
    });

    it('sin parámetros opcionales no agrega query', async () => {
      const f = crearFetchSimulado([resp(SEMILLA_XML), resp(tokenXml()), respJson({ codigo: 'FAU', descripcion: 'x' })]);
      await crear(f).cliente.consultarEstadoBoleta({ tipo: 41, folio: 1 });
      expect(f.mock.calls[2][0]).toBe('https://apicert.sii.cl/recursos/v1/boleta.electronica/45000054-K-41-1/estado');
    });

    it('valida el formato de fecha', async () => {
      const f = crearFetchSimulado([]);
      await expect(
        crear(f).cliente.consultarEstadoBoleta({ tipo: 39, folio: 1, fechaEmision: '2020-09-01' }),
      ).rejects.toThrow(/DD-MM-YYYY/);
    });
  });

  it('usa producción cuando se configura', async () => {
    const f = crearFetchSimulado([resp(SEMILLA_XML)]);
    const { cliente } = crear(f, { ambiente: 'produccion' });
    await cliente.obtenerSemilla();
    expect(f.mock.calls[0][0]).toBe('https://api.sii.cl/recursos/v1/boleta.electronica.semilla');
  });
});
