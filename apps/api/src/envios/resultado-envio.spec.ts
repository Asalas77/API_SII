import { resolverResultado, resumenDeCuerpo } from './resultado-envio.js';

const docs = [
  { documentoId: 'a', tipoDte: 39, folio: 1 },
  { documentoId: 'b', tipoDte: 39, folio: 2 },
  { documentoId: 'c', tipoDte: 39, folio: 3 },
];

describe('resolverResultado', () => {
  it('rechaza todos los documentos si el envío se rechaza', () => {
    const r = resolverResultado({ estado: 'RSC', glosa: 'schema', esFinal: true, documentos: docs });
    expect(r.every((x) => x.estado === 'rechazado')).toBe(true);
  });

  it('no cambia nada mientras el envío no es final', () => {
    const r = resolverResultado({ estado: 'REC', glosa: 'recibido', esFinal: false, documentos: docs });
    expect(r.every((x) => x.estado === null)).toBe(true);
  });

  it('boletas: usa detalle_rep_rech y acepta las no listadas', () => {
    const r = resolverResultado({
      estado: 'EPR',
      glosa: 'ok',
      esFinal: true,
      documentos: docs,
      detalleBoleta: [
        { tipo: 39, folio: 2, estado: 'RPR', error: [{ codigo: 1 }] },
        { tipo: 39, folio: 3, estado: 'RCH' },
      ],
    });
    expect(r.map((x) => x.estado)).toEqual(['aceptado', 'aceptado_con_reparos', 'rechazado']);
    expect(r[1].reparos).toEqual([{ codigo: 1 }]);
  });

  it('boletas: RPR sin detalle deja todo con reparos', () => {
    const r = resolverResultado({ estado: 'RPR', glosa: 'rep', esFinal: true, documentos: docs, detalleBoleta: [] });
    expect(r.every((x) => x.estado === 'aceptado_con_reparos')).toBe(true);
  });

  it('DTE: usa los conteos por tipo y deja el resultado mixto sin cambio', () => {
    const d = [{ documentoId: 'x', tipoDte: 33, folio: 1 }];
    const base = { estado: 'EPR', glosa: 'ok', esFinal: true, documentos: d };
    const res = (aceptados: number, reparos: number, rechazados: number) =>
      resolverResultado({
        ...base,
        resumenDte: [{ tipo: 33, informados: aceptados + reparos + rechazados, aceptados, reparos, rechazados }],
      })[0].estado;
    expect(res(1, 0, 0)).toBe('aceptado');
    expect(res(0, 1, 0)).toBe('aceptado_con_reparos');
    expect(res(0, 0, 1)).toBe('rechazado');
    expect(res(1, 0, 1)).toBeNull();
  });
});

describe('resumenDeCuerpo', () => {
  it('acepta objeto o lista con números como texto', () => {
    const o = { TIPO_DOCTO: '33', INFORMADOS: '2', ACEPTADOS: '1', RECHAZADOS: '1', REPAROS: '0' };
    expect(resumenDeCuerpo(o)).toEqual([{ tipo: 33, informados: 2, aceptados: 1, rechazados: 1, reparos: 0 }]);
    expect(resumenDeCuerpo([o, o])).toHaveLength(2);
    expect(resumenDeCuerpo(undefined)).toEqual([]);
  });
});
