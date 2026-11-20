import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { ApiKey } from '../src/auth/entities/api-key.entity.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { calcularDv } from '../src/dte-core/index.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { EnvioDocumento } from '../src/envios/entities/envio-documento.entity.js';
import { Envio } from '../src/envios/entities/envio.entity.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';

const hayDb = await postgresDisponible();

describe.skipIf(!hayDb)('Autenticación y autorización (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const rutA = rutAleatorio((n) => calcularDv(n));
  const rutB = rutAleatorio((n) => calcularDv(n));
  const rutC = rutAleatorio((n) => calcularDv(n));
  const idsKeys: string[] = [];
  let docB: string;
  let envioB: string;
  let claveA: string;
  let idKeyA: string;

  const http = () => request(app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${ADMIN_KEY}` });
  const conClave = (clave: string) => ({ 'X-API-Key': clave });
  const empresa = (r: { texto: string }) => ({
    rut: r.texto,
    razonSocial: 'EMPRESA AUTH SPA',
    giro: 'Servicios',
    actecos: [620200],
    direccion: 'Av. Providencia 1234',
    comuna: 'Providencia',
    ciudad: 'Santiago',
  });

  beforeAll(async () => {
    configurarAdminKey();
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
    ds = modulo.get(DataSource);
  });

  afterAll(async () => {
    if (!app) return;
    for (const r of [rutA, rutB, rutC]) {
      const e = await ds.getRepository(Empresa).findOne({ where: { rut: r.numero } });
      if (!e) continue;
      const envios = await ds.getRepository(Envio).find({ where: { empresaId: e.id } });
      for (const v of envios) await ds.getRepository(EnvioDocumento).delete({ envioId: v.id });
      await ds.getRepository(Envio).delete({ empresaId: e.id });
      await ds.getRepository(Documento).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    for (const id of idsKeys) await ds.getRepository(ApiKey).delete({ id });
    await app.close();
  });

  it('GET / y /health son públicos', async () => {
    await http().get('/').expect(200);
    await http().get('/health').expect(200);
  });

  it('sin credencial: 401 problem+json con WWW-Authenticate', async () => {
    const r = await http().get(`/v1/empresas/${rutA.texto}`).expect(401);
    expect(r.headers['www-authenticate']).toBe('Bearer');
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('NO_AUTENTICADO');
    await http().post('/v1/api-keys').send({}).expect(401);
  });

  it('clave inválida o con formato ajeno: 401', async () => {
    await http().get(`/v1/empresas/${rutA.texto}`).set('Authorization', 'Bearer cualquiera').expect(401);
    await http()
      .get(`/v1/empresas/${rutA.texto}`)
      .set(conClave('sk_test_0123456789_' + 'a'.repeat(43)))
      .expect(401);
  });

  it('el admin crea empresas y una API key de la empresa A', async () => {
    await http().post('/v1/empresas').set(admin()).send(empresa(rutA)).expect(201);
    await http().post('/v1/empresas').set(admin()).send(empresa(rutB)).expect(201);

    // Validaciones del alta de claves.
    await http().post('/v1/api-keys').set(admin()).send({ nombre: 'x', permisos: ['inventado'], empresas: [] }).expect(400);
    await http().post('/v1/api-keys').set(admin()).send({ nombre: 'x', permisos: ['empresas.leer'] }).expect(400);

    const r = await http()
      .post('/v1/api-keys')
      .set(admin())
      .send({
        nombre: 'Worker SAP empresa A',
        permisos: ['empresas.leer', 'documentos.leer', 'envios.leer'],
        empresas: [rutA.texto],
      })
      .expect(201);
    expect(r.body.clave).toMatch(/^sk_test_[0-9a-f]{10}_[A-Za-z0-9_-]{43,}$/);
    expect(r.body.estado).toBe('activa');
    claveA = r.body.clave;
    idKeyA = r.body.id;
    idsKeys.push(idKeyA);

    // El secreto no se guarda en claro.
    const fila = await ds.getRepository(ApiKey).findOneByOrFail({ id: idKeyA });
    expect(JSON.stringify(fila)).not.toContain(claveA.split('_').pop() as string);
    expect(fila.hashClave).toHaveLength(64);

    // Documento y envío de la empresa B (insertados directo en BD).
    const b = await ds.getRepository(Empresa).findOneByOrFail({ rut: rutB.numero });
    const doc = await ds.getRepository(Documento).save(
      ds.getRepository(Documento).create({
        empresaId: b.id,
        cafId: null,
        tipoDte: 33,
        folio: 1,
        fechaEmision: '2026-11-18',
        montoTotal: 1190,
        estado: 'emitido',
        xmlFirmado: '<DTE/>',
        ted: '<TED/>',
      }),
    );
    docB = doc.id;
    const envio = await ds.getRepository(Envio).save(
      ds.getRepository(Envio).create({
        empresaId: b.id,
        canal: 'dte',
        ambienteSii: 'certificacion',
        trackId: String(900000000 + Math.floor(Math.random() * 99999999)),
        intentos: 0,
      }),
    );
    envioB = envio.id;
  });

  it('la key de A lee su empresa por Bearer y por X-API-Key', async () => {
    await http().get(`/v1/empresas/${rutA.texto}`).set('Authorization', `Bearer ${claveA}`).expect(200);
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(claveA)).expect(200);
    // Acepta el RUT con puntos.
    const conPuntos = rutA.texto.replace(/^(\d+)(\d{3})(\d{3})-/, '$1.$2.$3-');
    await http().get(`/v1/empresas/${conPuntos}`).set(conClave(claveA)).expect(200);
  });

  it('la key de A no accede a la empresa B (403) ni a sus documentos y envíos (404)', async () => {
    const e = await http().get(`/v1/empresas/${rutB.texto}`).set(conClave(claveA)).expect(403);
    expect(e.body.code).toBe('NO_AUTORIZADO');
    await http().get(`/v1/documentos/${docB}`).set(conClave(claveA)).expect(404);
    await http().get(`/v1/documentos/${docB}/xml`).set(conClave(claveA)).expect(404);
    await http().get(`/v1/documentos/${docB}/pdf`).set(conClave(claveA)).expect(404);
    await http().get(`/v1/envios/${envioB}`).set(conClave(claveA)).expect(404);
    const track = (await ds.getRepository(Envio).findOneByOrFail({ id: envioB })).trackId as string;
    await http().get(`/v1/envios/${track}`).set(conClave(claveA)).expect(404);
    await http().post(`/v1/envios/${envioB}/consultar`).set(conClave(claveA)).expect(404);
    await http().get(`/v1/empresas/${rutB.texto}/envios`).set(conClave(claveA)).expect(403);
    // El admin sí los ve.
    await http().get(`/v1/documentos/${docB}`).set(admin()).expect(200);
    await http().get(`/v1/envios/${envioB}`).set(admin()).expect(200);
  });

  it('falta de permiso: 403', async () => {
    await http().patch(`/v1/empresas/${rutA.texto}`).set(conClave(claveA)).send({ giro: 'Otro' }).expect(403);
    await http().post('/v1/empresas').set(conClave(claveA)).send(empresa(rutC)).expect(403);
    await http().get('/v1/api-keys').set(conClave(claveA)).expect(403);
  });

  it('anti-escalada: una key con api_keys.gestionar no otorga lo que no tiene', async () => {
    const gestora = await http()
      .post('/v1/api-keys')
      .set(admin())
      .send({
        nombre: 'Gestora A',
        permisos: ['api_keys.gestionar', 'empresas.leer'],
        empresas: [rutA.texto],
      })
      .expect(201);
    idsKeys.push(gestora.body.id);
    const k = gestora.body.clave as string;

    await http().post('/v1/api-keys').set(conClave(k)).send({ nombre: 'x', permisos: ['empresas.crear'], empresas: [rutA.texto] }).expect(403);
    await http().post('/v1/api-keys').set(conClave(k)).send({ nombre: 'x', permisos: ['empresas.leer'], empresas: [rutB.texto] }).expect(403);
    await http().post('/v1/api-keys').set(conClave(k)).send({ nombre: 'x', permisos: ['empresas.leer'], todasLasEmpresas: true }).expect(403);
    const ok = await http()
      .post('/v1/api-keys')
      .set(conClave(k))
      .send({ nombre: 'Hija', permisos: ['empresas.leer'], empresas: [rutA.texto] })
      .expect(201);
    idsKeys.push(ok.body.id);

    // Lista solo las que caben en su alcance; sin secretos.
    const lista = await http().get('/v1/api-keys').set(conClave(k)).expect(200);
    const ids = (lista.body.datos as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(ok.body.id);
    expect(JSON.stringify(lista.body)).not.toContain('"clave"');
    expect(JSON.stringify(lista.body)).not.toContain('hash');
    // El admin ve todas.
    const todas = await http().get('/v1/api-keys').set(admin()).expect(200);
    expect((todas.body.datos as { id: string }[]).map((x) => x.id)).toContain(idKeyA);
  });

  it('una key con empresas.crear y empresas acotadas recibe acceso a la empresa que crea', async () => {
    const r = await http()
      .post('/v1/api-keys')
      .set(admin())
      .send({ nombre: 'Creadora', permisos: ['empresas.crear', 'empresas.leer'], empresas: [] })
      .expect(201);
    idsKeys.push(r.body.id);
    const k = r.body.clave as string;
    await http().get(`/v1/empresas/${rutC.texto}`).set(conClave(k)).expect(403);
    await http().post('/v1/empresas').set(conClave(k)).send(empresa(rutC)).expect(201);
    await http().get(`/v1/empresas/${rutC.texto}`).set(conClave(k)).expect(200);
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(k)).expect(403);
    const lista = await http().get('/v1/api-keys').set(admin()).expect(200);
    const mia = (lista.body.datos as { id: string; empresas: string[] }[]).find((x) => x.id === r.body.id);
    expect(mia?.empresas).toEqual([`${rutC.numero}-${rutC.dv}`]);
  });

  it('una key expirada es rechazada (401)', async () => {
    const r = await http()
      .post('/v1/api-keys')
      .set(admin())
      .send({ nombre: 'Expira', permisos: ['empresas.leer'], empresas: [rutA.texto] })
      .expect(201);
    idsKeys.push(r.body.id);
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(r.body.clave)).expect(200);
    await ds.getRepository(ApiKey).update(r.body.id, { expiraEn: new Date(Date.now() - 1000) });
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(r.body.clave)).expect(401);
  });

  it('actualiza ultimo_uso_en sin bloquear', async () => {
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(claveA)).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    const fila = await ds.getRepository(ApiKey).findOneByOrFail({ id: idKeyA });
    expect(fila.ultimoUsoEn).not.toBeNull();
  });

  it('revocar invalida la clave de inmediato', async () => {
    await http().delete(`/v1/api-keys/${idKeyA}`).set(admin()).expect(204);
    await http().get(`/v1/empresas/${rutA.texto}`).set(conClave(claveA)).expect(401);
    const fila = await ds.getRepository(ApiKey).findOneByOrFail({ id: idKeyA });
    expect(fila.activa).toBe(false);
    expect(fila.revocadaEn).not.toBeNull();
    await http().delete(`/v1/api-keys/${idKeyA}`).set(admin()).expect(204);
    await http().delete('/v1/api-keys/00000000-0000-4000-8000-000000000000').set(admin()).expect(404);
  });
});
