import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.setup.js';
import { ApiKey } from '../src/auth/entities/api-key.entity.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { fechaSantiago } from '../src/comun/fechas.js';
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

const hoy = fechaSantiago();
const periodo = hoy.slice(0, 7);

describe.skipIf(!hayDb)('Libros electrónicos IECV y guías por la API /v1 (e2e, con DB)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sii = crearSiiSimulado();
  const rutA = rutAleatorio((n) => calcularDv(n));
  const rutB = rutAleatorio((n) => calcularDv(n));
  const base = `/v1/empresas/${rutA.texto}`;
  const idsKeys: string[] = [];
  const http = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${ADMIN_KEY}`);
  const conClave = (clave: string) => request.agent(app.getHttpServer()).set('X-API-Key', clave);

  const receptor = (rut: string) => ({
    rut,
    razonSocial: 'CLIENTE DE PRUEBA LTDA',
    giro: 'Comercio',
    direccion: 'Calle Falsa 123',
    comuna: 'Santiago',
    ciudad: 'Santiago',
  });
  // Res. Ex. SII 144/2026: toda guía (52) lleva datos de transporte (EXIGIR_TRASLADO_GUIAS=true por defecto).
  const traslado = {
    categoria: 'autogestionado',
    destino: { direccion: 'Los Leones 99', comuna: 'Ñuñoa', ciudad: 'Santiago' },
    fechaSalida: '2026-11-23',
    transportista: { rut: '76543210-3' },
    chofer: { rut: '11222333-9', nombre: 'Juan Pérez Soto' },
    patente: 'BCDF12',
  };
  const emitir = async (cuerpo: Record<string, unknown>) => (await http().post(`${base}/documentos`).send(cuerpo).expect(201)).body;
  const descargar = async (id: string): Promise<string> => {
    const r = await http()
      .get(`/v1/libros/${id}/xml`)
      .buffer(true)
      .parse((res, cb) => {
        const trozos: Buffer[] = [];
        res.on('data', (t: Buffer) => trozos.push(t));
        res.on('end', () => cb(null, Buffer.concat(trozos)));
      })
      .expect(200);
    expect(r.headers['content-type']).toContain('ISO-8859-1');
    return desdeIso88591(r.body as Buffer);
  };

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
      await ds.getRepository(Libro).delete({ empresaId: e.id });
      const envios = await ds.getRepository(Envio).find({ where: { empresaId: e.id } });
      for (const v of envios) await ds.getRepository(EnvioDocumento).delete({ envioId: v.id });
      await ds.getRepository(Envio).delete({ empresaId: e.id });
      await ds.getRepository(Documento).delete({ empresaId: e.id });
      await ds.getRepository(Caf).delete({ empresaId: e.id });
      await ds.getRepository(Certificado).delete({ empresaId: e.id });
      await ds.getRepository(Empresa).delete({ id: e.id });
    }
    for (const id of idsKeys) await ds.getRepository(ApiKey).delete({ id });
    await app.close();
    await ds.destroy();
  });

  it('prepara las empresas, el certificado, los CAF y emite documentos del período', async () => {
    for (const r of [rutA, rutB]) {
      await http()
        .post('/v1/empresas')
        .send({
          rut: r.texto,
          razonSocial: r === rutA ? 'EMPRESA LIBROS SPA' : 'EMPRESA AJENA SPA',
          giro: 'Servicios informáticos',
          actecos: [620200],
          direccion: 'Av. Providencia 1234',
          comuna: 'Providencia',
          ciudad: 'Santiago',
          nroResolucionSii: 0,
          fechaResolucionSii: '2026-01-15',
        })
        .expect(201);
    }
    await http()
      .post(`${base}/certificados`)
      .attach('archivo', generarPfxPrueba('clave', { rut: '12345678-5', nombre: 'Firmante Libros' }), 'cert.pfx')
      .field('password', 'clave')
      .expect(201);
    for (const tipo of [33, 34, 39, 52, 61]) {
      await http()
        .post(`${base}/cafs`)
        .attach('archivo', Buffer.from(generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 50, rutEmisor: rutA.texto })), 'caf.xml')
        .expect(201);
    }

    const f1 = await emitir({
      idDoc: { tipoDte: 33, formaPago: 1 },
      receptor: receptor('12345678-5'),
      detalle: [{ nombre: 'Servicio A', cantidad: 2, precioUnitario: 10000 }],
    });
    expect(f1.totales).toMatchObject({ montoNeto: 20000, iva: 3800, montoTotal: 23800 });
    await emitir({
      idDoc: { tipoDte: 33, formaPago: 1 },
      receptor: receptor('11111111-1'),
      detalle: [
        { nombre: 'Servicio B', cantidad: 1, precioUnitario: 5000 },
        { nombre: 'Servicio exento', cantidad: 1, precioUnitario: 3000, exento: true },
      ],
    });
    await emitir({
      idDoc: { tipoDte: 34, formaPago: 1 },
      receptor: receptor('11111111-1'),
      detalle: [{ nombre: 'Servicio exento', cantidad: 1, precioUnitario: 7000 }],
    });
    await emitir({
      idDoc: { tipoDte: 61 },
      receptor: receptor('12345678-5'),
      detalle: [{ nombre: 'Devolución', cantidad: 1, precioUnitario: 10000 }],
      referencias: [{ tipoDocRef: '33', folioRef: 1, codRef: 3, razonRef: 'Devolución parcial' }],
    });
    await emitir({
      idDoc: { tipoDte: 52, indTraslado: 1 },
      traslado,
      receptor: receptor('12345678-5'),
      detalle: [{ nombre: 'Mercadería', cantidad: 1, precioUnitario: 1000 }],
      referencias: [{ tipoDocRef: '33', folioRef: 1 }],
    });
    await emitir({
      idDoc: { tipoDte: 52, indTraslado: 5 },
      traslado,
      receptor: receptor('12345678-5'),
      detalle: [{ nombre: 'Traslado interno', cantidad: 3, precioUnitario: 100 }],
    });
    await emitir({ idDoc: { tipoDte: 39 }, detalle: [{ nombre: 'Café', cantidad: 1, precioUnitario: 1190 }] });
    await emitir({ idDoc: { tipoDte: 39 }, detalle: [{ nombre: 'Café', cantidad: 2, precioUnitario: 1190 }] });
  });

  let idVentas = '';

  it('genera el libro de ventas ESPECIAL del período desde los documentos y valida XSD y firma', async () => {
    const r = await http()
      .post(`${base}/libros/ventas`)
      .send({ periodo, tipoLibro: 'ESPECIAL', tipoEnvio: 'TOTAL', folioNotificacion: 1 })
      .expect(201);
    expect(r.body).toMatchObject({
      tipoOperacion: 'VENTA',
      tipoLibro: 'ESPECIAL',
      tipoEnvio: 'TOTAL',
      periodo,
      folioNotificacion: 1,
      trackId: null,
      estado: null,
      cantidadDocumentos: 4,
    });
    idVentas = r.body.id as string;

    const tipos = Object.fromEntries(
      (r.body.resumen as Array<{ tipoDoc: number }>).map((t) => [t.tipoDoc, t]),
    ) as Record<number, Record<string, number>>;
    expect(Object.keys(tipos).map(Number)).toEqual([33, 34, 61]); // ESPECIAL: sin boletas
    expect(tipos[33]).toMatchObject({ cantidad: 2, montoExento: 3000, montoNeto: 25000, montoIva: 4750, montoTotal: 32750 });
    expect(tipos[34]).toMatchObject({ cantidad: 1, montoExento: 7000, montoNeto: 0, montoIva: 0, montoTotal: 7000 });
    expect(tipos[61]).toMatchObject({ cantidad: 1, montoNeto: 10000, montoIva: 1900, montoTotal: 11900 });

    const xml = await descargar(idVentas);
    expect(validarXsd(xml, 'LibroCV')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml)).toEqual({ valida: true, errores: [] });
    expect(xml).toContain('<TipoOperacion>VENTA</TipoOperacion><TipoLibro>ESPECIAL</TipoLibro>');
    expect(xml).toContain('<FolioNotificacion>1</FolioNotificacion>');
    expect(xml).toContain(`<RutEmisorLibro>${rutA.texto}</RutEmisorLibro><RutEnvia>12345678-5</RutEnvia>`);
    expect(xml).toContain('<NroResol>0</NroResol>');
    expect((xml.match(/<Detalle>/g) ?? []).length).toBe(4);
  });

  it('libro MENSUAL: las boletas van solo como resumen (no en el detalle)', async () => {
    const r = await http().post(`${base}/libros/ventas`).send({ periodo }).expect(201);
    expect(r.body).toMatchObject({ tipoLibro: 'MENSUAL', tipoEnvio: 'TOTAL', folioNotificacion: null });
    const boletas = (r.body.resumen as Array<Record<string, number>>).find((t) => t.tipoDoc === 39);
    expect(boletas).toMatchObject({ cantidad: 2, montoTotal: 3570, montoNeto: 3000, montoIva: 570 });
    const xml = await descargar(r.body.id as string);
    expect(validarXsd(xml, 'LibroCV').valido).toBe(true);
    expect(xml).not.toMatch(/<Detalle><TpoDoc>39<\/TpoDoc>/);
  });

  it('valida el cuerpo y las reglas de la carátula', async () => {
    const malo = await http().post(`${base}/libros/ventas`).send({ periodo: '2026-13' }).expect(400);
    expect(malo.body.code).toBe('VALIDACION');
    const sinFolio = await http().post(`${base}/libros/ventas`).send({ periodo, tipoLibro: 'ESPECIAL' }).expect(422);
    expect(sinFolio.body.code).toBe('DOCUMENTO_INVALIDO');
    expect(sinFolio.body.detail).toMatch(/FolioNotificacion/);
    await http().post(`${base}/libros/ventas`).send({ periodo, tipoEnvio: 'AJUSTE' }).expect(422);
    await http().post(`${base}/libros/ventas`).send({ periodo, tipoEnvio: 'PARCIAL', nroSegmento: 1 }).expect(422);
    await http()
      .post(`${base}/libros/ventas`)
      .send({ periodo, documentoIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(404);
  });

  it('envía el libro al SII (upload de DTE) y consulta el estado con getEstUp', async () => {
    const antes = sii.llamadas.filter((l) => l.url.endsWith('/DTEUpload')).length;
    const e = await http().post(`/v1/libros/${idVentas}/enviar`).expect(200);
    expect(e.body).toMatchObject({ estado: 'REC', esFinal: false, intentos: 1 });
    expect(e.body.trackId).toMatch(/^\d+$/);
    expect(sii.llamadas.filter((l) => l.url.endsWith('/DTEUpload')).length).toBe(antes + 1);
    // Ya enviado: no se reenvía.
    const dup = await http().post(`/v1/libros/${idVentas}/enviar`).expect(409);
    expect(dup.body.code).toBe('ESTADO_INVALIDO');

    sii.estadoDte.estado = 'EPR';
    const c = await http().post(`/v1/libros/${idVentas}/consultar`).expect(200);
    expect(c.body).toMatchObject({ estado: 'EPR', esFinal: true, trackId: e.body.trackId });
    expect(c.body.consultadoEn).not.toBeNull();
    const leido = await http().get(`/v1/libros/${idVentas}`).expect(200);
    expect(leido.body.estado).toBe('EPR');
  });

  it('generar con enviar=true guarda y sube el libro en un solo paso; consultar sin envío da 409', async () => {
    const sinEnviar = await http().post(`${base}/libros/ventas`).send({ periodo, tipoLibro: 'ESPECIAL', folioNotificacion: 1 }).expect(201);
    await http().post(`/v1/libros/${sinEnviar.body.id}/consultar`).expect(409);
    const r = await http()
      .post(`${base}/libros/ventas`)
      .send({ periodo, tipoLibro: 'ESPECIAL', folioNotificacion: 1, enviar: true })
      .expect(201);
    expect(r.body).toMatchObject({ estado: 'REC' });
    expect(r.body.trackId).toMatch(/^\d+$/);
  });

  it('libro de compras desde JSON: IVA uso común, no recuperable, activo fijo y factor', async () => {
    const documentos = [
      { tipoDoc: 30, folio: 234, fechaDoc: hoy, rutProveedor: '96792430-K', razonSocial: 'Proveedor Uno SA', montoNeto: 10000 },
      { tipoDoc: 33, folio: 32, fechaDoc: hoy, rutProveedor: '96792430-K', montoNeto: 20000, montoIva: 0, ivaUsoComun: 3800 },
      { tipoDoc: 33, folio: 33, fechaDoc: hoy, rutProveedor: '96792430-K', montoNeto: 5000, montoIva: 0, ivaNoRecuperable: [{ codigo: 1, monto: 950 }] },
      { tipoDoc: 33, folio: 34, fechaDoc: hoy, rutProveedor: '96792430-K', montoNeto: 8000, montoNetoActivoFijo: 8000, ivaActivoFijo: 1520 },
      { tipoDoc: 34, folio: 9, fechaDoc: hoy, rutProveedor: '96792430-K', montoExento: 6000 },
      { tipoDoc: 60, folio: 451, fechaDoc: hoy, rutProveedor: '96792430-K', montoNeto: 1000, tipoDocRef: 30, folioDocRef: 234 },
    ];
    const r = await http()
      .post(`${base}/libros/compras`)
      .send({ periodo, tipoLibro: 'ESPECIAL', tipoEnvio: 'TOTAL', folioNotificacion: 2, factorProporcionalidad: 0.6, documentos })
      .expect(201);
    expect(r.body).toMatchObject({ tipoOperacion: 'COMPRA', folioNotificacion: 2, cantidadDocumentos: 6 });
    const t33 = (r.body.resumen as Array<Record<string, unknown>>).find((t) => t.tipoDoc === 33);
    expect(t33).toMatchObject({ cantidad: 3, montoNeto: 33000, ivaUsoComun: 3800, montoIva: 1520 });
    const xml = await descargar(r.body.id as string);
    expect(validarXsd(xml, 'LibroCV')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml).valida).toBe(true);
    expect(xml).toContain('<FctProp>0.600</FctProp><TotCredIVAUsoComun>2280</TotCredIVAUsoComun>');
    expect(xml).toContain('<IVANoRec><CodIVANoRec>1</CodIVANoRec><MntIVANoRec>950</MntIVANoRec></IVANoRec>');
  });

  it('compras: valida con Joi (RUT) y rechaza totales que no cuadran', async () => {
    const doc = { tipoDoc: 33, folio: 1, fechaDoc: hoy, rutProveedor: '96792430-K', montoNeto: 1000 };
    const rutMalo = await http()
      .post(`${base}/libros/compras`)
      .send({ periodo, documentos: [{ ...doc, rutProveedor: '12345678-0' }] })
      .expect(400);
    expect(rutMalo.body.code).toBe('VALIDACION');
    await http().post(`${base}/libros/compras`).send({ periodo }).expect(400);
    const desc = await http()
      .post(`${base}/libros/compras`)
      .send({ periodo, documentos: [{ ...doc, montoTotal: 5 }] })
      .expect(422);
    expect(desc.body.detail).toMatch(/no cuadra/);
  });

  it('libro de guías de despacho desde las guías (52) emitidas', async () => {
    await http().post(`${base}/libros/guias`).send({ periodo }).expect(400); // falta folioNotificacion
    const r = await http().post(`${base}/libros/guias`).send({ periodo, folioNotificacion: 3 }).expect(201);
    expect(r.body).toMatchObject({ tipoOperacion: 'GUIA', tipoLibro: 'ESPECIAL', tipoEnvio: 'TOTAL', cantidadDocumentos: 2 });
    expect(r.body.resumen).toMatchObject({
      guiasVenta: 1,
      montoGuiasVenta: 1190,
      traslados: [{ tipoOperacion: 5, cantidad: 1, monto: 357 }],
    });
    const xml = await descargar(r.body.id as string);
    expect(validarXsd(xml, 'LibroGuia')).toEqual({ valido: true, errores: [] });
    expect(verificarFirmaXml(xml).valida).toBe(true);
    expect(xml).toContain('<FolioNotificacion>3</FolioNotificacion>');
    expect(xml).toContain('<TpoDocRef>33</TpoDocRef><FolioDocRef>1</FolioDocRef>');
  });

  it('lista los libros de la empresa, con filtro por período', async () => {
    const todos = await http().get(`${base}/libros`).expect(200);
    expect(todos.body.datos.length).toBeGreaterThanOrEqual(6);
    const otroPeriodo = await http().get(`${base}/libros?periodo=2020-01`).expect(200);
    expect(otroPeriodo.body.datos).toEqual([]);
  });

  it('aislamiento: otra empresa recibe 403 en rutas con RUT y 404 en recursos por id; sin permiso, 403', async () => {
    const claveB = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'Libros empresa B', permisos: ['libros.generar', 'libros.leer'], empresas: [rutB.texto] })
      .expect(201);
    idsKeys.push(claveB.body.id as string);
    const claveSinPermiso = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'Sin libros', permisos: ['documentos.leer'], empresas: [rutA.texto] })
      .expect(201);
    idsKeys.push(claveSinPermiso.body.id as string);
    const claveA = await http()
      .post('/v1/api-keys')
      .send({ nombre: 'Solo lectura A', permisos: ['libros.leer'], empresas: [rutA.texto] })
      .expect(201);
    idsKeys.push(claveA.body.id as string);

    const b = claveB.body.clave as string;
    await conClave(b).post(`${base}/libros/ventas`).send({ periodo }).expect(403);
    await conClave(b).post(`${base}/libros/compras`).send({ periodo, documentos: [] }).expect(403);
    await conClave(b).post(`${base}/libros/guias`).send({ periodo, folioNotificacion: 3 }).expect(403);
    await conClave(b).get(`${base}/libros`).expect(403);
    for (const ruta of [`/v1/libros/${idVentas}`, `/v1/libros/${idVentas}/xml`]) {
      const r = await conClave(b).get(ruta).expect(404);
      expect(r.body.code).toBe('NO_ENCONTRADO');
    }
    await conClave(b).post(`/v1/libros/${idVentas}/enviar`).expect(404);
    await conClave(b).post(`/v1/libros/${idVentas}/consultar`).expect(404);
    // La empresa B no tiene documentos propios: su libro sale vacío y no mezcla los de A.
    const propio = await conClave(b).post(`/v1/empresas/${rutB.texto}/libros/ventas`).send({ periodo }).expect(422);
    expect(propio.body.code).toBe('CERTIFICADO_INVALIDO');

    await conClave(claveSinPermiso.body.clave as string).get(`/v1/libros/${idVentas}`).expect(403);
    await conClave(claveSinPermiso.body.clave as string).post(`${base}/libros/ventas`).send({ periodo }).expect(403);
    // Con solo libros.leer se lee, pero no se genera, envía ni... (consultar es de lectura).
    const a = claveA.body.clave as string;
    await conClave(a).get(`/v1/libros/${idVentas}`).expect(200);
    await conClave(a).post(`${base}/libros/ventas`).send({ periodo }).expect(403);
    await conClave(a).post(`/v1/libros/${idVentas}/enviar`).expect(403);
    await http().get('/v1/libros/00000000-0000-4000-8000-000000000000').expect(404);
    await request(app.getHttpServer()).get(`/v1/libros/${idVentas}`).expect(401);
  });

  it('el libro queda guardado con RLS: la fila pertenece a la empresa A', async () => {
    const filas = await ds.getRepository(Libro).find({ where: { id: idVentas } });
    expect(filas).toHaveLength(1);
    const e = await ds.getRepository(Empresa).findOneByOrFail({ rut: rutA.numero });
    expect(filas[0].empresaId).toBe(e.id);
    expect(filas[0].xmlLibro).toContain('<LibroCompraVenta');
  });
});
