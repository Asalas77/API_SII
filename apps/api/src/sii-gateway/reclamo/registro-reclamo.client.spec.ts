import { URLS_RECLAMO } from '../ambientes.js';
import { SiiAutenticacionError, SiiPeticionInvalidaError } from '../comun/errores.js';
import { cabecera, crearFetchSimulado, resp, sinEspera } from '../comun/testing.js';
import { parsearFechaRecepcionSii, RegistroReclamoClient } from './registro-reclamo.client.js';

const NS = 'http://ws.registroreclamodte.diii.sdi.sii.cl';
const rpc = (operacion: string, interior: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>' +
  `<ns2:${operacion}Response xmlns:ns2="${NS}">${interior}</ns2:${operacion}Response></S:Body></S:Envelope>`;
const ret = (cod: number, desc: string, extra = '') =>
  `<return><codResp>${cod}</codResp><descResp>${desc}</descResp>${extra}</return>`;
const xml = (c: string) => resp(c, 200, 'text/xml');

const doc = { rutEmisor: '76086428', dvEmisor: 'k', tipoDoc: 33, folio: 1234 };

function crear(respuestas: Parameters<typeof crearFetchSimulado>[0], extra: Record<string, unknown> = {}) {
  const f = crearFetchSimulado(respuestas);
  const tokens = { obtenerToken: vi.fn(async () => 'TOK1'), invalidarToken: vi.fn() };
  const cliente = new RegistroReclamoClient({
    ambiente: 'certificacion',
    tokens,
    fetchImpl: f,
    reintentos: { esperar: sinEspera(), esperaBaseMs: 1 },
    ...extra,
  });
  return { f, tokens, cliente };
}

describe('RegistroReclamoClient', () => {
  it('usa la URL de certificación (ws2, ruta CERT) y la de producción (ws1)', async () => {
    expect(URLS_RECLAMO.certificacion).toBe('https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice');
    expect(URLS_RECLAMO.produccion).toBe('https://ws1.sii.cl/WSREGISTRORECLAMODTE/registroreclamodteservice');
    const { f, cliente } = crear([xml(rpc('getVersion', '<return>1.1</return>'))]);
    expect(await cliente.obtenerVersion()).toBe('1.1');
    expect(f.mock.calls[0][0]).toBe(URLS_RECLAMO.certificacion);
    const prod = crear([xml(rpc('getVersion', '<return>1.1</return>'))], { ambiente: 'produccion' });
    await prod.cliente.obtenerVersion();
    expect(prod.f.mock.calls[0][0]).toBe(URLS_RECLAMO.produccion);
  });

  it('ingresarAceptacionReclamo: arma el SOAP rpc/literal con cookie TOKEN y reporta éxito', async () => {
    const { f, cliente, tokens } = crear([xml(rpc('ingresarAceptacionReclamoDoc', ret(0, 'Acción completada OK')))]);
    const r = await cliente.ingresarAceptacionReclamo(doc, 'ACD');
    expect(r).toMatchObject({ codigo: 0, descripcion: 'Acción completada OK', exito: true });
    const [, init] = f.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(cabecera(init, 'Cookie')).toBe('TOKEN=TOK1');
    expect(cabecera(init, 'SOAPAction')).toBe('""');
    const body = init?.body as string;
    expect(body).toContain(`xmlns:ws="${NS}"`);
    expect(body).toContain(
      '<ws:ingresarAceptacionReclamoDoc><rutEmisor>76086428</rutEmisor><dvEmisor>K</dvEmisor><tipoDoc>33</tipoDoc><folio>1234</folio><accionDoc>ACD</accionDoc></ws:ingresarAceptacionReclamoDoc>',
    );
    expect(tokens.obtenerToken).toHaveBeenCalledTimes(1);
  });

  it('un código de negocio distinto de 0 no lanza: exito=false con la descripción del SII', async () => {
    const { cliente } = crear([
      xml(rpc('ingresarAceptacionReclamoDoc', ret(8, 'Pasados 8 días después de la recepción no es posible registrar reclamos o eventos'))),
      xml(rpc('ingresarAceptacionReclamoDoc', ret(1, 'Acción Completada OK'))),
    ]);
    expect(await cliente.ingresarAceptacionReclamo(doc, 'RCD')).toMatchObject({ codigo: 8, exito: false });
    expect((await cliente.ingresarAceptacionReclamo(doc, 'RCD')).exito).toBe(true);
  });

  it('rechaza tipos y acciones que el servicio no admite, sin llamar a la red', async () => {
    const { f, cliente } = crear([]);
    await expect(cliente.ingresarAceptacionReclamo({ ...doc, tipoDoc: 39 }, 'ACD')).rejects.toThrow(SiiPeticionInvalidaError);
    await expect(cliente.ingresarAceptacionReclamo(doc, 'XXX' as never)).rejects.toThrow(/Acción inválida/);
    await expect(cliente.listarEventos({ ...doc, folio: 0 })).rejects.toThrow(/folio/);
    expect(f).not.toHaveBeenCalled();
  });

  it('listarEventos: devuelve uno o varios eventos con su fecha interpretada', async () => {
    const evento = (c: string, f: string) =>
      `<listaEventosDoc><codEvento>${c}</codEvento><descEvento>Evento ${c}</descEvento><rutResponsable>12345678</rutResponsable><dvResponsable>5</dvResponsable><fechaEvento>${f}</fechaEvento></listaEventosDoc>`;
    const { cliente } = crear([
      xml(rpc('listarEventosHistDoc', ret(15, 'Listado de eventos del documento', evento('ACD', '10-11-2026 09:30:15') + evento('ERM', '11-11-2026 10:00:00')))),
      xml(rpc('listarEventosHistDoc', ret(15, 'Listado', evento('ACD', '10-11-2026 09:30:15')))),
      xml(rpc('listarEventosHistDoc', ret(16, 'Documento no presenta eventos de reclamos o acuse de recibo'))),
    ]);
    const r = await cliente.listarEventos(doc);
    expect(r.codigo).toBe(15);
    expect(r.eventos.map((e) => e.codigo)).toEqual(['ACD', 'ERM']);
    expect(r.eventos[0]).toMatchObject({ rutResponsable: '12345678', dvResponsable: '5', fechaTexto: '10-11-2026 09:30:15' });
    expect(r.eventos[0].fecha?.toISOString()).toBe('2026-11-10T12:30:15.000Z'); // Chile en noviembre: UTC-3
    expect((await cliente.listarEventos(doc)).eventos).toHaveLength(1);
    expect(await cliente.listarEventos(doc)).toMatchObject({ codigo: 16, eventos: [] });
  });

  it('consultarDocDteCedible: 23 y 25 son cedibles; 24 no', async () => {
    const { cliente } = crear([
      xml(rpc('consultarDocDteCedible', ret(23, 'DTE Cedible, sin reclamos'))),
      xml(rpc('consultarDocDteCedible', ret(24, 'DTE No Cedible, DTE reclamado por el receptor'))),
      xml(rpc('consultarDocDteCedible', ret(25, 'DTE Cedible, habiendo pasado 8 días se entiende dado acuse de recibo'))),
    ]);
    expect((await cliente.consultarDocDteCedible(doc)).cedible).toBe(true);
    expect((await cliente.consultarDocDteCedible(doc)).cedible).toBe(false);
    expect((await cliente.consultarDocDteCedible(doc)).cedible).toBe(true);
  });

  it('consultarFechaRecepcion: interpreta la fecha en hora de Chile (verano e invierno)', async () => {
    const { cliente } = crear([
      xml(rpc('consultarFechaRecepcionSii', '<return>15-01-2026 08:05:00</return>')),
      xml(rpc('consultarFechaRecepcionSii', '<return>15-07-2026 08:05:00</return>')),
      xml(rpc('consultarFechaRecepcionSii', '<return></return>')),
    ]);
    expect((await cliente.consultarFechaRecepcion(doc)).fecha?.toISOString()).toBe('2026-01-15T11:05:00.000Z'); // UTC-3
    expect((await cliente.consultarFechaRecepcion(doc)).fecha?.toISOString()).toBe('2026-07-15T12:05:00.000Z'); // UTC-4
    expect(await cliente.consultarFechaRecepcion(doc)).toEqual({ texto: '', fecha: undefined });
  });

  it('con HTTP 401 renueva el token una vez y repite', async () => {
    const { cliente, tokens } = crear([resp('no autenticado', 401, 'text/plain'), xml(rpc('listarEventosHistDoc', ret(16, 'sin eventos')))]);
    tokens.obtenerToken.mockResolvedValueOnce('VIEJO').mockResolvedValueOnce('NUEVO');
    expect((await cliente.listarEventos(doc)).codigo).toBe(16);
    expect(tokens.invalidarToken).toHaveBeenCalledTimes(1);
    expect(tokens.obtenerToken).toHaveBeenCalledTimes(2);
  });

  it('un 401 persistente se propaga como SiiAutenticacionError', async () => {
    const { cliente } = crear([resp('no', 401, 'text/plain'), resp('no', 401, 'text/plain')]);
    await expect(cliente.listarEventos(doc)).rejects.toThrow(SiiAutenticacionError);
  });

  it('SOAP Fault, respuesta sin codResp y 5xx con reintento', async () => {
    const fault =
      '<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Boom</faultstring></S:Fault></S:Body></S:Envelope>';
    const { cliente, f } = crear([
      xml(fault),
      xml(rpc('listarEventosHistDoc', '<return><descResp>x</descResp></return>')),
      resp('x', 503, 'text/plain'),
      xml(rpc('listarEventosHistDoc', ret(16, 'ok'))),
    ]);
    await expect(cliente.listarEventos(doc)).rejects.toThrow(/SOAP Fault/);
    await expect(cliente.listarEventos(doc)).rejects.toThrow(/sin codResp/);
    expect((await cliente.listarEventos(doc)).codigo).toBe(16);
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('parsearFechaRecepcionSii', () => {
  it('acepta dd-mm-yyyy, dd/mm/yyyy e ISO, con o sin hora', () => {
    expect(parsearFechaRecepcionSii('01-02-2026 10:20:30')?.toISOString()).toBe('2026-02-01T13:20:30.000Z');
    expect(parsearFechaRecepcionSii('01/02/2026')?.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(parsearFechaRecepcionSii('2026-02-01T10:20:30')?.toISOString()).toBe('2026-02-01T13:20:30.000Z');
    expect(parsearFechaRecepcionSii('2026-02-01T10:20:30Z')?.toISOString()).toBe('2026-02-01T10:20:30.000Z');
  });

  it('devuelve undefined si no se entiende', () => {
    expect(parsearFechaRecepcionSii('')).toBeUndefined();
    expect(parsearFechaRecepcionSii(undefined)).toBeUndefined();
    expect(parsearFechaRecepcionSii('ayer')).toBeUndefined();
    expect(parsearFechaRecepcionSii('01-13-2026 10:00:00')).toBeUndefined();
  });
});
