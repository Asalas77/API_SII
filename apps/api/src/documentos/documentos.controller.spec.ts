import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configurarApp } from '../app.setup.js';
import { DocumentosController, EmpresaDocumentosController } from './documentos.controller.js';
import { DocumentosService } from './documentos.service.js';
import { EstadoSiiService } from './estado-sii.service.js';

// Rutas y validación del cuerpo de la consulta de estados, sin base de datos (servicios simulados).
describe('consulta de estados: rutas y validación', () => {
  let app: INestApplication;
  const consultarLote = vi.fn((_rut: string, _dto: unknown) =>
    Promise.resolve({ total: 0, consultados: 0, conError: 0, resultados: [] }),
  );

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [EmpresaDocumentosController, DocumentosController],
      providers: [
        { provide: DocumentosService, useValue: {} },
        { provide: EstadoSiiService, useValue: { consultarLote } },
      ],
    }).compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('el cuerpo es opcional', async () => {
    await request(app.getHttpServer())
      .post('/v1/empresas/76086428-5/documentos/consultar-estados')
      .expect(200);
    expect(consultarLote).toHaveBeenLastCalledWith('76086428-5', {});
  });

  it('acepta documentoIds o limite y rechaza valores fuera de rango', async () => {
    const url = '/v1/empresas/76086428-5/documentos/consultar-estados';
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await request(app.getHttpServer()).post(url).send({ documentoIds: [id] }).expect(200);
    expect(consultarLote).toHaveBeenLastCalledWith('76086428-5', { documentoIds: [id] });
    await request(app.getHttpServer()).post(url).send({ limite: 200 }).expect(200);
    for (const malo of [{ limite: 201 }, { limite: 0 }, { documentoIds: ['x'] }, { documentoIds: [id], limite: 5 }]) {
      const r = await request(app.getHttpServer()).post(url).send(malo).expect(400);
      expect(r.body.code).toBe('VALIDACION');
    }
  });
});
