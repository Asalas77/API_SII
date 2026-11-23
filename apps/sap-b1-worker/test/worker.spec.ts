import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearLogger } from '../src/log.js';
import { instalarUdfs, UDFS } from '../src/udfs.js';
import { Entorno } from './entorno.js';
import { boleta, facturaAfecta, guia, guiaConTraslado, notaCredito, linea } from './fixtures.js';

type Fila = Record<string, unknown>;
const doc = (e: Entorno, ent: string, n: number): Fila => e.sl.doc(ent, n);

let e: Entorno;
beforeEach(async () => {
  e = await new Entorno().iniciar();
});
afterEach(async () => {
  await e.detener();
});

describe('ciclo del worker', () => {
  it('pendiente -> EMITIDO -> ENVIADO -> ACEPTADO, con PDF adjunto y clave de idempotencia', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    const r = await e.worker.ciclo();
    expect(r).toMatchObject({ emitidos: 1, enviados: 1, seguidos: 1, errores: 0 });

    const d = doc(e, 'Invoices', 100);
    expect(d['U_SII_Estado']).toBe('ACEPTADO');
    expect(d['U_SII_Folio']).toBe(1);
    expect(d['U_SII_TipoDTE']).toBe('33');
    expect(d['U_SII_TrackId']).toBe('1001');
    expect(d['U_SII_IdemKey']).toBe('b1:76086428-5:13:100');
    const apiDoc = [...e.api.documentos.values()][0];
    expect(d['U_SII_DocId']).toBe(apiDoc?.id);
    expect(d['U_SII_XmlUrl']).toBe(`${e.api.url}/v1/documentos/${apiDoc?.id}/xml`);
    expect(d['U_SII_PdfUrl']).toBe(`${e.api.url}/v1/documentos/${apiDoc?.id}/pdf`);
    expect(String(d['U_SII_Glosa'])).toMatch(/DOK/);
    expect(d['AttachmentEntry']).toBe(1);
    expect(e.sl.adjuntos[0]?.nombre).toBe('DTE_33_1.pdf');
    expect(e.api.emisiones).toHaveLength(1);
    expect(e.api.emisiones[0]?.clave).toBe('b1:76086428-5:13:100');
    expect(e.api.emisiones[0]?.rut).toBe('76086428-5');
    expect(e.api.envios).toHaveLength(1);
  });

  it('con ENVIAR_AUTOMATICAMENTE=false queda EMITIDO y no llama a /envios', async () => {
    await e.detener();
    e = await new Entorno().iniciar({ ENVIAR_AUTOMATICAMENTE: 'false' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('EMITIDO');
    expect(e.api.envios).toHaveLength(0);
  });

  it('seguimiento: ENVIADO mientras el SII no resuelve, luego ACEPTADO', async () => {
    e.api.resultadoEstado = () => ({ estado: 'enviado', estadoSii: 'FAU', glosaSii: 'Documento no recibido' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ENVIADO');
    e.api.resultadoEstado = () => ({ estado: 'aceptado', estadoSii: 'DOK', glosaSii: 'ok' });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
    expect(e.api.emisiones).toHaveLength(1);
  });

  it('rechazo y reparos del SII se escriben en la glosa', async () => {
    e.api.resultadoEstado = (d) =>
      d.tipoDte === 33
        ? { estado: 'rechazado', estadoSii: 'FNA', glosaSii: 'Rechazado por errores en datos' }
        : { estado: 'aceptado_con_reparos', estadoSii: 'DOK', glosaSii: 'Aceptado', reparos: [{ codigo: 'R1', detalle: 'Giro receptor largo' }] };
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    e.sl.agregarDoc('DeliveryNotes', { ...guiaConTraslado() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('RECHAZADO');
    expect(String(doc(e, 'Invoices', 100)['U_SII_Glosa'])).toMatch(/FNA: Rechazado/);
    expect(doc(e, 'DeliveryNotes', 300)['U_SII_Estado']).toBe('REPAROS');
    expect(String(doc(e, 'DeliveryNotes', 300)['U_SII_Glosa'])).toMatch(/Giro receptor largo/);
  });

  it('guía sin datos de traslado: ERROR en la validación local, sin llamar a la API', async () => {
    e.sl.agregarDoc('DeliveryNotes', { ...guia() });
    await e.worker.ciclo();
    expect(doc(e, 'DeliveryNotes', 300)['U_SII_Estado']).toBe('ERROR');
    expect(String(doc(e, 'DeliveryNotes', 300)['U_SII_Glosa'])).toMatch(/U_SII_CatTraslado/);
    expect(e.api.emisiones).toHaveLength(0);
  });

  it('422 de la API -> ERROR con glosa y sin reintento', async () => {
    e.api.colaEmision = [
      { status: 422, cuerpo: { code: 'DOCUMENTO_INVALIDO', title: 'x', detail: 'Documento inválido', errors: [{ campo: 'detalle[0]', mensaje: 'precio inválido' }] } },
    ];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    const r = await e.worker.ciclo();
    expect(r?.errores).toBe(1);
    const d = doc(e, 'Invoices', 100);
    expect(d['U_SII_Estado']).toBe('ERROR');
    expect(String(d['U_SII_Glosa'])).toContain('DOCUMENTO_INVALIDO');
    expect(String(d['U_SII_Glosa'])).toContain('detalle[0]: precio inválido');
    await e.worker.ciclo({ conciliar: true });
    expect(e.api.emisiones).toHaveLength(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ERROR');
  });

  it('409 SIN_FOLIOS_DISPONIBLES -> ERROR sin reintento', async () => {
    e.api.colaEmision = [{ status: 409, cuerpo: { code: 'SIN_FOLIOS_DISPONIBLES', title: 'x', detail: 'No quedan folios tipo 33' } }];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ERROR');
    expect(String(doc(e, 'Invoices', 100)['U_SII_Glosa'])).toContain('SIN_FOLIOS_DISPONIBLES');
  });

  it('error de validación del mapeo -> ERROR sin llamar a la API', async () => {
    e.sl.socios.set('C20000', { CardCode: 'C20000', CardName: 'X', LicTradNum: '11.111.111-2' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ERROR');
    expect(String(doc(e, 'Invoices', 100)['U_SII_Glosa'])).toMatch(/RUT del receptor inválido/);
    expect(e.api.emisiones).toHaveLength(0);
  });

  it('500 antes de emitir: queda ENVIANDO y el siguiente ciclo reintenta con la MISMA clave', async () => {
    e.api.colaEmision = [{ status: 500, cuerpo: { code: 'ERROR_INTERNO', title: 'x', detail: 'boom' } }];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    const r1 = await e.worker.ciclo();
    expect(r1?.reintentos).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ENVIANDO');
    expect(doc(e, 'Invoices', 100)['U_SII_IdemKey']).toBe('b1:76086428-5:13:100');

    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
    expect(e.api.emisiones.map((x) => x.clave)).toEqual(['b1:76086428-5:13:100', 'b1:76086428-5:13:100']);
    expect(e.api.documentos.size).toBe(1);
  });

  it('respuesta perdida tras emitir (500 con el documento ya creado): la repetición no duplica el folio', async () => {
    e.api.colaEmision = [{ status: 500, despuesDeCrear: true }];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ENVIANDO');
    expect(e.api.documentos.size).toBe(1);

    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(2);
    expect(e.api.documentos.size).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Folio']).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('error de red hacia la API también deja ENVIANDO; backoff exponencial respetado', async () => {
    await e.detener();
    e = await new Entorno().iniciar({ BACKOFF_BASE_MS: '60000', BACKOFF_MAX_MS: '600000' });
    e.api.colaEmision = [{ status: 503 }, { status: 503 }];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(1);
    // Aún dentro del backoff: no se reintenta.
    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(1);
    e.reloj += 61_000;
    await e.worker.ciclo(); // segundo fallo: espera 120 s
    expect(e.api.emisiones).toHaveLength(2);
    e.reloj += 61_000;
    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(2);
    e.reloj += 60_000;
    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(3);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
    expect(new Set(e.api.emisiones.map((x) => x.clave)).size).toBe(1);
  });

  it('conciliación: un ENVIANDO huérfano (sin backoff en memoria) solo se retoma con conciliar', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta(), U_SII_Estado: 'ENVIANDO', U_SII_IdemKey: 'b1:76086428-5:13:100' });
    await e.worker.ciclo();
    expect(e.api.emisiones).toHaveLength(0);
    await e.worker.ciclo({ conciliar: true });
    expect(e.api.emisiones).toHaveLength(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('conciliación tras caída a mitad: el documento ya emitido en la API se recupera sin otro folio', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    e.api.colaEmision = [{ status: 500, despuesDeCrear: true }];
    await e.worker.ciclo();
    // Nuevo proceso del worker: sin memoria de reintentos.
    const w2 = (await import('../src/worker.js')).Worker;
    const nuevo = new w2(e.config, e.cliente, new (await import('../src/api-sii.js')).ClienteApiSii(e.config.api), crearLogger({ salida: () => undefined }));
    await nuevo.ciclo({ conciliar: true });
    expect(e.api.documentos.size).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Folio']).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('reautentica una vez ante 401 por sesión expirada', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(e.sl.logins).toBe(1);
    e.sl.expirarSesiones();
    e.sl.agregarDoc('Invoices', { ...facturaAfecta(), DocEntry: 101 });
    const r = await e.worker.ciclo();
    expect(e.sl.logins).toBe(2);
    expect(r?.emitidos).toBe(1);
    expect(doc(e, 'Invoices', 101)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('nota de crédito con documento base: referencia el folio del base', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta(), U_SII_Estado: 'ACEPTADO', U_SII_Folio: 4521, U_SII_TipoDTE: '33' });
    e.sl.agregarDoc('CreditNotes', { ...notaCredito() });
    await e.worker.ciclo();
    expect(doc(e, 'CreditNotes', 200)['U_SII_Estado']).toBe('ACEPTADO');
    const cuerpo = e.api.emisiones[0]?.cuerpo;
    expect(cuerpo.idDoc.tipoDte).toBe(61);
    expect(cuerpo.referencias).toEqual([
      { tipoDocRef: '33', folioRef: 4521, fechaRef: '2026-03-16', codRef: 1, razonRef: 'Anula factura por error de precio' },
    ]);
  });

  it('nota de crédito cuyo base aún no tiene folio -> ERROR con glosa clara', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta(), U_SII_Estado: 'PENDIENTE', DocEntry: 100 });
    e.sl.agregarDoc('CreditNotes', { ...notaCredito(), DocEntry: 201 });
    // El base queda sin folio (ERROR): la nota no puede referenciarlo.
    e.sl.doc('Invoices', 100)['U_SII_Estado'] = 'ERROR';
    await e.worker.ciclo();
    expect(doc(e, 'CreditNotes', 201)['U_SII_Estado']).toBe('ERROR');
    expect(String(doc(e, 'CreditNotes', 201)['U_SII_Glosa'])).toMatch(/no tiene folio/);
  });

  it('boletas y DTE viajan en envíos distintos', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    e.sl.agregarDoc('Invoices', { ...boleta() });
    await e.worker.ciclo();
    expect(e.api.envios).toHaveLength(2);
    const tipos = e.api.envios.map((x) => x.documentoIds.map((id) => e.api.documentos.get(id)?.tipoDte));
    expect(tipos.sort()).toEqual([[33], [39]]);
    expect(doc(e, 'Invoices', 104)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('si el documento ya salió en otro envío (409), se sincroniza el estado desde la API', async () => {
    await e.detener();
    e = await new Entorno().iniciar({ ENVIAR_AUTOMATICAMENTE: 'false' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    const apiDoc = [...e.api.documentos.values()][0];
    if (apiDoc) {
      apiDoc.estado = 'enviado';
      apiDoc.trackId = '777';
    }
    e.worker['cfg'].enviarAutomaticamente = true;
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_TrackId']).toBe('777');
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('funciona con Service Layer v1', async () => {
    await e.detener();
    e = new Entorno();
    e.sl.versionApi = 'v1';
    await e.iniciar({ SL_VERSION: 'v1' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });

  it('no solapa ciclos', async () => {
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    const [a, b] = await Promise.all([e.worker.ciclo(), e.worker.ciclo()]);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
    expect(e.api.emisiones).toHaveLength(1);
  });

  it('procesa más pendientes que la página OData (paginación) con concurrencia limitada', async () => {
    for (let i = 0; i < 5; i++) {
      e.sl.agregarDoc('Invoices', { ...facturaAfecta(), DocEntry: 500 + i, DocumentLines: [linea(0)] });
    }
    const r = await e.worker.ciclo();
    expect(r?.emitidos).toBe(5);
    expect(e.sl.peticiones.some((p) => /skip/.test(p.query))).toBe(true);
    expect(new Set(e.api.emisiones.map((x) => x.clave)).size).toBe(5);
  });

  it('un fallo del PDF no bloquea la emisión', async () => {
    e.sl.fallar = (p) => p.ruta === 'Attachments2';
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
    expect(doc(e, 'Invoices', 100)['AttachmentEntry']).toBeNull();
  });

  it('la API key, la contraseña de Service Layer y la cookie no aparecen en los logs', async () => {
    e.api.colaEmision = [{ status: 500 }];
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    await e.worker.ciclo();
    await e.worker.ciclo();
    e.sl.expirarSesiones();
    await e.worker.ciclo();
    await e.cliente.cerrarSesion();
    const todo = e.logs.join('\n');
    expect(e.logs.length).toBeGreaterThan(3);
    expect(todo).not.toContain(e.api.apiKey);
    expect(todo).not.toContain('SECRETO-de-la-api-key');
    expect(todo).not.toContain(e.sl.credenciales.password);
    expect(todo).not.toMatch(/sesion-\d/);
    expect(todo).not.toContain('Bearer');
    for (const l of e.logs) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('Logout al apagar y apagado ordenado del ciclo continuo', async () => {
    await e.detener();
    e = await new Entorno().iniciar({ INTERVALO_SEGUNDOS: '1' });
    e.sl.agregarDoc('Invoices', { ...facturaAfecta() });
    const corrida = e.worker.ejecutar();
    await new Promise((ok) => setTimeout(ok, 400));
    e.worker.detener();
    await corrida;
    expect(e.sl.logouts).toBe(1);
    expect(doc(e, 'Invoices', 100)['U_SII_Estado']).toBe('ACEPTADO');
  });
});

describe('logger', () => {
  it('redacta claves sensibles y secretos literales', () => {
    const lineas: string[] = [];
    const log = crearLogger({ secretos: ['mi-clave-super-secreta'], salida: (l) => lineas.push(l) });
    log.info('prueba mi-clave-super-secreta', { apiKey: 'x', password: 'y', cookie: 'B1SESSION=z', otro: 'mi-clave-super-secreta', trackId: '55' });
    const l = lineas[0] ?? '';
    expect(l).not.toContain('mi-clave-super-secreta');
    expect(l).not.toContain('B1SESSION=z');
    expect(JSON.parse(l)).toMatchObject({ apiKey: '***', password: '***', cookie: '***', trackId: '55' });
  });
});

describe('instalar-udfs', () => {
  it('es idempotente: la segunda vez todo figura como existente', async () => {
    const log = crearLogger({ salida: () => undefined });
    const total = UDFS.reduce((n, u) => n + u.tablas.length, 0);
    const r1 = await instalarUdfs(e.cliente, log);
    expect(r1.creados).toHaveLength(total);
    expect(r1.errores).toEqual([]);
    expect(e.sl.udfs.size).toBe(total);
    const r2 = await instalarUdfs(e.cliente, log);
    expect(r2.creados).toHaveLength(0);
    expect(r2.existentes).toHaveLength(total);

    const estado = e.sl.udfs.get('OINV.SII_Estado') as { ValidValuesMD: Array<{ Value: string }>; Size: number };
    expect(estado.ValidValuesMD.map((v) => v.Value)).toEqual(['PENDIENTE', 'ENVIANDO', 'EMITIDO', 'ENVIADO', 'ACEPTADO', 'REPAROS', 'RECHAZADO', 'ERROR']);
    expect(estado.Size).toBe(20);
    const tipo = e.sl.udfs.get('ORIN.SII_TipoDTE') as { ValidValuesMD: Array<{ Value: string }> };
    expect(tipo.ValidValuesMD.map((v) => v.Value)).toEqual(['33', '34', '39', '41', '52', '56', '61']);
    expect(e.sl.udfs.has('ODLN.SII_IndTraslado')).toBe(true);
    expect(e.sl.udfs.has('OINV.SII_IndTraslado')).toBe(false);
    const ind = e.sl.udfs.get('ODLN.SII_IndTraslado') as { ValidValuesMD: Array<{ Value: string }>; Size: number };
    expect(ind.Size).toBe(2);
    expect(ind.ValidValuesMD.map((v) => v.Value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    for (const u of ['CatTraslado', 'DirOrigen', 'CmnaOrigen', 'RutTrans', 'RutChofer', 'NomChofer', 'Patente', 'PatenteCarro', 'FchSalida', 'HraSalida', 'FchLlegada']) {
      expect(e.sl.udfs.has(`ODLN.SII_${u}`), u).toBe(true);
      expect(e.sl.udfs.has(`OINV.SII_${u}`), u).toBe(false);
    }
    expect((e.sl.udfs.get('ODLN.SII_FchSalida') as { Type: string }).Type).toBe('db_Date');
  });

  it('trata el error "ya existe" de la creación como existente (carrera)', async () => {
    const log = crearLogger({ salida: () => undefined });
    e.sl.udfs.set('OINV.SII_Folio', {});
    // La consulta de existencia no lo ve (la simulamos vacía) pero la creación responde -2035.
    const listarReal = e.cliente.listar.bind(e.cliente);
    const falso = {
      listar: (async (ent: string, o?: Parameters<typeof listarReal>[1]) =>
        ent === 'UserFieldsMD' ? [] : listarReal(ent, o)) as typeof listarReal,
      crear: e.cliente.crear.bind(e.cliente),
    };
    const r = await instalarUdfs(falso, log);
    expect(r.existentes).toContain('OINV.U_SII_Folio');
    expect(r.errores).toEqual([]);
  });

  it('--dry-run imprime sin conectarse', async () => {
    const salida: string[] = [];
    const antes = e.sl.peticiones.length;
    const r = await instalarUdfs(null, crearLogger({ salida: () => undefined }), { dryRun: true, imprimir: (l) => salida.push(l) });
    expect(salida.length).toBe(UDFS.reduce((n, u) => n + u.tablas.length, 0));
    expect(salida[0]).toMatch(/^\[dry-run\] POST UserFieldsMD /);
    expect(r.creados).toHaveLength(0);
    expect(e.sl.peticiones.length).toBe(antes);
  });
});
