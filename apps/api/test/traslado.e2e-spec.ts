import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { siiConfig } from '../src/config/sii.config.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { calcularDv, desdeIso88591, validarXsd } from '../src/dte-core/index.js';
import { generarPfxPrueba } from '../src/dte-core/testing/testing.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { Caf } from '../src/folios/entities/caf.entity.js';
import { extraerDatosImpresion } from '../src/representacion/datos-impresion.js';
import { filasTraslado } from '../src/representacion/generar-pdf.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();
const dv = (n: string) => `${n}-${calcularDv(n)}`;

describe.skipIf(!hayDb)('Traslado Res. Ex. SII 144/2026 (e2e, con DB)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const sii = crearSiiSimulado();
  const rut = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rut.texto}`;
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);
  const binario = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
    const trozos: Buffer[] = [];
    res.on('data', (t: Buffer) => trozos.push(t));
    res.on('end', () => cb(null, Buffer.concat(trozos)));
  };

  const receptor = {
    rut: '12345678-5',
    razonSocial: 'CLIENTE DE PRUEBA LTDA',
    giro: 'Comercio',
    direccion: 'Calle Falsa 123',
    comuna: 'Santiago',
    ciudad: 'Santiago',
  };
  const traslado = (extra: Record<string, unknown> = {}) => ({
    categoria: 'autogestionado',
    destino: { direccion: 'Los Leones 99', comuna: 'Ñuñoa', ciudad: 'Santiago' },
    fechaSalida: '2026-11-23',
    transportista: { rut: dv('76543210') },
    chofer: { rut: dv('11222333'), nombre: 'Juan Pérez Soto' },
    patente: 'BCDF12',
    ...extra,
  });
  const guia = (t: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    idDoc: { tipoDte: 52, indTraslado: 1 },
    receptor,
    detalle: [{ nombre: 'Cemento 25 kg', cantidad: 10, unidad: 'UN', precioUnitario: 5000, peso: { valor: 250, unidad: 'KG' } }],
    traslado: t,
    ...extra,
  });
  const tercerizada = () =>
    traslado({
      categoria: 'tercerizado',
      transportista: undefined,
      chofer: undefined,
      patente: undefined,
      fechaSalida: undefined,
      diferido: ['transportista', 'choferRut', 'choferNombre', 'patente', 'fechaSalida'],
    });

  beforeAll(async () => {
    configurarAdminKey();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SII_FETCH)
      .useValue(sii.fetch)
      .compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
    dataSource = await crearDsFixtures();
  });

  afterAll(async () => {
    if (!app) return;
    const empresa = await dataSource.getRepository(Empresa).findOne({ where: { rut: rut.numero } });
    if (empresa) {
      const docs = await dataSource.getRepository(Documento).find({ where: { empresaId: empresa.id } });
      if (docs.length > 0) await dataSource.getRepository(Documento).delete(docs.map((d) => d.id));
      await dataSource.getRepository(Caf).delete({ empresaId: empresa.id });
      await dataSource.getRepository(Certificado).delete({ empresaId: empresa.id });
      await dataSource.getRepository(Empresa).delete({ id: empresa.id });
    }
    await app.close();
    await dataSource.destroy();
  });

  it('prepara empresa, certificado y folios', async () => {
    await http()
      .post('/v1/empresas')
      .send({
        rut: rut.texto,
        razonSocial: 'EMPRESA TRASLADO SPA',
        giro: 'Distribución',
        actecos: [467300],
        direccion: 'Bodega Central 100',
        comuna: 'Quilicura',
        ciudad: 'Santiago',
      })
      .expect(201);
    await http()
      .post(`${base}/certificados`)
      .attach('archivo', generarPfxPrueba('clave-de-prueba', { rut: '12345678-5', nombre: 'Firmante' }), 'cert.pfx')
      .field('password', 'clave-de-prueba')
      .expect(201);
    for (const tipo of [33, 52]) {
      await http()
        .post(`${base}/cafs`)
        .attach('archivo', Buffer.from(generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 50, rutEmisor: rut.texto })), 'caf.xml')
        .expect(201);
    }
  });

  it('guía autogestionada: emite, valida contra el XSD y el PDF lleva los datos', async () => {
    const r = await http().post(`${base}/documentos`).send(guia(traslado())).expect(201);
    expect(r.body).toMatchObject({ tipoDte: 52, trasladoPendiente: false, traslado: { categoria: 'autogestionado', pendiente: false } });
    expect(r.body.traslado.solicitud).toBeUndefined();

    const xml = await http().get(`/v1/documentos/${r.body.id}/xml`).buffer(true).parse(binario).expect(200);
    const texto = desdeIso88591(xml.body as Buffer);
    expect(texto).toContain('<Patente>BCDF12</Patente>');
    expect(texto).toContain('<DirOrigen>Bodega Central 100</DirOrigen>');
    expect(texto).toContain('Peso: 250 KG.');
    expect(validarXsd(texto, 'DTE')).toEqual({ valido: true, errores: [] });

    const filas = Object.fromEntries(filasTraslado(extraerDatosImpresion(texto)));
    expect(filas['Patente:']).toBe('BCDF12');
    expect(filas['Destino:']).toBe('Los Leones 99, Ñuñoa, Santiago');
    const pdf = await http().get(`/v1/documentos/${r.body.id}/pdf`).buffer(true).parse(binario).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('IndTraslado 10 se rechaza por defecto (XSD oficial sin 10-12) con el campo exacto', async () => {
    const r = await http()
      .post(`${base}/documentos`)
      .send({ ...guia(traslado({ categoria: 'tercerizado' })), idDoc: { tipoDte: 52, indTraslado: 10 } })
      .expect(422);
    expect(r.body.code).toBe('DOCUMENTO_INVALIDO');
    expect(r.body.errors[0].campo).toBe('idDoc.indTraslado');
    expect(r.body.detail).toContain('XSD oficial');
    const malo = await http()
      .post(`${base}/documentos`)
      .send(guia(traslado({ patente: 'XX' })))
      .expect(422);
    expect(malo.body.errors[0].campo).toBe('traslado.patente');
  });

  it('guía sin bloque traslado: 422 DOCUMENTO_INVALIDO con EXIGIR_TRASLADO_GUIAS=true (por defecto)', async () => {
    const { traslado: _omitido, ...sinTraslado } = guia(traslado());
    const r = await http().post(`${base}/documentos`).send(sinTraslado).expect(422);
    expect(r.body.code).toBe('DOCUMENTO_INVALIDO');
    expect(r.body.errors[0].campo).toBe('traslado');
    expect(r.body.detail).toContain('Res. Ex. SII 144/2026');
    // Una factura sin traslado sigue siendo válida.
    await http()
      .post(`${base}/documentos`)
      .send({ idDoc: { tipoDte: 33 }, receptor, detalle: [{ nombre: 'Servicio', cantidad: 1, precioUnitario: 1000 }] })
      .expect(201);
  });

  it('guía sin bloque traslado: se emite con EXIGIR_TRASLADO_GUIAS=false', async () => {
    const cfg = app.get<{ exigirTrasladoGuias: boolean }>(siiConfig.KEY);
    const { traslado: _omitido, ...sinTraslado } = guia(traslado());
    cfg.exigirTrasladoGuias = false;
    try {
      const r = await http().post(`${base}/documentos`).send(sinTraslado).expect(201);
      expect(r.body).toMatchObject({ tipoDte: 52, trasladoPendiente: false, traslado: null });
    } finally {
      cfg.exigirTrasladoGuias = true;
    }
  });

  let idPendiente = '';
  let folioPendiente = 0;

  it('guía con datos diferidos queda trasladoPendiente y se lista', async () => {
    const r = await http().post(`${base}/documentos`).send(guia(tercerizada())).expect(201);
    expect(r.body.trasladoPendiente).toBe(true);
    idPendiente = r.body.id as string;
    folioPendiente = r.body.folio as number;

    const lista = await http().get(`${base}/documentos?trasladoPendiente=true`).expect(200);
    expect(lista.body.datos.map((d: { id: string }) => d.id)).toEqual([idPendiente]);
    const todas = await http().get(`${base}/documentos`).expect(200);
    expect(todas.body.datos.length).toBeGreaterThanOrEqual(2);

    const xml = await http().get(`/v1/documentos/${idPendiente}/xml`).buffer(true).parse(binario).expect(200);
    const texto = desdeIso88591(xml.body as Buffer);
    expect(texto).toContain('<Patente>Diferido</Patente>');
    expect(validarXsd(texto, 'DTE')).toEqual({ valido: true, errores: [] });
  });

  it('factura con retiro del comprador no lleva transporte', async () => {
    const r = await http()
      .post(`${base}/documentos`)
      .send({ idDoc: { tipoDte: 33 }, receptor, detalle: [{ nombre: 'Servicio', cantidad: 1, precioUnitario: 1000 }], traslado: { retiroComprador: true } })
      .expect(201);
    expect(r.body.traslado.retiroComprador).toBe(true);
    expect(r.body.trasladoPendiente).toBe(false);
  });

  it('complementar: guía posterior que referencia a la original; la original deja de estar pendiente', async () => {
    const r = await http()
      .post(`/v1/documentos/${idPendiente}/complementar-traslado`)
      .set('Idempotency-Key', 'compl-1')
      .send({
        traslado: {
          transportista: { rut: dv('76543210') },
          chofer: { rut: dv('11222333'), nombre: 'Juan Pérez Soto' },
          patente: 'bcdf12',
          fechaSalida: '2026-11-23',
        },
      })
      .expect(201);
    expect(r.body.modalidad).toBe('guia_posterior');
    expect(r.body.documento).toMatchObject({ tipoDte: 52, trasladoPendiente: false });
    expect(r.body.original).toMatchObject({ id: idPendiente, trasladoPendiente: false });
    expect(r.body.original.traslado.complementadoPor.folio).toBe(r.body.documento.folio);

    const xml = await http().get(`/v1/documentos/${r.body.documento.id}/xml`).buffer(true).parse(binario).expect(200);
    const texto = desdeIso88591(xml.body as Buffer);
    expect(texto).toContain(`<FolioRef>${folioPendiente}</FolioRef>`);
    expect(texto).toContain('<TpoDocRef>52</TpoDocRef>');
    expect(texto).toContain('<IndTraslado>1</IndTraslado>');
    expect(texto).toContain('<Patente>BCDF12</Patente>');
    expect(validarXsd(texto, 'DTE')).toEqual({ valido: true, errores: [] });

    const repetida = await http()
      .post(`/v1/documentos/${idPendiente}/complementar-traslado`)
      .set('Idempotency-Key', 'compl-1')
      .send({
        traslado: {
          transportista: { rut: dv('76543210') },
          chofer: { rut: dv('11222333'), nombre: 'Juan Pérez Soto' },
          patente: 'bcdf12',
          fechaSalida: '2026-11-23',
        },
      })
      .expect(200);
    expect(repetida.headers['idempotent-replayed']).toBe('true');
    expect(repetida.body.documento.id).toBe(r.body.documento.id);

    const pendientes = await http().get(`${base}/documentos?trasladoPendiente=true`).expect(200);
    expect(pendientes.body.datos).toEqual([]);

    const otra = await http()
      .post(`/v1/documentos/${idPendiente}/complementar-traslado`)
      .send({ traslado: { patente: 'AB1234' } })
      .expect(409);
    expect(otra.body.code).toBe('TRASLADO_YA_COMPLEMENTADO');
  });

  it('GDT pedida sin PERMITIR_INDTRASLADO_RES144: guía posterior con advertencia; en factura, 422', async () => {
    const g = await http().post(`${base}/documentos`).send(guia(tercerizada())).expect(201);
    const r = await http()
      .post(`/v1/documentos/${g.body.id}/complementar-traslado`)
      .send({ modalidad: 'gdt', traslado: { patente: 'AB1234', diferido: ['transportista', 'choferRut', 'choferNombre', 'fechaSalida'] } })
      .expect(201);
    expect(r.body.modalidad).toBe('guia_posterior');
    expect(r.body.advertencia).toContain('IndTraslado 10');
    expect(r.body.documento.trasladoPendiente).toBe(true);

    const f = await http()
      .post(`${base}/documentos`)
      .send({ idDoc: { tipoDte: 33 }, receptor, detalle: [{ nombre: 'Flete', cantidad: 1, precioUnitario: 1000 }], traslado: tercerizada() })
      .expect(201);
    const rf = await http()
      .post(`/v1/documentos/${f.body.id}/complementar-traslado`)
      .send({ modalidad: 'gdt', traslado: { patente: 'AB1234' } })
      .expect(422);
    expect(rf.body.errors[0].campo).toBe('modalidad');
  });
});
