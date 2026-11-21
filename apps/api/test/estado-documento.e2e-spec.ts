import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { ApiKey } from '../src/auth/entities/api-key.entity.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { calcularDv } from '../src/dte-core/index.js';
import { generarPfxPrueba } from '../src/dte-core/testing/testing.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { EnvioDocumento } from '../src/envios/entities/envio-documento.entity.js';
import { Envio } from '../src/envios/entities/envio.entity.js';
import { Caf } from '../src/folios/entities/caf.entity.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();

const PASSWORD = 'clave-de-prueba';

// Requiere Postgres con las migraciones aplicadas (se omite en ~1 s si no responde).
describe.skipIf(!hayDb)('Consulta del estado de cada documento en el SII (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sii = crearSiiSimulado();
  const rutA = rutAleatorio((n) => calcularDv(n));
  const rutB = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rutA.texto}`;
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);
  let claveB = '';
  let idKeyB = '';

  const factura = () => ({
    idDoc: { tipoDte: 33, formaPago: 1 },
    receptor: {
      rut: '12345678-5',
      razonSocial: 'CLIENTE DE PRUEBA LTDA',
      giro: 'Comercio',
      direccion: 'Calle Falsa 123',
      comuna: 'Santiago',
      ciudad: 'Santiago',
    },
    detalle: [{ nombre: 'Servicio de prueba', cantidad: 2, precioUnitario: 10000 }],
  });
  const boleta = () => ({
    idDoc: { tipoDte: 39 },
    detalle: [{ nombre: 'Producto de prueba', cantidad: 1, precioUnitario: 1190 }],
  });
  const empresa = (r: { texto: string }) => ({
    rut: r.texto,
    razonSocial: 'EMPRESA ESTADO SPA',
    giro: 'Servicios informáticos',
    actecos: [620200],
    direccion: 'Av. Providencia 1234',
    comuna: 'Providencia',
    ciudad: 'Santiago',
  });

  async function emitir(cuerpo: object): Promise<{ id: string; folio: number }> {
    const r = await http().post(`${base}/documentos`).send(cuerpo).expect(201);
    return { id: r.body.id as string, folio: r.body.folio as number };
  }
  async function enviar(documentoIds: string[]): Promise<{ id: string; trackId: string }> {
    const r = await http().post(`${base}/envios`).send({ documentoIds }).expect(201);
    return r.body.envios[0] as { id: string; trackId: string };
  }
  const estadoDe = async (id: string) =>
    (await ds.getRepository(Documento).findOneByOrFail({ id })).estado;

  const docs: Record<string, { id: string; folio: number }> = {};

  beforeAll(async () => {
    configurarAdminKey();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SII_FETCH)
      .useValue(sii.fetch)
      .compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
    ds = await crearDsFixtures();
  });

  afterAll(async () => {
    if (!app) return;
    for (const r of [rutA, rutB]) {
      const e = await ds.getRepository(Empresa).findOne({ where: { rut: r.numero } });
      if (!e) continue;
      const envios = await ds.getRepository(Envio).find({ where: { empresaId: e.id } });
      for (const v of envios) await ds.getRepository(EnvioDocumento).delete({ envioId: v.id });
      await ds.getRepository(Envio).delete({ empresaId: e.id });
      await ds.getRepository(Documento).delete({ empresaId: e.id });
      await ds.getRepository(Caf).delete({ empresaId: e.id });
      await ds.getRepository(Certificado).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    if (idKeyB) await ds.getRepository(ApiKey).delete({ id: idKeyB });
    await app.close();
    await ds.destroy();
  });

  it('prepara dos empresas, certificado, CAF y una key de la empresa B', async () => {
    await http().post('/v1/empresas').send(empresa(rutA)).expect(201);
    await http().post('/v1/empresas').send(empresa(rutB)).expect(201);
    await http()
      .patch(base)
      .send({ nroResolucionSii: 0, fechaResolucionSii: '2026-01-15' })
      .expect(200);
    const pfx = generarPfxPrueba(PASSWORD, { rut: '12345678-5', nombre: 'Firmante E2E' });
    await http().post(`${base}/certificados`).attach('archivo', pfx, 'cert.pfx').field('password', PASSWORD).expect(201);
    for (const tipo of [33, 39]) {
      await http()
        .post(`${base}/cafs`)
        .attach(
          'archivo',
          Buffer.from(generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 50, rutEmisor: rutA.texto })),
          'caf.xml',
        )
        .expect(201);
    }
    const k = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'Key empresa B', permisos: ['documentos.leer', 'envios.leer'], empresas: [rutB.texto] })
      .expect(201);
    claveB = k.body.clave as string;
    idKeyB = k.body.id as string;
  });

  it('un documento no enviado responde 409 problem+json', async () => {
    docs.noEnviado = await emitir(factura());
    const r = await http().post(`/v1/documentos/${docs.noEnviado.id}/consultar-estado`).expect(409);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('ESTADO_INVALIDO');
    expect(r.body.detail).toContain('enviados al SII');
    expect(await estadoDe(docs.noEnviado.id)).toBe('emitido');
  });

  it('DOK: el documento enviado pasa a aceptado y GET lo refleja', async () => {
    for (const k of ['dok', 'fna', 'dnk', 'error', 'lote']) docs[k] = await emitir(factura());
    docs.boleta = await emitir(boleta());
    await enviar([docs.dok.id, docs.fna.id, docs.dnk.id, docs.error.id, docs.lote.id]);
    const eb = await http().post(`${base}/envios`).send({ documentoIds: [docs.boleta.id] }).expect(201);
    expect(eb.body.envios[0].canal).toBe('boleta');

    const antes = sii.llamadas.length;
    const r = await http().post(`/v1/documentos/${docs.dok.id}/consultar-estado`).expect(200);
    expect(r.body).toMatchObject({
      estadoSii: 'DOK',
      esFinal: true,
      documento: { id: docs.dok.id, estado: 'aceptado', estadoSii: 'DOK' },
    });
    expect(r.body.descripcionEstado).toContain('Datos coinciden');
    expect(r.body.advertencia).toBeUndefined();
    expect(r.body.documento.consultadoSiiEn).toBeTruthy();

    // Parámetros enviados a getEstDte: emisor, receptor, tipo, folio, fecha ddmmyyyy y monto total.
    const soap = String(sii.llamadas.slice(antes).find((l) => l.url.endsWith('/QueryEstDte.jws'))?.body);
    expect(soap).toContain(`<RutCompania>${rutA.numero}</RutCompania>`);
    expect(soap).toContain('<RutReceptor>12345678</RutReceptor><DvReceptor>5</DvReceptor>');
    expect(soap).toContain(`<TipoDte>33</TipoDte><FolioDte>${docs.dok.folio}</FolioDte>`);
    expect(soap).toMatch(/<FechaEmisionDte>\d{8}<\/FechaEmisionDte>/);
    expect(soap).toContain('<MontoDte>23800</MontoDte>');

    const get = await http().get(`/v1/documentos/${docs.dok.id}`).expect(200);
    expect(get.body).toMatchObject({ estado: 'aceptado', estadoSii: 'DOK' });
    expect(get.body.glosaSii).toBeTruthy();
    expect(get.body.consultadoSiiEn).toBeTruthy();
  });

  it('FNA: el documento enviado pasa a rechazado', async () => {
    sii.estadoDocumentoDte[`33-${docs.fna.folio}`] = { estado: 'FNA', glosa: 'Documento No Autorizado' };
    const r = await http().post(`/v1/documentos/${docs.fna.id}/consultar-estado`).expect(200);
    expect(r.body).toMatchObject({ estadoSii: 'FNA', glosaSii: 'Documento No Autorizado', esFinal: true });
    expect(r.body.documento.estado).toBe('rechazado');
  });

  it('DNK: no cambia el estado y devuelve una advertencia', async () => {
    sii.estadoDocumentoDte[`33-${docs.dnk.folio}`] = { estado: 'DNK' };
    const r = await http().post(`/v1/documentos/${docs.dnk.id}/consultar-estado`).expect(200);
    expect(r.body.estadoSii).toBe('DNK');
    expect(r.body.advertencia).toContain('no coinciden');
    expect(r.body.documento.estado).toBe('enviado');
    expect(r.body.documento.estadoSii).toBe('DNK');
  });

  it('un error de consulta responde 502 y no modifica el documento', async () => {
    sii.estadoDocumentoDte[`33-${docs.error.folio}`] = { estado: '-4' };
    const r = await http().post(`/v1/documentos/${docs.error.id}/consultar-estado`).expect(502);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('SII_CONSULTA_ERROR');
    const fila = await ds.getRepository(Documento).findOneByOrFail({ id: docs.error.id });
    expect(fila).toMatchObject({ estado: 'enviado', estadoSii: null, glosaSii: null, consultadoSiiEn: null });
  });

  it('boleta: consulta el estado individual con monto y fecha DD-MM-YYYY', async () => {
    const antes = sii.llamadas.length;
    const r = await http().post(`/v1/documentos/${docs.boleta.id}/consultar-estado`).expect(200);
    expect(r.body.estadoSii).toBe('DOK');
    expect(r.body.documento.estado).toBe('aceptado');
    const url = sii.llamadas.slice(antes).find((l) => l.url.includes('/estado'))?.url ?? '';
    expect(url).toContain(`-39-${docs.boleta.folio}/estado`);
    expect(url).toContain('monto=1190');
    expect(url).toMatch(/fechaEmision=\d{2}-\d{2}-\d{4}/);
    expect(url).toContain('rut_receptor=66666666');
  });

  it('no degrada aceptado_con_reparos, y AND/ANC dejan el estado de emisión (la anulación queda en estado_sii)', async () => {
    await ds.getRepository(Documento).update({ id: docs.dok.id }, { estado: 'aceptado_con_reparos' });
    const r = await http().post(`/v1/documentos/${docs.dok.id}/consultar-estado`).expect(200);
    expect(r.body.documento.estado).toBe('aceptado_con_reparos');

    sii.estadoDocumentoDte[`33-${docs.dok.folio}`] = { estado: 'ANC' };
    const a = await http().post(`/v1/documentos/${docs.dok.id}/consultar-estado`).expect(200);
    expect(a.body).toMatchObject({ estadoSii: 'ANC' });
    expect(a.body.documento.estado).toBe('aceptado_con_reparos');
    expect(a.body.documento.estadoSii).toBe('ANC');
  });

  it('FAN: el SII lo informa anulado', async () => {
    sii.estadoDocumentoDte[`33-${docs.dok.folio}`] = { estado: 'FAN' };
    const r = await http().post(`/v1/documentos/${docs.dok.id}/consultar-estado`).expect(200);
    expect(r.body.documento.estado).toBe('anulado');
  });

  it('lote por ids: un fallo no aborta el lote y se informa en su ítem', async () => {
    // docs.error sigue en error (-4); docs.lote responde DOK; uno inexistente y uno no enviado.
    const inexistente = '00000000-0000-4000-8000-000000000000';
    const r = await http()
      .post(`${base}/documentos/consultar-estados`)
      .send({ documentoIds: [docs.error.id, docs.lote.id, inexistente, docs.noEnviado.id] })
      .expect(200);
    expect(r.body).toMatchObject({ total: 4, consultados: 1, conError: 3 });
    const [e, ok, no, ne] = r.body.resultados;
    expect(e).toMatchObject({ documentoId: docs.error.id, ok: false, error: { code: 'SII_CONSULTA_ERROR' } });
    expect(ok).toMatchObject({ documentoId: docs.lote.id, ok: true, estadoSii: 'DOK', estado: 'aceptado' });
    expect(no).toMatchObject({ ok: false, error: { code: 'NO_ENCONTRADO' } });
    expect(ne).toMatchObject({ ok: false, error: { code: 'ESTADO_INVALIDO' } });
    expect(await estadoDe(docs.error.id)).toBe('enviado');
  });

  it('lote sin cuerpo: consulta los documentos en estado enviado de la empresa', async () => {
    delete sii.estadoDocumentoDte[`33-${docs.error.folio}`];
    const r = await http().post(`${base}/documentos/consultar-estados`).expect(200);
    // Enviados: dnk (sigue DNK) y error (ahora DOK).
    expect(r.body).toMatchObject({ total: 2, consultados: 2, conError: 0 });
    const porId = Object.fromEntries(
      (r.body.resultados as Array<{ documentoId: string; advertencia?: string }>).map((x) => [x.documentoId, x]),
    );
    expect(porId[docs.error.id]).toMatchObject({ estado: 'aceptado', estadoSii: 'DOK' });
    expect(porId[docs.dnk.id]).toMatchObject({ estado: 'enviado', estadoSii: 'DNK' });
    expect(porId[docs.dnk.id].advertencia).toContain('no coinciden');

    // `limite` acota el lote por defecto (queda solo dnk, que sigue enviado) y se valida.
    const vacio = await http().post(`${base}/documentos/consultar-estados`).send({ limite: 5 }).expect(200);
    expect(vacio.body.total).toBe(1);
    await http().post(`${base}/documentos/consultar-estados`).send({ limite: 500 }).expect(400);
  });

  it('un envío con resultado mixto se resuelve consultando getEstDte por documento', async () => {
    const a = await emitir(factura());
    const b = await emitir(factura());
    const envio = await enviar([a.id, b.id]);
    sii.estadoDte = {
      estado: 'EPR',
      glosa: 'Envio Procesado',
      cuerpoXml:
        '<TIPO_DOCTO>33</TIPO_DOCTO><INFORMADOS>2</INFORMADOS><ACEPTADOS>1</ACEPTADOS><RECHAZADOS>1</RECHAZADOS><REPAROS>0</REPAROS>',
    };
    sii.estadoDocumentoDte[`33-${a.folio}`] = { estado: 'DOK' };
    sii.estadoDocumentoDte[`33-${b.folio}`] = { estado: 'FNA', glosa: 'Documento No Autorizado' };

    const c = await http().post(`/v1/envios/${envio.id}/consultar`).expect(200);
    const porDoc = Object.fromEntries(
      (c.body.documentos as Array<{ documentoId: string; estadoDocumento: string; estado: string }>).map((d) => [
        d.documentoId,
        d,
      ]),
    );
    expect(porDoc[a.id]).toMatchObject({ estadoDocumento: 'aceptado', estado: 'DOK' });
    expect(porDoc[b.id]).toMatchObject({ estadoDocumento: 'rechazado', estado: 'FNA' });
    expect((await http().get(`/v1/documentos/${b.id}`).expect(200)).body.estadoSii).toBe('FNA');
  });

  it('aislamiento: la key de otra empresa recibe 404 en el individual y 403 en el lote', async () => {
    const k = { 'X-API-Key': claveB };
    const agente = () => request(app.getHttpServer());
    await agente().post(`/v1/documentos/${docs.dok.id}/consultar-estado`).set(k).expect(404);
    await agente().get(`/v1/documentos/${docs.dok.id}`).set(k).expect(404);
    await agente().post(`${base}/documentos/consultar-estados`).set(k).send({}).expect(403);
    // Con su propia empresa el lote responde (vacío).
    const propio = await agente().post(`/v1/empresas/${rutB.texto}/documentos/consultar-estados`).set(k).send({}).expect(200);
    expect(propio.body.total).toBe(0);
  });
});
