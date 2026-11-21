import { ProblemaHttp } from '../comun/problema.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import type { ClientesSii } from '../sii/sii-cliente.factory.js';
import { SiiRedError } from '../sii-gateway/index.js';
import { Documento } from './entities/documento.entity.js';
import { EstadoSiiService } from './estado-sii.service.js';

const empresa = { id: 'e1', rut: 76086428, dv: '5', ambienteSii: 'certificacion' } as unknown as Empresa;

function crearDoc(extra: Partial<Documento> = {}): Documento {
  return Object.assign(new Documento(), {
    id: 'd1',
    empresaId: 'e1',
    tipoDte: 33,
    folio: 7,
    fechaEmision: '2026-11-18',
    rutReceptor: 12345678,
    dvReceptor: '5',
    montoTotal: 23800,
    estado: 'enviado',
    estadoSii: null,
    glosaSii: null,
    consultadoSiiEn: null,
    respuestaEstadoSii: null,
    ...extra,
  });
}

function crearServicio(docs: Documento[]) {
  const em = {
    getRepository: (entidad: unknown) => ({
      findOneOrFail: ({ where }: { where: { id: string } }) =>
        Promise.resolve(docs.find((d) => d.id === where.id)),
      findOne: () => Promise.resolve(null),
      find: () => Promise.resolve(entidad === Documento ? docs : []),
    }),
    update: (_: unknown, { id }: { id: string }, patch: Partial<Documento>) => {
      Object.assign(docs.find((d) => d.id === id) as Documento, patch);
      return Promise.resolve();
    },
  };
  const ejecutor = { ejecutar: <T>(f: (e: typeof em) => Promise<T>) => f(em) };
  const llamadas: unknown[] = [];
  let respuesta: () => Promise<unknown> = () =>
    Promise.resolve({ estado: 'DOK', glosa: '', cabecera: { GLOSA_ERR: 'Recibido' } });
  const clientes = {
    dte: {
      consultarEstadoDte: (p: unknown) => {
        llamadas.push(p);
        return respuesta();
      },
    },
    boleta: {
      consultarEstadoBoleta: (p: unknown) => {
        llamadas.push(p);
        return Promise.resolve({ codigo: 'DOK', descripcion: 'Boleta recibida' });
      },
    },
  } as unknown as ClientesSii;
  const servicio = new EstadoSiiService(
    ejecutor as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    servicio,
    llamadas,
    clientes: () => Promise.resolve(clientes),
    responder: (f: () => Promise<unknown>) => {
      respuesta = f;
    },
  };
}

describe('EstadoSiiService.consultarYAplicar', () => {
  it('DTE: manda los parámetros de getEstDte y aplica DOK -> aceptado', async () => {
    const doc = crearDoc();
    const { servicio, llamadas, clientes } = crearServicio([doc]);
    const r = await servicio.consultarYAplicar(doc, empresa, clientes);
    expect(llamadas[0]).toEqual({
      rutEmisor: 76086428,
      dvEmisor: '5',
      rutReceptor: 12345678,
      dvReceptor: '5',
      tipoDte: 33,
      folio: 7,
      fechaEmision: '18112026',
      monto: 23800,
    });
    expect(r).toMatchObject({ estadoSii: 'DOK', glosaSii: 'Recibido', esFinal: true, estadoAnterior: 'enviado' });
    expect(doc).toMatchObject({ estado: 'aceptado', estadoSii: 'DOK', glosaSii: 'Recibido' });
    expect(doc.consultadoSiiEn).toBeInstanceOf(Date);
  });

  it('boleta: consulta el estado de boleta con fecha DD-MM-YYYY', async () => {
    const doc = crearDoc({ tipoDte: 39, rutReceptor: 66666666, dvReceptor: '6', montoTotal: 1190 });
    const { servicio, llamadas, clientes } = crearServicio([doc]);
    await servicio.consultarYAplicar(doc, empresa, clientes);
    expect(llamadas[0]).toEqual({
      tipo: 39,
      folio: 7,
      rutReceptor: 66666666,
      dvReceptor: '6',
      monto: 1190,
      fechaEmision: '18-11-2026',
    });
    expect(doc.estado).toBe('aceptado');
  });

  it('un error de consulta (ESTADO -4) lanza 502 y no modifica nada', async () => {
    const doc = crearDoc();
    const { servicio, clientes, responder } = crearServicio([doc]);
    responder(() => Promise.resolve({ estado: '-4', glosa: '', cabecera: {} }));
    await expect(servicio.consultarYAplicar(doc, empresa, clientes)).rejects.toMatchObject({
      code: 'SII_CONSULTA_ERROR',
    });
    expect(doc).toMatchObject({ estado: 'enviado', estadoSii: null, glosaSii: null, consultadoSiiEn: null });
  });

  it('una falla de red responde 503 y no modifica nada', async () => {
    const doc = crearDoc();
    const { servicio, clientes, responder } = crearServicio([doc]);
    responder(() => Promise.reject(new SiiRedError('sin red')));
    const e = await servicio.consultarYAplicar(doc, empresa, clientes).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProblemaHttp);
    expect((e as ProblemaHttp).getStatus()).toBe(503);
    expect(doc.estadoSii).toBeNull();
  });

  it('DNK no cambia el estado, se guarda en estado_sii y devuelve advertencia', async () => {
    const doc = crearDoc();
    const { servicio, clientes, responder } = crearServicio([doc]);
    responder(() => Promise.resolve({ estado: 'DNK', glosa: 'DTE Recibido', cabecera: {} }));
    const r = await servicio.consultarYAplicar(doc, empresa, clientes);
    expect(r.advertencia).toContain('no coinciden');
    expect(doc).toMatchObject({ estado: 'enviado', estadoSii: 'DNK', glosaSii: 'DTE Recibido' });
  });

  it('no degrada aceptado_con_reparos con DOK', async () => {
    const doc = crearDoc({ estado: 'aceptado_con_reparos' });
    const { servicio, clientes } = crearServicio([doc]);
    await servicio.consultarYAplicar(doc, empresa, clientes);
    expect(doc).toMatchObject({ estado: 'aceptado_con_reparos', estadoSii: 'DOK' });
  });

  it('exigirEnviado rechaza emitido y encolado con 409', () => {
    const { servicio } = crearServicio([]);
    for (const estado of ['emitido', 'encolado'] as const) {
      expect(() => servicio.exigirEnviado(crearDoc({ estado }))).toThrow(
        expect.objectContaining({ code: 'ESTADO_INVALIDO' }),
      );
    }
    expect(() => servicio.exigirEnviado(crearDoc({ estado: 'enviado' }))).not.toThrow();
  });

  it('consultarVarios no aborta si uno falla y respeta la concurrencia máxima', async () => {
    const docs = Array.from({ length: 8 }, (_, i) => crearDoc({ id: `d${i}`, folio: i + 1 }));
    docs[2].estado = 'emitido';
    const { servicio, clientes, responder } = crearServicio(docs);
    let activas = 0;
    let maxActivas = 0;
    responder(async () => {
      activas++;
      maxActivas = Math.max(maxActivas, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas--;
      return { estado: 'DOK', glosa: '', cabecera: {} };
    });
    const r = await servicio.consultarVarios(docs, empresa, clientes);
    expect(r.size).toBe(8);
    expect(r.get('d2')?.error?.code).toBe('ESTADO_INVALIDO');
    expect(r.get('d0')?.resultado?.estadoSii).toBe('DOK');
    expect(maxActivas).toBeLessThanOrEqual(3);
    expect(maxActivas).toBeGreaterThan(1);
  });
});
