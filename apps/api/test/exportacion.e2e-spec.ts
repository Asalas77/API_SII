import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { calcularDv, desdeIso88591, validarXsd, verificarFirmaXml } from '../src/dte-core/index.js';
import { generarPfxPrueba } from '../src/dte-core/testing/testing.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { EnvioDocumento } from '../src/envios/entities/envio-documento.entity.js';
import { Envio } from '../src/envios/entities/envio.entity.js';
import { Caf } from '../src/folios/entities/caf.entity.js';
import { Libro } from '../src/libros/entities/libro.entity.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();

const PASSWORD = 'clave-de-prueba';
const periodo = new Date().toISOString().slice(0, 7);

// Requiere Postgres con las migraciones aplicadas (se omite en ~1 s si no responde).
describe.skipIf(!hayDb)('Documentos de exportación 110, 111 y 112 (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sii = crearSiiSimulado();
  const rut = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rut.texto}`;
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);

  const aduana = {
    codigoModalidadVenta: 1,
    codigoClausulaVenta: 5,
    totalClausulaVenta: 7192.83,
    codigoViaTransporte: 1,
    nombreTransporte: 'MN MAERSK LIMA',
    codigoPuertoEmbarque: 905,
    codigoPuertoDesembarque: 134,
    totalBultos: 151,
    bultos: [{ codigoTipo: 10, cantidad: 151, marcas: 'ACME NY' }],
    montoFlete: 450,
    codigoPaisReceptor: 225,
    codigoPaisDestino: 225,
  };
  const exportacion = (extra: Record<string, unknown> = {}) => ({
    moneda: 'DOLAR USA',
    tipoCambio: 925.4567,
    formaPagoExportacion: 11,
    extranjero: { numId: 'US-12-3456789', nacionalidad: 225 },
    aduana,
    ...extra,
  });
  const facturaExp = (extra: Record<string, unknown> = {}) => ({
    idDoc: { tipoDte: 110, formaPago: 2 },
    receptor: { razonSocial: 'ACME IMPORT INC', giro: 'Importaciones', direccion: '350 Fifth Avenue, New York' },
    detalle: [
      { nombre: 'Vino Cabernet Sauvignon caja 6 botellas', cantidad: 100, precioUnitario: 45.5, unidad: 'CJ' },
      { nombre: 'Vino Carmenere caja 6 botellas', cantidad: 50.5, precioUnitario: 52.3333, unidad: 'CJ' },
    ],
    referencias: [{ tipoDocRef: '807', folioRef: '2026-123456-7', razonRef: 'DUS' }],
    exportacion: exportacion(),
    ...extra,
  });

  const descargar = async (url: string): Promise<Buffer> =>
    (
      await http()
        .get(url)
        .buffer(true)
        .parse((res, cb) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => cb(null, Buffer.concat(trozos)));
        })
        .expect(200)
    ).body as Buffer;

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
    const e = await ds.getRepository(Empresa).findOne({ where: { rut: rut.numero } });
    if (e) {
      const envios = await ds.getRepository(Envio).find({ where: { empresaId: e.id } });
      for (const v of envios) await ds.getRepository(EnvioDocumento).delete({ envioId: v.id });
      await ds.getRepository(Envio).delete({ empresaId: e.id });
      await ds.getRepository(Libro).delete({ empresaId: e.id });
      await ds.getRepository(Documento).delete({ empresaId: e.id });
      await ds.getRepository(Caf).delete({ empresaId: e.id });
      await ds.getRepository(Certificado).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    await app.close();
    await ds.destroy();
  });

  it('prepara empresa, certificado y CAF 110 y 112 (la carga de CAF admite los tipos de exportación)', async () => {
    await http()
      .post('/v1/empresas')
      .send({
        rut: rut.texto,
        razonSocial: 'EXPORTADORA E2E SPA',
        giro: 'Exportación de vinos',
        actecos: [110212],
        direccion: 'Av. Providencia 1234',
        comuna: 'Providencia',
        ciudad: 'Santiago',
      })
      .expect(201);
    await http().patch(base).send({ nroResolucionSii: 0, fechaResolucionSii: '2026-01-15' }).expect(200);
    const pfx = generarPfxPrueba(PASSWORD, { rut: '12345678-5', nombre: 'Firmante E2E' });
    await http().post(`${base}/certificados`).attach('archivo', pfx, 'cert.pfx').field('password', PASSWORD).expect(201);
    for (const tipo of [33, 110, 112]) {
      const r = await http()
        .post(`${base}/cafs`)
        .attach('archivo', Buffer.from(generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 20, rutEmisor: rut.texto })), 'caf.xml')
        .expect(201);
      expect(r.body).toMatchObject({ tipoDte: tipo, disponibles: 20 });
    }
    const f = await http().get(`${base}/folios?tipoDte=110`).expect(200);
    expect(f.body.datos[0]).toMatchObject({ tipoDte: 110, folioSiguiente: 1 });
  });

  let id110 = '';
  let id112 = '';

  it('emite una factura de exportación en dólares (idempotente) con montos en moneda y en pesos', async () => {
    const a = await http().post(`${base}/documentos`).set('Idempotency-Key', 'exp-1').send(facturaExp()).expect(201);
    expect(a.body).toMatchObject({
      tipoDte: 110,
      folio: 1,
      estado: 'emitido',
      totales: {
        montoNeto: 0,
        montoExento: 6656654,
        iva: 0,
        montoTotal: 6656654,
        moneda: 'DOLAR USA',
        tipoCambio: 925.4567,
        montoMoneda: 7192.8317,
      },
    });
    id110 = a.body.id as string;
    const repetida = await http().post(`${base}/documentos`).set('Idempotency-Key', 'exp-1').send(facturaExp()).expect(200);
    expect(repetida.body.id).toBe(id110);
    const fila = await ds.getRepository(Documento).findOneByOrFail({ id: id110 });
    expect(fila).toMatchObject({ rutReceptor: 55555555, dvReceptor: '5', moneda: 'DOLAR USA', tipoCambio: 925.4567, montoMoneda: 7192.8317 });
    expect(fila.ted).toContain('<MNT>6656654</MNT>');
  });

  it('descarga el XML válido contra el XSD y con Exportaciones; el PDF incluye el documento', async () => {
    const xml = desdeIso88591(await descargar(`/v1/documentos/${id110}/xml`));
    expect(xml).toContain('<Exportaciones ID="F1T110">');
    expect(xml).toContain('<RUTRecep>55555555-5</RUTRecep>');
    expect(validarXsd(xml, 'DTE')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
    const pdf = await descargar(`/v1/documentos/${id110}/pdf?cedible=true`);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('errores de negocio con mensaje en español y campo exacto (sin consumir folio)', async () => {
    const sinAduana = await http().post(`${base}/documentos`).send(facturaExp({ exportacion: exportacion({ aduana: undefined }) })).expect(422);
    expect(sinAduana.body.code).toBe('DOCUMENTO_INVALIDO');
    expect(sinAduana.body.errors[0].campo).toBe('exportacion.aduana');
    const pesos = await http().post(`${base}/documentos`).send(facturaExp({ exportacion: exportacion({ moneda: 'PESO CL' }) })).expect(422);
    expect(pesos.body.errors[0].campo).toBe('exportacion.moneda');
    const rutMalo = await http()
      .post(`${base}/documentos`)
      .send(facturaExp({ receptor: { rut: '12345678-5', razonSocial: 'X', direccion: 'Y' } }))
      .expect(422);
    expect(rutMalo.body.errors[0].campo).toBe('receptor.rut');
    const sinBloque = await http().post(`${base}/documentos`).send(facturaExp({ exportacion: undefined })).expect(422);
    expect(sinBloque.body.errors[0].campo).toBe('exportacion');
    const enOtroTipo = await http()
      .post(`${base}/documentos`)
      .send({ ...facturaExp(), idDoc: { tipoDte: 33 }, receptor: { rut: '12345678-5', razonSocial: 'X' } })
      .expect(422);
    expect(enOtroTipo.body.errors[0].campo).toBe('exportacion');
    const folios = await http().get(`${base}/folios?tipoDte=110`).expect(200);
    expect(folios.body.datos[0]).toMatchObject({ folioSiguiente: 2 });
  });

  it('emite la nota de crédito de exportación 112 que referencia la factura 110', async () => {
    const sinRef = await http()
      .post(`${base}/documentos`)
      .send({
        idDoc: { tipoDte: 112 },
        receptor: facturaExp().receptor,
        detalle: [{ nombre: 'Devolución parcial', cantidad: 10, precioUnitario: 45.5 }],
        exportacion: exportacion({ aduana: undefined }),
      })
      .expect(422);
    expect(sinRef.body.errors[0].campo).toBe('referencias');

    const r = await http()
      .post(`${base}/documentos`)
      .send({
        idDoc: { tipoDte: 112 },
        receptor: facturaExp().receptor,
        detalle: [{ nombre: 'Devolución parcial', cantidad: 10, precioUnitario: 45.5 }],
        referencias: [{ tipoDocRef: '110', folioRef: 1, fechaRef: new Date().toISOString().slice(0, 10), codRef: 3, razonRef: 'Devolución parcial' }],
        exportacion: exportacion({ aduana: undefined }),
      })
      .expect(201);
    expect(r.body).toMatchObject({ tipoDte: 112, folio: 1, totales: { montoMoneda: 455, montoTotal: 421083 } });
    id112 = r.body.id as string;
  });

  it('envía 110 y 112 en un solo EnvioDTE y consulta el estado con RUT 55555555-5 y el monto en pesos', async () => {
    const e = await http().post(`${base}/envios`).send({ documentoIds: [id110, id112] }).expect(201);
    expect(e.body.envios).toHaveLength(1);
    expect(e.body.envios[0]).toMatchObject({ canal: 'dte', estado: 'REC' });
    const subidas = sii.llamadas.filter((l) => l.url.includes('DTEUpload'));
    expect(subidas.length).toBeGreaterThan(0);
    expect((await ds.getRepository(Documento).findOneByOrFail({ id: id110 })).estado).toBe('enviado');

    const antes = sii.llamadas.length;
    const c = await http().post(`/v1/documentos/${id110}/consultar-estado`).expect(200);
    expect(c.body).toMatchObject({ estadoSii: 'DOK', documento: { estado: 'aceptado' } });
    const soap = String(sii.llamadas.slice(antes).find((l) => l.url.endsWith('/QueryEstDte.jws'))?.body);
    expect(soap).toContain('<RutReceptor>55555555</RutReceptor><DvReceptor>5</DvReceptor>');
    expect(soap).toContain('<TipoDte>110</TipoDte><FolioDte>1</FolioDte>');
    expect(soap).toContain('<MontoDte>6656654</MontoDte>');
  });

  it('libro de ventas con 110 y 112 (pesos, receptor extranjero) válido contra el XSD', async () => {
    const r = await http().post(`${base}/libros/ventas`).send({ periodo, tipoLibro: 'ESPECIAL', tipoEnvio: 'TOTAL', folioNotificacion: 1 }).expect(201);
    const tipos = Object.fromEntries((r.body.resumen as Array<{ tipoDoc: number }>).map((t) => [t.tipoDoc, t])) as Record<number, Record<string, number>>;
    expect(Object.keys(tipos).map(Number)).toEqual([110, 112]);
    expect(tipos[110]).toMatchObject({ cantidad: 1, montoExento: 6656654, montoNeto: 0, montoIva: 0, montoTotal: 6656654 });
    expect(tipos[112]).toMatchObject({ cantidad: 1, montoExento: 421083, montoTotal: 421083 });
    const xml = desdeIso88591(await descargar(`/v1/libros/${r.body.id}/xml`));
    expect(validarXsd(xml, 'LibroCV')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
    expect(xml).toContain('<TpoDoc>110</TpoDoc>');
    expect(xml).toContain('<RUTDoc>55555555-5</RUTDoc>');
    expect(xml).toContain('<Extranjero><NumId>US-12-3456789</NumId><Nacionalidad>225</Nacionalidad></Extranjero>');
  });
});
