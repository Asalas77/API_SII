import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
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
import { Caf } from '../src/folios/entities/caf.entity.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** PNG RGB de un solo color (sirve de logo visible en el PDF de muestra). */
function pngSolido(ancho: number, alto: number, [r, g, b]: [number, number, number]): Buffer {
  const trozo = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  const fila = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: ancho }, () => [r, g, b]).flat())]);
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    PNG_1X1.subarray(0, 8),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = pngSolido(240, 90, [30, 90, 160]);

/** Texto de los operadores Tj/TJ de todos los streams comprimidos del PDF (una línea por operador). */
function textoDelPdf(pdf: Buffer): string {
  const latin = pdf.toString('latin1');
  const lineas: string[] = [];
  for (const m of latin.matchAll(/stream\r?\n/g)) {
    const ini = (m.index ?? 0) + m[0].length;
    const fin = latin.indexOf('endstream', ini);
    let contenido: string;
    try {
      contenido = inflateSync(pdf.subarray(ini, fin)).toString('latin1');
    } catch {
      continue;
    }
    for (const op of contenido.matchAll(/(\[[^\]]*\])\s*TJ|(<[0-9a-fA-F]*>)\s*Tj/g)) {
      const trozos = (op[1] ?? op[2] ?? '').match(/<([0-9a-fA-F]*)>/g) ?? [];
      lineas.push(trozos.map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join(''));
    }
  }
  return lineas.join('\n');
}

function imagenes(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
}

