import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { ApiKey } from '../src/auth/entities/api-key.entity.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import {
  calcularDv,
  construirDte,
  construirEnvioDte,
  desdeIso88591,
  parsearCaf,
  validarXsd,
  verificarFirmaXml,
} from '../src/dte-core/index.js';
import { documentoDePrueba } from '../src/dte-core/testing/documentos-prueba.js';
import { generarCertificadoPrueba, generarPfxPrueba } from '../src/dte-core/testing/testing.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { Libro } from '../src/libros/entities/libro.entity.js';
import { FABRICA_CORREO } from '../src/recepcion/correo/tipos.js';
import { BuzonCorreo } from '../src/recepcion/entities/buzon-correo.entity.js';
import { DteRecibido } from '../src/recepcion/entities/dte-recibido.entity.js';
import { EnvioRecibido } from '../src/recepcion/entities/envio-recibido.entity.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearCorreoFalso } from '../src/testing/correo-falso.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { ADMIN_KEY, configurarAdminKey } from './helpers/auth.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();

// Emisor de los DTE (lo fija `cafDePrueba`): otra empresa de prueba, que no existe en la base.
const RUT_EMISOR = '76086428-5';
const certEmisor = generarCertificadoPrueba({ rut: '11111111-1' });
// CAF con claves RSA de 512 bits como los reales: el TED cabe en el PDF417 del PDF.
const caf33 = parsearCaf(generarCafRealista({ tipoDte: 33, folioDesde: 1, folioHasta: 99_999, rutEmisor: RUT_EMISOR }));
const caf34 = parsearCaf(generarCafRealista({ tipoDte: 34, folioDesde: 1, folioHasta: 99_999, rutEmisor: RUT_EMISOR }));
const fechaFirma = new Date('2026-02-02T13:00:00Z');
const PERIODO_EMISION = '2026-02'; // `documentoDePrueba` emite con fecha 2026-02-01

const bufferBinario = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const trozos: Buffer[] = [];
  res.on('data', (t: Buffer) => trozos.push(t));
  res.on('end', () => cb(null, Buffer.concat(trozos)));
};

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

