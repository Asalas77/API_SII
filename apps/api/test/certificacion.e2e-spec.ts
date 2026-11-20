import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { CertificadosService } from '../src/certificados/certificados.service.js';
import { Certificado } from '../src/certificados/entities/certificado.entity.js';
import { parsearSet } from '../src/certificacion/index.js';
import { ejecutarSet, type ServiciosCertificacion } from '../src/certificacion/ejecutar-set.js';
import { DocumentosService } from '../src/documentos/documentos.service.js';
import { Documento } from '../src/documentos/entities/documento.entity.js';
import { comoSistema } from '../src/database/contexto-empresa.js';
import { EjecutorEmpresa } from '../src/database/ejecutor-empresa.js';
import { calcularDv } from '../src/dte-core/index.js';
import { generarPfxPrueba } from '../src/dte-core/testing/testing.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { EmpresasService } from '../src/empresas/empresas.service.js';
import { EnvioDocumento } from '../src/envios/entities/envio-documento.entity.js';
import { Envio } from '../src/envios/entities/envio.entity.js';
import { EnviosService } from '../src/envios/envios.service.js';
import { Caf } from '../src/folios/entities/caf.entity.js';
import { FoliosService } from '../src/folios/folios.service.js';
import { SII_FETCH } from '../src/sii/tokens.js';
import { SiiClienteFactory } from '../src/sii/sii-cliente.factory.js';
import { generarCafRealista } from '../src/testing/caf-realista.js';
import { crearSiiSimulado } from '../src/testing/sii-simulado.js';
import { postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

const hayDb = await postgresDisponible();

const SET = `SET BASICO - NUMERO DE ATENCION: 4321
CASO 4321-1
DOCUMENTO\tFACTURA ELECTRONICA
ITEM\tCANTIDAD\tPRECIO UNITARIO
Cajón AFECTO\t10\t1000
Relleno EXENTO\t5\t200

CASO 4321-2
DOCUMENTO\tNOTA DE CREDITO ELECTRONICA
REFERENCIA\tANULA FACTURA ELECTRONICA NO. 1
RAZON REFERENCIA\tANULA FACTURA
`;

describe.skipIf(!hayDb)('Herramienta del set de pruebas (e2e, con DB)', () => {
  let svc: ServiciosCertificacion;
  let close: () => Promise<void>;
  let ds: DataSource;
  let empresaId: string;
  let carpeta: string;
  const rut = rutAleatorio((n) => calcularDv(n));
  const sii = crearSiiSimulado();

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SII_FETCH)
      .useValue(sii.fetch)
      .compile();
    await m.init();
    ds = await crearDsFixtures();
    close = async () => {
      await ds.destroy();
      await m.close();
    };
    svc = {
      ejecutor: m.get(EjecutorEmpresa),
      empresas: m.get(EmpresasService),
      documentos: m.get(DocumentosService),
      envios: m.get(EnviosService),
      sii: m.get(SiiClienteFactory),
    };
    carpeta = mkdtempSync(join(tmpdir(), 'set-'));
    // Los servicios exigen contexto de empresa (RLS): el setup corre como sistema.
    await comoSistema(async () => {
    const empresa = await svc.empresas.crear({
      rut: rut.texto,
      razonSocial: 'EMPRESA SET SPA',
      giro: 'Servicios',
      actecos: [620200],
      direccion: 'Calle 1',
      comuna: 'Santiago',
      ciudad: 'Santiago',
      nroResolucionSii: 0,
      fechaResolucionSii: '2026-01-15',
    });
    empresaId = empresa.id;
    await m
      .get(CertificadosService)
      .cargar(rut.texto, generarPfxPrueba('x', { rut: '12345678-5' }), 'x');
    const folios = m.get(FoliosService);
    for (const tipo of [33, 61]) {
      const xml = generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 20, rutEmisor: rut.texto });
      await folios.registrarCaf(empresaId, {
        tipoDte: tipo, folioDesde: 1, folioHasta: 20,
        fechaAutorizacion: new Date(), xml, rutEmisor: rut.texto,
      });
    }
    });
  });

  afterAll(async () => {
    if (!close) return;
    const docs = await ds.getRepository(Documento).find({ where: { empresaId } });
    const envios = await ds.getRepository(Envio).find({ where: { empresaId } });
    for (const e of envios) await ds.getRepository(EnvioDocumento).delete({ envioId: e.id });
    await ds.getRepository(Envio).delete({ empresaId });
    if (docs.length) await ds.getRepository(Documento).delete(docs.map((d) => d.id));
    await ds.getRepository(Caf).delete({ empresaId });
    await ds.getRepository(Certificado).delete({ empresaId });
    await ds.getRepository(Empresa).delete({ id: empresaId });
    rmSync(carpeta, { recursive: true, force: true });
    await close();
  });

  it('modo simulado: genera archivos, valida el sobre, no envía ni consume folios', async () => {
    const llamadasAntes = sii.llamadas.length;
    const r = await ejecutarSet(svc, parsearSet(SET), {
      rutEmpresa: rut.texto,
      simular: true,
      carpetaSalida: carpeta,
    });
    expect(r.documentos.map((d) => [d.caso, d.tipoDte, d.folio])).toEqual([
      ['4321-1', 33, 1],
      ['4321-2', 61, 1],
    ]);
    const archivos = readdirSync(carpeta);
    expect(archivos).toContain('EnvioDTE.xml');
    expect(archivos.filter((a) => a.endsWith('.xml'))).toHaveLength(3);
    expect(existsSync(join(carpeta, '4321-1_T33_F1.pdf'))).toBe(true);
    expect(r.advertencias).toEqual([]);
    expect(sii.llamadas.length).toBe(llamadasAntes);
    expect(await ds.getRepository(Documento).count({ where: { empresaId } })).toBe(0);
    const caf = await ds.getRepository(Caf).findOneByOrFail({ empresaId, tipoDte: 33 });
    expect(caf.folioSiguiente).toBe(1);
  });

  it('modo real: emite, envía un solo sobre y es idempotente al repetir', async () => {
    const r = await ejecutarSet(svc, parsearSet(SET), { rutEmpresa: rut.texto, simular: false });
    expect(r.documentos).toHaveLength(2);
    expect(r.envios).toHaveLength(1);
    expect(r.envios[0]).toMatchObject({ canal: 'dte', documentos: 2 });
    expect(r.envios[0].trackId).toMatch(/^\d+$/);

    const nc = await ds.getRepository(Documento).findOneByOrFail({ empresaId, tipoDte: 61 });
    expect(nc.xmlFirmado).toContain('<TpoDocRef>SET</TpoDocRef>');
    expect(nc.xmlFirmado).toContain('CASO 4321-2');
    expect(nc.estado).toBe('enviado');

    const otra = await ejecutarSet(svc, parsearSet(SET), { rutEmpresa: rut.texto, simular: false });
    expect(otra.envios).toHaveLength(0);
    expect(otra.advertencias.join()).toContain('ya habían sido enviados');
    expect(await ds.getRepository(Documento).count({ where: { empresaId } })).toBe(2);
  });
});