describe.skipIf(!hayDb)('Opciones del PDF por empresa: unidad SII, URL de verificación y logo (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sii = crearSiiSimulado();
  const rut = rutAleatorio((n) => calcularDv(n));
  const rutOtra = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rut.texto}`;
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);
  const binario = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const trozos: Buffer[] = [];
    res.on('data', (t: Buffer) => trozos.push(t));
    res.on('end', () => cb(null, Buffer.concat(trozos)));
  };
  const pdfDe = async (id: string) => {
    const r = await http().get(`/v1/documentos/${id}/pdf`).buffer(true).parse(binario).expect(200);
    return r.body as Buffer;
  };

  let docId = '';
  let idKeyAjena = '';
  let claveAjena = '';

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

    const cuerpo = (r: { texto: string }) => ({
      rut: r.texto,
      razonSocial: 'EMPRESA PDF E2E SPA',
      giro: 'Servicios informáticos',
      actecos: [620200],
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      ciudad: 'Santiago',
      nroResolucionSii: 0,
      fechaResolucionSii: '2026-01-15',
    });
    await http().post('/v1/empresas').send(cuerpo(rut)).expect(201);
    await http().post('/v1/empresas').send(cuerpo(rutOtra)).expect(201);
    await http()
      .post(`${base}/certificados`)
      .attach('archivo', generarPfxPrueba('clave-de-prueba', { rut: '12345678-5', nombre: 'Firmante E2E' }), 'cert.pfx')
      .field('password', 'clave-de-prueba')
      .expect(201);
    await http()
      .post(`${base}/cafs`)
      .attach(
        'archivo',
        Buffer.from(generarCafRealista({ tipoDte: 33, folioDesde: 1, folioHasta: 10, rutEmisor: rut.texto })),
        'caf.xml',
      )
      .expect(201);
    const doc = await http()
      .post(`${base}/documentos`)
      .send({
        idDoc: { tipoDte: 33, formaPago: 1 },
        receptor: {
          rut: '12345678-5',
          razonSocial: 'CLIENTE',
          giro: 'Comercio',
          direccion: 'Calle 1',
          comuna: 'Santiago',
          ciudad: 'Santiago',
        },
        detalle: [{ nombre: 'Servicio de prueba', cantidad: 1, precioUnitario: 10000 }],
      })
      .expect(201);
    docId = doc.body.id as string;

    // Key con acceso solo a OTRA empresa, con permisos de leer y editar empresas.
    const k = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'e2e logo ajena', permisos: ['empresas.leer', 'empresas.editar'], empresas: [rutOtra.texto] })
      .expect(201);
    idKeyAjena = k.body.id as string;
    claveAjena = k.body.clave as string;
  });

  afterAll(async () => {
    if (!app) return;
    if (idKeyAjena) await ds.getRepository(ApiKey).delete({ id: idKeyAjena });
    for (const r of [rut, rutOtra]) {
      const e = await ds.getRepository(Empresa).findOne({ where: { rut: r.numero } });
      if (!e) continue;
      await ds.getRepository(Documento).delete({ empresaId: e.id });
      await ds.getRepository(Caf).delete({ empresaId: e.id });
      await ds.getRepository(Certificado).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    await app.close();
    await ds.destroy();
  });

  it('por defecto no hay unidad, URL ni logo', async () => {
    const e = await http().get(base).expect(200);
    expect(e.body).toMatchObject({ unidadSii: null, urlVerificacion: null, tieneLogo: false });
    expect(e.body.logo).toBeUndefined();
    await http().get(`${base}/logo`).expect(404);
  });

  it('valida unidad y URL (http/https, marcadores conocidos) y normaliza la unidad', async () => {
    const malo = await http().patch(base).send({ urlVerificacion: 'ftp://x.cl/{id}' }).expect(400);
    expect(malo.body.errors[0].campo).toBe('urlVerificacion');
    await http().patch(base).send({ urlVerificacion: 'https://x.cl/{inventado}' }).expect(400);
    await http().patch(base).send({ urlVerificacion: 'no es url' }).expect(400);
    await http().patch(base).send({ unidadSii: 'x'.repeat(81) }).expect(400);

    const ok = await http()
      .patch(base)
      .send({
        unidadSii: '  santiago   centro ',
        urlVerificacion: 'https://verifica.ejemplo.cl/dte/{rutEmisor}/{tipo}/{folio}?id={id}',
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      unidadSii: 'SANTIAGO CENTRO',
      urlVerificacion: 'https://verifica.ejemplo.cl/dte/{rutEmisor}/{tipo}/{folio}?id={id}',
    });
  });

  it('el PDF incluye la unidad y la URL resuelta (esta última, en la boleta térmica)', async () => {
    const pdf = await pdfDe(docId);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(textoDelPdf(pdf)).toContain('S.I.I. - SANTIAGO CENTRO');

    const termica = await http()
      .get(`/v1/documentos/${docId}/pdf?formato=termica80`)
      .buffer(true)
      .parse(binario)
      .expect(200);
    // La URL larga se parte en dos líneas en el papel de 80 mm.
    expect(textoDelPdf(termica.body as Buffer).replaceAll('\n', '')).toContain(
      `https://verifica.ejemplo.cl/dte/${rut.texto}/33/1?id=${docId}`,
    );
  });

  it('rechaza archivos que no son imagen, vacíos, sin archivo y de más de 300 KB', async () => {
    const texto = await http().put(`${base}/logo`).attach('archivo', Buffer.from('hola, no soy una imagen'), 'logo.png');
    expect(texto.status).toBe(400);
    expect(texto.headers['content-type']).toContain('application/problem+json');
    expect(texto.body.code).toBe('VALIDACION');

    await http().put(`${base}/logo`).attach('archivo', Buffer.from('GIF89a' + 'x'.repeat(50)), 'logo.gif').expect(400);
    await http().put(`${base}/logo`).attach('archivo', Buffer.alloc(0), 'vacio.png').expect(400);
    await http().put(`${base}/logo`).expect(400);

    const grande = Buffer.concat([PNG_1X1, Buffer.alloc(300 * 1024)]);
    const r = await http().put(`${base}/logo`).attach('archivo', grande, 'grande.png');
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.title).toBe('Logo demasiado grande');
    expect((await http().get(base).expect(200)).body.tieneLogo).toBe(false);
  });

  it('sube un PNG, lo devuelve con su content-type y lo imprime en el PDF', async () => {
    const sinLogo = await pdfDe(docId);
    await http().put(`${base}/logo`).attach('archivo', LOGO, 'logo.png').expect(204);

    const e = await http().get(base).expect(200);
    expect(e.body.tieneLogo).toBe(true);
    expect(e.body.logo).toBeUndefined();

    const l = await http().get(`${base}/logo`).buffer(true).parse(binario).expect(200);
    expect(l.headers['content-type']).toBe('image/png');
    expect((l.body as Buffer).equals(LOGO)).toBe(true);

    const conLogo = await pdfDe(docId);
    expect(conLogo.subarray(0, 4).toString()).toBe('%PDF');
    expect(imagenes(conLogo)).toBeGreaterThan(imagenes(sinLogo));
    expect(conLogo.length).toBeGreaterThan(sinLogo.length);
    expect(textoDelPdf(conLogo)).toContain('S.I.I. - SANTIAGO CENTRO');

    const salida = join(import.meta.dirname, 'salida-pdf');
    await mkdir(salida, { recursive: true });
    await writeFile(join(salida, 'factura-33-logo-unidad-url.pdf'), conLogo);
  });

  it('una key sin acceso a la empresa recibe 403 en el logo (lectura, escritura y borrado)', async () => {
    const ajena = () => request.agent(app.getHttpServer()).set('X-API-Key', claveAjena);
    await ajena().get(base).expect(403);
    await ajena().get(`${base}/logo`).expect(403);
    await ajena().put(`${base}/logo`).attach('archivo', PNG_1X1, 'logo.png').expect(403);
    await ajena().delete(`${base}/logo`).expect(403);
    expect((await http().get(base).expect(200)).body.tieneLogo).toBe(true);
  });

  it('un logo corrupto da un error claro y se puede corregir', async () => {
    const roto = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.from('basura')]);
    await http().put(`${base}/logo`).attach('archivo', roto, 'roto.png').expect(204);
    const r = await http().get(`/v1/documentos/${docId}/pdf`).buffer(true).parse(binario);
    expect(r.status).toBe(422);
    expect(JSON.parse((r.body as Buffer).toString()).code).toBe('LOGO_INVALIDO');
    await http().put(`${base}/logo`).attach('archivo', PNG_1X1, 'logo.png').expect(204);
    await pdfDe(docId);
  });

  it('borra el logo, la unidad y la URL con DELETE y null', async () => {
    await http().delete(`${base}/logo`).expect(204);
    await http().get(`${base}/logo`).expect(404);
    const e = await http().patch(base).send({ unidadSii: null, urlVerificacion: null }).expect(200);
    expect(e.body).toMatchObject({ unidadSii: null, urlVerificacion: null, tieneLogo: false });
    const texto = textoDelPdf(await pdfDe(docId));
    expect(texto).not.toContain('S.I.I. -');
  });
});
