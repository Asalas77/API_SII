import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { calcularDv, desdeIso88591, validarXsd } from '../src/dte-core/index.js';
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

const hayDb = await postgresDisponible();

const PASSWORD = 'clave-de-prueba';

// Requiere Postgres con las migraciones aplicadas (se omite en ~1 s si no responde).
describe.skipIf(!hayDb)('Emisión y envío por la API /v1 (e2e, con DB)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sii = crearSiiSimulado();
  const rut = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rut.texto}`;
  // Todas las peticiones llevan la clave de administración.
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);

  const factura = (extra: Record<string, unknown> = {}) => ({
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
    ...extra,
  });
  const boleta = (precio = 1190) => ({
    idDoc: { tipoDte: 39 },
    detalle: [{ nombre: 'Producto de prueba', cantidad: 1, precioUnitario: precio }],
  });

  async function subirCaf(tipoDte: number, desde = 1, hasta = 50, rutEmisor = rut.texto) {
    return http()
      .post(`${base}/cafs`)
      .attach(
        'archivo',
        Buffer.from(
          generarCafRealista({ tipoDte, folioDesde: desde, folioHasta: hasta, rutEmisor }),
        ),
        'caf.xml',
      );
  }

  beforeAll(async () => {
    configurarAdminKey();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SII_FETCH)
      .useValue(sii.fetch)
      .compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
    dataSource = modulo.get(DataSource);
  });

  afterAll(async () => {
    if (!app) return;
    const empresa = await dataSource.getRepository(Empresa).findOne({ where: { rut: rut.numero } });
    if (empresa) {
      const docs = await dataSource.getRepository(Documento).find({ where: { empresaId: empresa.id } });
      const envios = await dataSource.getRepository(Envio).find({ where: { empresaId: empresa.id } });
      for (const e of envios) await dataSource.getRepository(EnvioDocumento).delete({ envioId: e.id });
      await dataSource.getRepository(Envio).delete({ empresaId: empresa.id });
      await dataSource.getRepository(Documento).delete(docs.map((d) => d.id));
      await dataSource.getRepository(Caf).delete({ empresaId: empresa.id });
      await dataSource.getRepository(Certificado).delete({ empresaId: empresa.id });
      await dataSource.getRepository(Empresa).delete({ id: empresa.id });
    }
    await app.close();
  });

  it('crea la empresa, rechaza duplicados y RUT inválidos con problem+json', async () => {
    const cuerpo = {
      rut: rut.texto,
      razonSocial: 'EMPRESA E2E SPA',
      giro: 'Servicios informáticos',
      actecos: [620200],
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      ciudad: 'Santiago',
    };
    const creada = await http().post('/v1/empresas').send(cuerpo).expect(201);
    expect(creada.body).toMatchObject({ rut: rut.texto, ambienteSii: 'certificacion', activa: true });

    const dup = await http().post('/v1/empresas').send(cuerpo).expect(409);
    expect(dup.headers['content-type']).toContain('application/problem+json');
    expect(dup.body.code).toBe('EMPRESA_EXISTENTE');

    const malo = await http().post('/v1/empresas').send({ ...cuerpo, rut: '12345678-0' }).expect(400);
    expect(malo.body.code).toBe('VALIDACION');
    expect(malo.body.errors[0].campo).toBe('rut');

    await http().get('/v1/empresas/11111111-1').expect(404);
    await http()
      .patch(`/v1/empresas/${rut.texto}`)
      .send({ nroResolucionSii: 0, fechaResolucionSii: '2026-01-15' })
      .expect(200);
    const leida = await http().get(`/v1/empresas/${rut.texto}`).expect(200);
    expect(leida.body.nroResolucionSii).toBe(0);
  });

  it('sin certificado no emite (422) y sin folios responde 409', async () => {
    const sinCert = await http().post(`${base}/documentos`).send(factura()).expect(422);
    expect(sinCert.body.code).toBe('CERTIFICADO_INVALIDO');
  });

  it('sube el PFX (cifrado, sin devolverlo) y valida contraseña', async () => {
    const pfx = generarPfxPrueba(PASSWORD, { rut: '12345678-5', nombre: 'Firmante E2E' });
    await http()
      .post(`${base}/certificados`)
      .attach('archivo', pfx, 'cert.pfx')
      .field('password', 'otra')
      .expect(422);

    const ok = await http()
      .post(`${base}/certificados`)
      .attach('archivo', pfx, 'cert.pfx')
      .field('password', PASSWORD)
      .expect(201);
    expect(ok.body).toMatchObject({ rutFirmante: '12345678-5', activo: true });
    expect(JSON.stringify(ok.body)).not.toContain(PASSWORD);
    expect(ok.body.pfxCifrado).toBeUndefined();

    const fila = await dataSource.getRepository(Certificado).findOneByOrFail({ id: ok.body.id });
    expect(fila.pfxCifrado.equals(pfx)).toBe(false);
  });

  it('registra CAF cifrado, rechaza CAF de otro RUT y lista folios', async () => {
    const ajeno = await subirCaf(33, 1, 50, '11111111-1');
    expect(ajeno.status).toBe(422);
    expect(ajeno.body.code).toBe('CAF_INVALIDO');

    const sinFolios = await http().post(`${base}/documentos`).send(factura()).expect(409);
    expect(sinFolios.body.code).toBe('SIN_FOLIOS_DISPONIBLES');

    for (const tipo of [33, 39, 61]) {
      const r = await subirCaf(tipo);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ tipoDte: tipo, folioDesde: 1, folioHasta: 50, disponibles: 50 });
    }
    const caf = await dataSource.getRepository(Caf).findOneByOrFail({
      id: (await http().get(`${base}/folios?tipoDte=33`).expect(200)).body.datos[0].cafId,
    });
    expect(caf.xml).toBeNull();
    expect(caf.xmlCifrado?.length).toBeGreaterThan(100);
    expect(caf.xmlCifrado?.toString('utf8')).not.toContain('RSASK');

    const folios = await http().get(`${base}/folios`).expect(200);
    expect(folios.body.datos).toHaveLength(3);
  });

  let id33 = '';
  let id39 = '';

  it('emite una factura 33 de forma idempotente', async () => {
    const a = await http().post(`${base}/documentos`).set('Idempotency-Key', 'clave-1').send(factura()).expect(201);
    expect(a.body).toMatchObject({
      tipoDte: 33,
      folio: 1,
      estado: 'emitido',
      totales: { montoNeto: 20000, iva: 3800, montoTotal: 23800 },
    });
    id33 = a.body.id as string;

    const repetida = await http().post(`${base}/documentos`).set('Idempotency-Key', 'clave-1').send(factura()).expect(200);
    expect(repetida.headers['idempotent-replayed']).toBe('true');
    expect(repetida.body.id).toBe(id33);

    const conflicto = await http()
      .post(`${base}/documentos`)
      .set('Idempotency-Key', 'clave-1')
      .send(factura({ detalle: [{ nombre: 'Otro', cantidad: 1, precioUnitario: 5 }] }))
      .expect(409);
    expect(conflicto.body.code).toBe('IDEMPOTENCIA_CONFLICTO');

    const otra = await http().post(`${base}/documentos`).set('Idempotency-Key', 'clave-2').send(factura()).expect(201);
    expect(otra.body.folio).toBe(2);
  });

  it('solicitudes simultáneas con la misma clave emiten un solo documento', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () =>
        http().post(`${base}/documentos`).set('Idempotency-Key', 'clave-conc').send(factura()),
      ),
    );
    expect(respuestas.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(respuestas.map((r) => r.body.id)).size).toBe(1);
  });

  it('emite una boleta 39 sin receptor', async () => {
    const b = await http().post(`${base}/documentos`).set('Idempotency-Key', 'b-1').send(boleta()).expect(201);
    expect(b.body).toMatchObject({ tipoDte: 39, folio: 1, totales: { montoTotal: 1190 } });
    id39 = b.body.id as string;
  });

  it('un error al construir el documento no consume el folio', async () => {
    // Nota de crédito sin referencia: ErrorValidacionDte (422).
    const nc = {
      idDoc: { tipoDte: 61 },
      receptor: factura().receptor,
      detalle: [{ nombre: 'Devolución', cantidad: 1, precioUnitario: 1000 }],
    };
    const r = await http().post(`${base}/documentos`).send(nc).expect(422);
    expect(r.body.code).toBe('DOCUMENTO_INVALIDO');
    const folios = await http().get(`${base}/folios?tipoDte=61`).expect(200);
    expect(folios.body.datos[0]).toMatchObject({ folioSiguiente: 1, disponibles: 50 });

    const ok = await http()
      .post(`${base}/documentos`)
      .send({ ...nc, referencias: [{ tipoDocRef: '33', folioRef: 1, codRef: 1, razonRef: 'Anula' }] })
      .expect(201);
    expect(ok.body.folio).toBe(1);
  });

  it('valida el cuerpo: 400 con detalle por campo', async () => {
    const r = await http().post(`${base}/documentos`).send({ idDoc: { tipoDte: 99 }, detalle: [] }).expect(400);
    expect(r.body.code).toBe('VALIDACION');
    expect(r.body.errors.length).toBeGreaterThan(0);
  });

  it('descarga el XML en ISO-8859-1 válido contra el XSD y el PDF', async () => {
    const xml = await http()
      .get(`/v1/documentos/${id33}/xml`)
      .buffer(true)
      .parse((res, cb) => {
        const trozos: Buffer[] = [];
        res.on('data', (t: Buffer) => trozos.push(t));
        res.on('end', () => cb(null, Buffer.concat(trozos)));
      })
      .expect(200);
    expect(xml.headers['content-type']).toContain('ISO-8859-1');
    const texto = desdeIso88591(xml.body as Buffer);
    expect(texto).toContain('<TipoDTE>33</TipoDTE>');
    expect(validarXsd(texto, 'DTE')).toEqual({ valido: true, errores: [] });

    const pdf = await http()
      .get(`/v1/documentos/${id33}/pdf?cedible=true`)
      .buffer(true)
      .parse((res, cb) => {
        const trozos: Buffer[] = [];
        res.on('data', (t: Buffer) => trozos.push(t));
        res.on('end', () => cb(null, Buffer.concat(trozos)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    await http().get('/v1/documentos/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('envía la factura (EnvioDTE) y consulta el estado', async () => {
    const e = await http().post(`${base}/envios`).send({ documentoIds: [id33] }).expect(201);
    expect(e.body.envios).toHaveLength(1);
    const envio = e.body.envios[0];
    expect(envio).toMatchObject({ canal: 'dte', estado: 'REC', ambienteSii: 'certificacion' });
    expect(envio.trackId).toMatch(/^\d+$/);
    const doc = await http().get(`/v1/documentos/${id33}`).expect(200);
    expect(doc.body).toMatchObject({ estado: 'enviado', trackId: envio.trackId });

    // Un documento ya enviado no se reenvía.
    await http().post(`${base}/envios`).send({ documentoIds: [id33] }).expect(409);

    sii.estadoDte.estado = 'EPR';
    const c = await http().post(`/v1/envios/${envio.id}/consultar`).expect(200);
    expect(c.body).toMatchObject({ estado: 'EPR', esFinal: true });
    expect(c.body.documentos[0]).toMatchObject({ estadoDocumento: 'aceptado' });
    const por = await http().get(`/v1/envios/${envio.trackId}`).expect(200);
    expect(por.body.id).toBe(envio.id);
  });

  it('envía boletas pendientes (EnvioBOLETA) y aplica reparos del SII', async () => {
    const e = await http().post(`${base}/envios`).send({ tipo: 39, pendientes: true }).expect(201);
    expect(e.body.envios[0]).toMatchObject({ canal: 'boleta' });
    expect(e.body.envios[0].documentos.map((d: { documentoId: string }) => d.documentoId)).toEqual([id39]);
    await http().post(`${base}/envios`).send({ tipo: 39, pendientes: true }).expect(422);

    sii.estadoBoleta = {
      estado: 'RPR',
      estadistica: [{ tipo: 39, informados: 1, aceptados: 0, rechazados: 0, reparos: 1 }],
      detalle_rep_rech: [
        {
          tipo: 39,
          folio: 1,
          estado: 'RPR',
          descripcion: 'Aceptado con reparos',
          error: [{ seccion: 'DET', linea: 1, nivel: 2, codigo: 1, descripcion: 'reparo de prueba', detalle: '' }],
        },
      ],
    };
    const c = await http().post(`/v1/envios/${e.body.envios[0].id}/consultar`).expect(200);
    expect(c.body.estado).toBe('RPR');
    const doc = await http().get(`/v1/documentos/${id39}`).expect(200);
    expect(doc.body.estado).toBe('aceptado_con_reparos');
    expect(doc.body.reparos[0].descripcion).toBe('reparo de prueba');
  });

  it('agrupa las boletas en sobres de 50', async () => {
    expect((await subirCaf(39, 51, 200)).status).toBe(201);
    const ids: string[] = [];
    // 1 boleta ya enviada (folio 1): quedan pendientes las nuevas, emitidas de a 10 en paralelo.
    for (let lote = 0; lote < 6; lote++) {
      const r = await Promise.all(
        Array.from({ length: lote === 5 ? 1 : 10 }, (_, i) =>
          http().post(`${base}/documentos`).send(boleta(1000 + lote * 10 + i)),
        ),
      );
      for (const x of r) {
        expect(x.status).toBe(201);
        ids.push(x.body.id as string);
      }
    }
    expect(ids).toHaveLength(51);
    // El CAF 1-50 todavía tiene folios 2..50: se consumieron antes los del CAF más antiguo.
    const e = await http().post(`${base}/envios`).send({ tipo: 39, pendientes: true }).expect(201);
    expect(e.body.envios.map((x: { documentos: unknown[] }) => x.documentos.length)).toEqual([50, 1]);
    expect(new Set(e.body.envios.map((x: { trackId: string }) => x.trackId)).size).toBe(2);
  }, 60_000);
});