describe.skipIf(!hayDb)('Recepción de DTE de proveedores por la API /v1 (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sii = crearSiiSimulado();
  const correo = crearCorreoFalso();
  const rutA = rutAleatorio((n) => calcularDv(n)); // empresa receptora
  const rutB = rutAleatorio((n) => calcularDv(n)); // otra empresa (aislamiento)
  const base = `/v1/empresas/${rutA.texto}`;
  const idsKeys: string[] = [];
  let claveB = '';
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);
  const conClave = (clave: string) => request.agent(app.getHttpServer()).set('X-API-Key', clave);

  /** DTE firmado por el emisor de prueba, dirigido al receptor indicado. */
  function dte(tipo: 33 | 34, folio: number, receptor = rutA): string {
    const doc = documentoDePrueba(tipo, folio);
    doc.receptor = { ...doc.receptor, rut: String(receptor.numero), dv: receptor.dv };
    return construirDte(doc, { caf: tipo === 33 ? caf33 : caf34, certificado: certEmisor, fechaFirma }).xmlFirmado;
  }
  function sobre(dtes: string[], receptor = rutA): Buffer {
    return construirEnvioDte({
      dtesFirmados: dtes,
      caratula: {
        rutEmisor: '76086428',
        dvEmisor: '5',
        rutEnvia: '11111111',
        dvEnvia: '1',
        rutReceptor: receptor.texto,
        fechaResolucion: '2025-01-15',
        numeroResolucion: 80,
        fechaFirma,
      },
      certificado: certEmisor,
    }).xmlIso;
  }
  const subir = (archivo: Buffer, nombre = 'envio.xml', campos: Record<string, string> = {}) => {
    let r = http().post(`${base}/recepcion`);
    for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
    return r.attach('archivo', archivo, nombre);
  };
  const descargar = async (ruta: string): Promise<string> => {
    const r = await http().get(ruta).buffer(true).parse(bufferBinario).expect(200);
    expect(r.headers['content-type']).toContain('ISO-8859-1');
    return desdeIso88591(r.body as Buffer);
  };

  // Folios únicos por corrida (la empresa es nueva en cada una, pero así se ve en los logs de la base).
  const f1 = 101;
  const f2 = 102;
  const f3 = 103;
  const envioOk = sobre([dte(33, f1), dte(33, f2), dte(34, f3)]);
  const ids: Record<string, string> = {};
  let idEnvio = '';

  beforeAll(async () => {
    configurarAdminKey();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SII_FETCH)
      .useValue(sii.fetch)
      .overrideProvider(FABRICA_CORREO)
      .useValue(correo)
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
      await ds.getRepository(Libro).delete({ empresaId: e.id });
      await ds.getRepository(DteRecibido).delete({ empresaId: e.id });
      await ds.getRepository(EnvioRecibido).delete({ empresaId: e.id });
      await ds.getRepository(BuzonCorreo).delete({ empresaId: e.id });
      await ds.getRepository(Certificado).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    for (const id of idsKeys) await ds.getRepository(ApiKey).delete({ id });
    await app.close();
    await ds.destroy();
  });

  it('prepara las empresas, el certificado y una key de la empresa B', async () => {
    for (const r of [rutA, rutB]) {
      await http()
        .post('/v1/empresas')
        .send({
          rut: r.texto,
          razonSocial: r === rutA ? 'EMPRESA RECEPTORA SPA' : 'EMPRESA AJENA SPA',
          giro: 'Servicios informáticos',
          actecos: [620200],
          direccion: 'Av. Providencia 1234',
          comuna: 'Providencia',
          ciudad: 'Santiago',
          nroResolucionSii: 0,
          fechaResolucionSii: '2026-01-15',
          correoIntercambio: 'intercambio@receptora.cl',
        })
        .expect(201);
    }
    await http()
      .post(`${base}/certificados`)
      .attach('archivo', generarPfxPrueba('clave', { rut: '12345678-5', nombre: 'Firmante Receptor' }), 'cert.pfx')
      .field('password', 'clave')
      .expect(201);
    const k = await http()
      .post('/v1/api-keys')
      .send({
        nombre: 'Key empresa B',
        permisos: ['recepcion.recibir', 'recepcion.leer', 'recepcion.responder', 'recepcion.configurar'],
        empresas: [rutB.texto],
      })
      .expect(201);
    claveB = k.body.clave as string;
    idsKeys.push(k.body.id as string);
  });

  it('recibe un EnvioDTE válido: guarda, responde el resumen por DTE y genera un RecepcionEnvio válido', async () => {
    const r = await subir(envioOk, 'envio_proveedor.xml').expect(201);
    expect(r.body).toMatchObject({
      origen: 'upload',
      nombreArchivo: 'envio_proveedor.xml',
      estadoRecepcion: 0,
      glosa: 'Envio Recibido Conforme',
      rutEmisor: RUT_EMISOR,
      repetido: false,
    });
    expect(r.body.hashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.dtes).toHaveLength(3);
    for (const d of r.body.dtes as Array<Record<string, unknown>>) {
      expect(d.estado).toBe(0);
      expect(typeof d.dteRecibidoId).toBe('string');
      expect(new Date(d.plazoReclamoHasta as string).getTime()).toBeGreaterThan(Date.now() + 7.9 * 86400_000);
    }
    expect((r.body.dtes as Array<{ folio: number }>).map((d) => d.folio)).toEqual([f1, f2, f3]);
    idEnvio = r.body.id as string;
    for (const d of r.body.dtes as Array<{ folio: number; dteRecibidoId: string }>) ids[`f${d.folio}`] = d.dteRecibidoId;

    const acuse = await descargar(`/v1/envios-recibidos/${idEnvio}/recepcion-envio`);
    expect(validarXsd(acuse, 'RespuestaEnvioDTE')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(acuse)).toEqual({ valida: true, errores: [] });
    expect(acuse).toContain(`<RutResponde>${rutA.texto}</RutResponde><RutRecibe>${RUT_EMISOR}</RutRecibe>`);
    expect(acuse).toContain('<EstadoRecepEnv>0</EstadoRecepEnv>');
    expect((acuse.match(/<EstadoRecepDTE>0<\/EstadoRecepDTE>/g) ?? []).length).toBe(3);
    expect(acuse).toContain('<MailContacto>intercambio@receptora.cl</MailContacto>');
  });

  it('guarda el XML original tal cual llegó (byte a byte)', async () => {
    const r = await http().get(`/v1/envios-recibidos/${idEnvio}/xml`).buffer(true).parse(bufferBinario).expect(200);
    expect(Buffer.compare(r.body as Buffer, envioOk)).toBe(0);
  });

  it('el mismo archivo otra vez: 200 con el resultado previo y sin duplicar', async () => {
    const r = await subir(envioOk, 'reenvio.xml').expect(200);
    expect(r.body).toMatchObject({ id: idEnvio, repetido: true, estadoRecepcion: 0 });
    expect(r.body.dtes).toHaveLength(3);
    const lista = await http().get(`${base}/envios-recibidos`).expect(200);
    expect(lista.body.paginacion.total).toBe(1);
    const dtes = await http().get(`${base}/dte-recibidos`).expect(200);
    expect(dtes.body.paginacion.total).toBe(3);
  });

  it('otro sobre con los mismos DTE (archivo distinto): se recibe pero cada DTE queda como repetido (4)', async () => {
    const r = await subir(sobre([dte(33, f1)]), 'otro.xml').expect(201);
    expect(r.body.estadoRecepcion).toBe(0);
    expect(r.body.dtes).toMatchObject([{ folio: f1, estado: 4, dteRecibidoId: null, plazoReclamoHasta: null }]);
    const acuse = await descargar(`/v1/envios-recibidos/${r.body.id}/recepcion-envio`);
    expect(acuse).toContain('<EstadoRecepDTE>4</EstadoRecepDTE>');
    expect(validarXsd(acuse, 'RespuestaEnvioDTE').valido).toBe(true);
    expect((await http().get(`${base}/dte-recibidos`).expect(200)).body.paginacion.total).toBe(3);
  });

  it('un segundo sobre del mismo emisor con el mismo SetDoc se acepta (no se deduplica por ID del set)', async () => {
    const r = await subir(sobre([dte(33, 104)]), 'segundo.xml').expect(201);
    expect(r.body.estadoRecepcion).toBe(0);
    expect(r.body.dtes[0]).toMatchObject({ folio: 104, estado: 0 });
    ids.f104 = r.body.dtes[0].dteRecibidoId as string;
  });

  it('sobre con la firma alterada: rechazado con estado 2, sin guardar DTE, con acuse válido', async () => {
    const texto = desdeIso88591(sobre([dte(33, 201)]));
    const i = texto.lastIndexOf('<SignatureValue>') + '<SignatureValue>'.length;
    const alterado = Buffer.from(texto.slice(0, i) + (texto[i] === 'A' ? 'B' : 'A') + texto.slice(i + 1), 'latin1');
    const r = await subir(alterado, 'firma_mala.xml').expect(201);
    expect(r.body.estadoRecepcion).toBe(2);
    expect(r.body.glosa).toContain('Error de Firma');
    expect(r.body.dtes.every((d: { dteRecibidoId: string | null }) => d.dteRecibidoId === null)).toBe(true);
    const acuse = await descargar(`/v1/envios-recibidos/${r.body.id}/recepcion-envio`);
    expect(acuse).toContain('<EstadoRecepEnv>2</EstadoRecepEnv>');
    expect(validarXsd(acuse, 'RespuestaEnvioDTE').valido).toBe(true);
    const dtes = await http().get(`${base}/dte-recibidos?porPagina=200`).expect(200);
    expect((dtes.body.datos as Array<{ folio: number }>).some((d) => d.folio === 201)).toBe(false);
  });

  it('sobre dirigido a otra empresa: se registra como rechazado (3) y se informa', async () => {
    const r = await subir(sobre([dte(33, 301, rutB)], rutB), 'para_otro.xml').expect(201);
    expect(r.body.estadoRecepcion).toBe(3);
    expect(r.body.glosa).toContain('RUT Receptor No Corresponde');
    expect(r.body.dtes.every((d: { dteRecibidoId: string | null }) => d.dteRecibidoId === null)).toBe(true);
    const acuse = await descargar(`/v1/envios-recibidos/${r.body.id}/recepcion-envio`);
    expect(acuse).toContain('<EstadoRecepEnv>3</EstadoRecepEnv>');
    expect(validarXsd(acuse, 'RespuestaEnvioDTE').valido).toBe(true);
    // No aparece entre los DTE recibidos de la empresa B (se guardó para A, que lo recibió por error).
    const deB = await conClave(claveB).get(`/v1/empresas/${rutB.texto}/dte-recibidos`).expect(200);
    expect(deB.body.paginacion.total).toBe(0);
  });

  it('un archivo que no es XML: ilegible (91), sin acuse, y no se pierde', async () => {
    const r = await subir(Buffer.from('esto no es xml'), 'basura.txt').expect(201);
    expect(r.body.estadoRecepcion).toBe(91);
    expect(r.body.enlaces.recepcionEnvio).toBeNull();
    await http().get(`/v1/envios-recibidos/${r.body.id}/recepcion-envio`).expect(404);
  });

  it('sin archivo: 400; archivo mayor a 5 MB: 413', async () => {
    await http().post(`${base}/recepcion`).field('remitente', 'a@b.cl').expect(400);
    const r = await subir(Buffer.alloc(5 * 1024 * 1024 + 10, 0x20), 'grande.xml');
    expect(r.status).toBe(413);
  });

  it('lista con filtros y paginación; detalle, XML (idéntico al del sobre) y PDF', async () => {
    const todos = await http().get(`${base}/dte-recibidos?porPagina=2&pagina=1`).expect(200);
    expect(todos.body.paginacion).toMatchObject({ pagina: 1, porPagina: 2, total: 4, paginas: 2 });
    expect(todos.body.datos).toHaveLength(2);
    const filtrados = await http()
      .get(`${base}/dte-recibidos?periodo=${PERIODO_EMISION}&estado=pendiente&rutEmisor=${RUT_EMISOR}`)
      .expect(200);
    expect(filtrados.body.paginacion.total).toBe(4);
    expect(filtrados.body.datos[0]).toMatchObject({ rutEmisor: RUT_EMISOR, estadoComercial: 'pendiente', plazoVencido: false });
    const otroPeriodo = await http().get(`${base}/dte-recibidos?periodo=2025-01`).expect(200);
    expect(otroPeriodo.body.paginacion.total).toBe(0);
    await http().get(`${base}/dte-recibidos?periodo=2026-13`).expect(400);

    const d = await http().get(`/v1/dte-recibidos/${ids[`f${f1}`]}`).expect(200);
    expect(d.body).toMatchObject({
      tipoDte: 33,
      folio: f1,
      rutEmisor: RUT_EMISOR,
      razonSocialEmisor: 'EMPRESA DE PRUEBA SPA',
      fechaEmision: '2026-02-01',
      montoNeto: 1000,
      iva: 190,
      montoTotal: 1190,
      estadoRecepcionDte: 0,
      estadoComercial: 'pendiente',
      plazoConfirmadoSii: false,
      acuseReciboMercaderias: false,
    });
    const xml = await descargar(`/v1/dte-recibidos/${ids[`f${f1}`]}/xml`);
    expect(xml).toContain('<Folio>101</Folio>');
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] }); // el DTE individual sigue verificando
    const pdf = await http().get(`/v1/dte-recibidos/${ids[`f${f1}`]}/pdf`).buffer(true).parse(bufferBinario).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('aislamiento: la key de otra empresa recibe 403 en rutas de A y 404 en sus recursos', async () => {
    const b = conClave(claveB);
    await b.post(`${base}/recepcion`).attach('archivo', envioOk, 'x.xml').expect(403);
    await b.get(`${base}/dte-recibidos`).expect(403);
    await b.get(`${base}/envios-recibidos`).expect(403);
    await b.get(`${base}/buzon-correo`).expect(403);
    await b.get(`/v1/dte-recibidos/${ids[`f${f1}`]}`).expect(404);
    await b.get(`/v1/dte-recibidos/${ids[`f${f1}`]}/xml`).expect(404);
    await b.get(`/v1/dte-recibidos/${ids[`f${f1}`]}/pdf`).expect(404);
    await b.post(`/v1/dte-recibidos/${ids[`f${f1}`]}/aceptar`).send({}).expect(404);
    await b.post(`/v1/dte-recibidos/${ids[`f${f1}`]}/registrar-sii`).send({ accion: 'ACD' }).expect(404);
    await b.get(`/v1/envios-recibidos/${idEnvio}`).expect(404);
    await b.get(`/v1/envios-recibidos/${idEnvio}/xml`).expect(404);
    await b.get('/v1/dte-recibidos/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('una key sin el permiso adecuado recibe 403', async () => {
    const k = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'Solo lectura', permisos: ['recepcion.leer'], empresas: [rutA.texto] })
      .expect(201);
    idsKeys.push(k.body.id as string);
    const sl = conClave(k.body.clave as string);
    await sl.get(`${base}/dte-recibidos`).expect(200);
    await sl.post(`${base}/recepcion`).attach('archivo', envioOk, 'x.xml').expect(403);
    await sl.post(`/v1/dte-recibidos/${ids[`f${f1}`]}/aceptar`).send({}).expect(403);
    await sl.put(`${base}/buzon-correo`).send({ imapHost: 'imap.x.cl', usuario: 'u', password: 'p' }).expect(403);
  });

  it('aceptar: genera un ResultadoDTE válido y firmado; no se puede responder dos veces', async () => {
    const r = await http().post(`/v1/dte-recibidos/${ids[`f${f1}`]}/aceptar`).send({}).expect(200);
    expect(r.body.dte).toMatchObject({ estadoComercial: 'aceptado' });
    expect(r.body.respuesta.tipo).toBe('ResultadoDTE');
    expect(r.body.correo).toMatchObject({ solicitado: false, enviado: false });
    const xml = await descargar(`/v1/dte-recibidos/${ids[`f${f1}`]}/resultado-dte`);
    expect(validarXsd(xml, 'RespuestaEnvioDTE')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
    expect(xml).toContain(`<RutResponde>${rutA.texto}</RutResponde><RutRecibe>${RUT_EMISOR}</RutRecibe>`);
    expect(xml).toContain(`<TipoDTE>33</TipoDTE><Folio>${f1}</Folio>`);
    expect(xml).toContain('<EstadoDTE>0</EstadoDTE>');
    await http().post(`/v1/dte-recibidos/${ids[`f${f1}`]}/aceptar`).send({}).expect(409);
    await http().post(`/v1/dte-recibidos/${ids[`f${f1}`]}/rechazar`).send({ glosa: 'tarde' }).expect(409);
  });

  it('aceptar con reparos exige glosa y emite EstadoDTE 1', async () => {
    await http().post(`/v1/dte-recibidos/${ids[`f${f3}`]}/aceptar`).send({ reparos: true }).expect(400);
    const r = await http()
      .post(`/v1/dte-recibidos/${ids[`f${f3}`]}/aceptar`)
      .send({ reparos: true, glosa: 'Descripción distinta a la pedida' })
      .expect(200);
    expect(r.body.dte).toMatchObject({ estadoComercial: 'aceptado_con_reparos', glosa: 'Descripción distinta a la pedida' });
    const xml = await descargar(`/v1/dte-recibidos/${ids[`f${f3}`]}/resultado-dte`);
    expect(validarXsd(xml, 'RespuestaEnvioDTE').valido).toBe(true);
    expect(xml).toContain('<EstadoDTE>1</EstadoDTE>');
  });

  it('rechazar: exige glosa, emite EstadoDTE 2 con el código de rechazo y bloquea el recibo de mercaderías', async () => {
    await http().post(`/v1/dte-recibidos/${ids[`f${f2}`]}/rechazar`).send({}).expect(400);
    await http().post(`/v1/dte-recibidos/${ids[`f${f2}`]}/rechazar`).send({ glosa: 'x', codigoRechazo: 5 }).expect(400);
    const r = await http()
      .post(`/v1/dte-recibidos/${ids[`f${f2}`]}/rechazar`)
      .send({ glosa: 'Mercadería no solicitada', codigoRechazo: -101 })
      .expect(200);
    expect(r.body.dte).toMatchObject({ estadoComercial: 'rechazado', glosa: 'Mercadería no solicitada' });
    const xml = await descargar(`/v1/dte-recibidos/${ids[`f${f2}`]}/resultado-dte`);
    expect(validarXsd(xml, 'RespuestaEnvioDTE').valido).toBe(true);
    expect(verificarFirmaXml(xml).valida).toBe(true);
    expect(xml).toContain('<EstadoDTE>2</EstadoDTE>');
    expect(xml).toContain('<CodRchDsc>-101</CodRchDsc>');
    await http()
      .post(`/v1/dte-recibidos/${ids[`f${f2}`]}/recibo-mercaderias`)
      .send({ recinto: 'Bodega central', rutFirma: '12345678-5' })
      .expect(409);
  });

  it('recibo de mercaderías: EnvioRecibos válido y firmado (Ley 19.983); una sola vez', async () => {
    const id = ids[`f${f1}`];
    await http().post(`/v1/dte-recibidos/${id}/recibo-mercaderias`).send({ recinto: 'Bodega' }).expect(400);
    const r = await http()
      .post(`/v1/dte-recibidos/${id}/recibo-mercaderias`)
      .send({ recinto: 'Bodega central, Santiago', rutFirma: '12345678-5' })
      .expect(200);
    expect(r.body.dte.acuseReciboMercaderias).toBe(true);
    expect(r.body.respuesta.tipo).toBe('EnvioRecibos');
    const xml = await descargar(`/v1/dte-recibidos/${id}/envio-recibos`);
    expect(validarXsd(xml, 'EnvioRecibos')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
    expect(xml).toContain('<Recinto>Bodega central, Santiago</Recinto><RutFirma>12345678-5</RutFirma>');
    expect(xml).toContain(`<RutResponde>${rutA.texto}</RutResponde><RutRecibe>${RUT_EMISOR}</RutRecibe>`);
    await http().post(`/v1/dte-recibidos/${id}/recibo-mercaderias`).send({ recinto: 'Otra', rutFirma: '12345678-5' }).expect(409);
  });

  describe('registro ante el SII (WS RegistroReclamoDTE simulado)', () => {
    it('ACD: se registra, queda en registro_sii y reintentarlo responde 409 (evento previo)', async () => {
      const id = ids[`f${f1}`];
      const r = await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ACD' }).expect(200);
      expect(r.body).toMatchObject({ accion: 'ACD', sii: { codigo: 0 } });
      expect(r.body.dte.registroSii.acciones).toMatchObject([{ accion: 'ACD', codigo: 0, exito: true }]);
      const llamada = sii.llamadas.filter((l) => l.url.includes('WSREGISTRORECLAMODTECERT')).at(-1);
      expect(llamada?.url).toBe('https://ws2.sii.cl/WSREGISTRORECLAMODTECERT/registroreclamodteservice');
      expect(String(llamada?.body)).toContain(`<folio>${f1}</folio><accionDoc>ACD</accionDoc>`);
      const otra = await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ACD' }).expect(409);
      expect(otra.body.code).toBe('SII_REGISTRO_CONFLICTO');
    });

    it('ERM tras ACD se acepta; un reclamo tras ERM se rechaza (409)', async () => {
      const id = ids[`f${f1}`];
      const r = await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ERM' }).expect(200);
      expect(r.body.dte.acuseReciboMercaderias).toBe(true);
      await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'RCD' }).expect(409);
      const d = await http().get(`/v1/dte-recibidos/${id}`).expect(200);
      expect(d.body.registroSii.acciones.map((a: { accion: string; exito: boolean }) => `${a.accion}:${a.exito}`)).toEqual([
        'ACD:true',
        'ACD:false',
        'ERM:true',
        'RCD:false',
      ]);
    });

    it('valida la acción y el tipo de documento', async () => {
      await http().post(`/v1/dte-recibidos/${ids[`f${f3}`]}/registrar-sii`).send({ accion: 'XXX' }).expect(400);
      await http().post(`/v1/dte-recibidos/${ids[`f${f3}`]}/registrar-sii`).send({}).expect(400);
    });

    it('consultar-sii: eventos, fecha de recepción y cedibilidad; la fecha real recalcula el plazo', async () => {
      const id = ids[`f${f1}`];
      const recepcionReal = new Date(Date.now() - 3 * 86400_000);
      sii.fechaRecepcionReclamo[`33-${f1}`] = ddmmyyyy(new Date(recepcionReal.getTime() - 3 * 3600_000));
      const r = await http().post(`/v1/dte-recibidos/${id}/consultar-sii`).expect(200);
      expect(r.body.plazoActualizado).toBe(true);
      expect(r.body.sii.eventos.eventos.map((e: { codigo: string }) => e.codigo)).toEqual(['ACD', 'ERM']);
      expect(r.body.sii.cedible).toMatchObject({ codigo: 23, cedible: true });
      expect(r.body.dte.plazoConfirmadoSii).toBe(true);
      const plazo = new Date(r.body.dte.plazoReclamoHasta as string).getTime();
      // Hora de Chile (±1 h por el cambio de horario): alrededor de recepción real + 8 días.
      expect(Math.abs(plazo - (recepcionReal.getTime() + 8 * 86400_000))).toBeLessThan(5 * 3600_000);
      expect(r.body.dte.registroSii.eventos).toHaveLength(2);
    });

    it('plazo vencido: con la fecha real de hace más de 8 días no se registra y responde 422 sin llamar al SII', async () => {
      const id = ids.f104;
      sii.fechaRecepcionReclamo['33-104'] = ddmmyyyy(new Date(Date.now() - 10 * 86400_000));
      const c = await http().post(`/v1/dte-recibidos/${id}/consultar-sii`).expect(200);
      expect(c.body.dte).toMatchObject({ plazoVencido: true, plazoConfirmadoSii: true });
      const antes = sii.llamadas.length;
      const r = await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ERM' }).expect(422);
      expect(r.body.code).toBe('PLAZO_VENCIDO');
      expect(sii.llamadas.length).toBe(antes);
    });

    it('si el SII responde código 8 (plazo) se informa como 422 y se cierra el plazo', async () => {
      const id = ids[`f${f3}`];
      sii.forzarCodigoReclamo = { codigo: 8, descripcion: 'Pasados 8 días después de la recepción no es posible registrar reclamos o eventos' };
      try {
        const r = await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ACD' }).expect(422);
        expect(r.body.code).toBe('PLAZO_VENCIDO');
      } finally {
        sii.forzarCodigoReclamo = undefined;
      }
      const d = await http().get(`/v1/dte-recibidos/${id}`).expect(200);
      expect(d.body.plazoVencido).toBe(true);
      await http().post(`/v1/dte-recibidos/${id}/registrar-sii`).send({ accion: 'ACD' }).expect(422);
    });
  });

  describe('buzón de correo (IMAP/SMTP con doble en memoria)', () => {
    const sobreCorreo = sobre([dte(33, 401)]);

    it('crea el buzón sin devolver nunca la contraseña, y la guarda cifrada', async () => {
      await http().get(`${base}/buzon-correo`).expect(404);
      await http().put(`${base}/buzon-correo`).send({ imapHost: 'imap.receptora.cl', usuario: 'intercambio@receptora.cl' }).expect(400);
      const r = await http()
        .put(`${base}/buzon-correo`)
        .send({
          imapHost: 'imap.receptora.cl',
          usuario: 'intercambio@receptora.cl',
          password: 'clave-imap-secreta',
          carpetaProcesados: 'Procesados',
          smtpHost: 'smtp.receptora.cl',
          smtpPuerto: 587,
          smtpPassword: 'clave-smtp-secreta',
          smtpRemitente: 'dte@receptora.cl',
        })
        .expect(201);
      expect(r.body).toMatchObject({
        imapPuerto: 993,
        imapSeguro: true,
        carpeta: 'INBOX',
        carpetaProcesados: 'Procesados',
        tienePassword: true,
        tieneSmtpPassword: true,
        intervaloSegundos: 300,
      });
      expect(JSON.stringify(r.body)).not.toContain('secreta');
      expect(Object.keys(r.body).some((k) => /^(password|smtpPassword|passwordCifrada)$/i.test(k))).toBe(false);
      const get = await http().get(`${base}/buzon-correo`).expect(200);
      expect(JSON.stringify(get.body)).not.toContain('secreta');
      const fila = await ds.query<Array<{ password_cifrada: Buffer }>>(
        `SELECT password_cifrada FROM buzones_correo b JOIN empresas e ON e.id = b.empresa_id WHERE e.rut = $1`,
        [rutA.numero],
      );
      expect(fila[0].password_cifrada.toString('utf8')).not.toContain('clave-imap-secreta');
      // Actualizar sin contraseña conserva la guardada.
      const upd = await http()
        .put(`${base}/buzon-correo`)
        .send({ imapHost: 'imap.receptora.cl', usuario: 'intercambio@receptora.cl', intervaloSegundos: 600 })
        .expect(200);
      expect(upd.body).toMatchObject({ intervaloSegundos: 600, tienePassword: true });
    });

    it('sondear: procesa los adjuntos XML, deduplica, responde el acuse por SMTP y marca/mueve el mensaje', async () => {
      correo.bandeja.push(
        { uid: '1', remitente: 'proveedor@emisor.cl', asunto: 'Envío de DTE', adjuntos: [{ nombre: 'dte401.xml', contenido: sobreCorreo }], leido: false },
        { uid: '2', remitente: 'otro@emisor.cl', asunto: 'Reenvío', adjuntos: [{ nombre: 'envio_proveedor.xml', contenido: envioOk }], leido: false },
        { uid: '3', remitente: 'spam@x.cl', asunto: 'Promoción', adjuntos: [], leido: false },
      );
      const r = await http().post(`${base}/buzon-correo/sondear`).expect(200);
      expect(r.body).toMatchObject({ mensajes: 3, adjuntos: 2, nuevos: 1, repetidos: 1, acusesEnviados: 1, errores: [] });
      expect(correo.sesiones[0]).toMatchObject({ host: 'imap.receptora.cl', password: 'clave-imap-secreta', carpeta: 'INBOX' });
      expect(correo.bandeja.every((m) => m.leido)).toBe(true);
      expect(correo.bandeja.find((m) => m.uid === '1')?.movidoA).toBe('Procesados');
      expect(correo.bandeja.find((m) => m.uid === '3')?.movidoA).toBeNull();

      expect(correo.enviados).toHaveLength(1);
      const { config, mensaje } = correo.enviados[0];
      expect(config).toMatchObject({ host: 'smtp.receptora.cl', puerto: 587, password: 'clave-smtp-secreta', remitente: 'dte@receptora.cl' });
      expect(mensaje.para).toBe('proveedor@emisor.cl');
      const acuse = desdeIso88591(mensaje.adjuntos[0].contenido);
      expect(validarXsd(acuse, 'RespuestaEnvioDTE').valido).toBe(true);
      expect(acuse).toContain('<EstadoRecepEnv>0</EstadoRecepEnv>');

      const envios = await http().get(`${base}/envios-recibidos`).expect(200);
      const delCorreo = (envios.body.datos as Array<{ origen: string; remitente: string; respuestaEnviadaEn: string | null }>).find(
        (e) => e.origen === 'correo',
      );
      expect(delCorreo).toMatchObject({ remitente: 'proveedor@emisor.cl' });
      expect(delCorreo?.respuestaEnviadaEn).not.toBeNull();
      const b = await http().get(`${base}/buzon-correo`).expect(200);
      expect(b.body.ultimoSondeoEn).not.toBeNull();
      expect(b.body.ultimoError).toBeNull();

      // Segundo sondeo: nada nuevo.
      const r2 = await http().post(`${base}/buzon-correo/sondear`).expect(200);
      expect(r2.body).toMatchObject({ mensajes: 0, nuevos: 0 });
    });

    it('aceptar con enviarCorreo envía el ResultadoDTE al remitente del envío (SMTP del buzón)', async () => {
      const lista = await http().get(`${base}/dte-recibidos?porPagina=200`).expect(200);
      const d401 = (lista.body.datos as Array<{ id: string; folio: number }>).find((d) => d.folio === 401);
      expect(d401).toBeDefined();
      const antes = correo.enviados.length;
      const r = await http().post(`/v1/dte-recibidos/${d401?.id}/aceptar`).send({ enviarCorreo: true }).expect(200);
      expect(r.body.correo).toMatchObject({ solicitado: true, enviado: true, destinatario: 'proveedor@emisor.cl', error: null });
      expect(correo.enviados).toHaveLength(antes + 1);
      const enviado = correo.enviados.at(-1);
      expect(enviado?.mensaje.para).toBe('proveedor@emisor.cl');
      expect(validarXsd(desdeIso88591(enviado?.mensaje.adjuntos[0].contenido ?? Buffer.alloc(0)), 'RespuestaEnvioDTE').valido).toBe(true);
    });

    it('enviarCorreo sin destinatario conocido responde 422 y no cambia el estado del DTE', async () => {
      const id = ids.f104; // llegó por subida, sin remitente
      const r = await http().post(`/v1/dte-recibidos/${id}/aceptar`).send({ enviarCorreo: true }).expect(422);
      expect(r.body.code).toBe('SIN_DESTINATARIO');
      expect((await http().get(`/v1/dte-recibidos/${id}`).expect(200)).body.estadoComercial).toBe('pendiente');
      const ok = await http().post(`/v1/dte-recibidos/${id}/aceptar`).send({ enviarCorreo: true, destinatario: 'contacto@emisor.cl' }).expect(200);
      expect(ok.body.correo).toMatchObject({ enviado: true, destinatario: 'contacto@emisor.cl' });
    });

    it('si el SMTP falla, la respuesta queda guardada y el error se informa sin perderla', async () => {
      correo.fallarSmtp = new Error('conexión rechazada');
      try {
        const r = await http()
          .post(`/v1/dte-recibidos/${ids[`f${f2}`]}/recibo-mercaderias`)
          .send({ recinto: 'x', rutFirma: '12345678-5', enviarCorreo: true, destinatario: 'a@b.cl' });
        expect(r.status).toBe(409); // f2 fue rechazado: el recibo no procede (y no se tocó el SMTP)
        const f4 = await http().post(`/v1/dte-recibidos/${ids.f104}/recibo-mercaderias`).send({ recinto: 'Bodega', rutFirma: '12345678-5', enviarCorreo: true, destinatario: 'a@b.cl' }).expect(200);
        expect(f4.body.correo).toMatchObject({ solicitado: true, enviado: false });
        expect(f4.body.correo.error).toContain('conexión rechazada');
        expect(f4.body.dte.acuseReciboMercaderias).toBe(true);
      } finally {
        correo.fallarSmtp = undefined;
      }
    });

    it('un fallo de IMAP se informa como 502 y queda en ultimo_error', async () => {
      correo.fallarImap = new Error('login failed');
      try {
        const r = await http().post(`${base}/buzon-correo/sondear`).expect(502);
        expect(r.body.code).toBe('CORREO_NO_DISPONIBLE');
      } finally {
        correo.fallarImap = undefined;
      }
      const b = await http().get(`${base}/buzon-correo`).expect(200);
      expect(b.body.ultimoError).toContain('login failed');
    });

    it('eliminar el buzón: 204 y luego 404', async () => {
      await http().delete(`${base}/buzon-correo`).expect(204);
      await http().get(`${base}/buzon-correo`).expect(404);
      await http().post(`${base}/buzon-correo/sondear`).expect(404);
    });
  });

  describe('libro de compras desde los DTE recibidos', () => {
    it('desdeRecibidos arma el detalle con los aceptados del período (no los rechazados ni pendientes)', async () => {
      const r = await http().post(`${base}/libros/compras`).send({ periodo: PERIODO_EMISION, desdeRecibidos: true }).expect(201);
      // Aceptados: f101 (33), f103 (34, con reparos), f401 (33) y f104 (33).
      expect(r.body).toMatchObject({ tipoOperacion: 'COMPRA', periodo: PERIODO_EMISION, cantidadDocumentos: 4 });
      const tipos = Object.fromEntries(
        (r.body.resumen as Array<{ tipoDoc: number }>).map((t) => [t.tipoDoc, t]),
      ) as Record<number, Record<string, number>>;
      expect(tipos[33]).toMatchObject({ cantidad: 3, montoNeto: 3000, montoIva: 570, montoTotal: 3570 });
      expect(tipos[34]).toMatchObject({ cantidad: 1, montoExento: 1000, montoTotal: 1000 });
      const xml = await descargar(`/v1/libros/${r.body.id}/xml`);
      expect(validarXsd(xml, 'LibroCV')).toEqual({ valido: true, errores: [] });
      expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
      expect(xml).toContain('<TipoOperacion>COMPRA</TipoOperacion>');
      expect(xml).toContain(`<RUTDoc>${RUT_EMISOR}</RUTDoc>`);
      expect(xml).not.toContain('<NroDoc>102</NroDoc>'); // el rechazado
    });

    it('un período sin DTE recibidos aceptados, o mezclar documentos con desdeRecibidos, responde error claro', async () => {
      const mezcla = await http()
        .post(`${base}/libros/compras`)
        .send({ periodo: PERIODO_EMISION, desdeRecibidos: true, documentos: [] })
        .expect(400);
      expect(JSON.stringify(mezcla.body)).toContain('desdeRecibidos');
      await http().post(`${base}/libros/compras`).send({ periodo: PERIODO_EMISION }).expect(400);
    });

    it('mantiene la entrada JSON de siempre', async () => {
      const r = await http()
        .post(`${base}/libros/compras`)
        .send({
          periodo: PERIODO_EMISION,
          documentos: [
            { tipoDoc: 33, folio: 900, fechaDoc: '2026-02-10', rutProveedor: RUT_EMISOR, razonSocial: 'PROVEEDOR', montoNeto: 10000, montoIva: 1900, montoTotal: 11900 },
          ],
        })
        .expect(201);
      expect(r.body).toMatchObject({ tipoOperacion: 'COMPRA', cantidadDocumentos: 1 });
    });
  });
});
