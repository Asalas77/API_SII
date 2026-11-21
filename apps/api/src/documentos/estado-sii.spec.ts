import { esErrorDeConsulta, mapearEstadoSii } from './estado-sii.js';

describe('mapearEstadoSii', () => {
  it.each(['DOK', 'TMD', 'TMC', 'MMD', 'MMC', 'AND', 'ANC'])('%s: enviado pasa a aceptado', (codigo) => {
    expect(mapearEstadoSii(codigo, 'enviado')).toEqual({ estado: 'aceptado' });
  });

  it.each(['DOK', 'TMD', 'TMC', 'MMD', 'MMC', 'AND', 'ANC'])(
    '%s: no degrada aceptado_con_reparos ni cambia aceptado/anulado',
    (codigo) => {
      expect(mapearEstadoSii(codigo, 'aceptado_con_reparos').estado).toBeNull();
      expect(mapearEstadoSii(codigo, 'aceptado').estado).toBeNull();
      expect(mapearEstadoSii(codigo, 'anulado').estado).toBeNull();
    },
  );

  it('DOK sobre un documento rechazado no lo pisa y advierte', () => {
    const r = mapearEstadoSii('DOK', 'rechazado');
    expect(r.estado).toBeNull();
    expect(r.advertencia).toContain('rechazado');
  });

  it('AND/ANC no anulan el documento (la anulación queda solo en estado_sii)', () => {
    expect(mapearEstadoSii('ANC', 'enviado').estado).toBe('aceptado');
    expect(mapearEstadoSii('AND', 'aceptado').estado).toBeNull();
  });

  it('FAN anula los documentos enviados o aceptados', () => {
    for (const e of ['enviado', 'aceptado', 'aceptado_con_reparos'] as const) {
      expect(mapearEstadoSii('FAN', e).estado).toBe('anulado');
    }
    expect(mapearEstadoSii('FAN', 'rechazado').estado).toBeNull();
  });

  it.each(['FNA', 'EMP'])('%s: enviado pasa a rechazado', (codigo) => {
    expect(mapearEstadoSii(codigo, 'enviado')).toEqual({ estado: 'rechazado' });
    expect(mapearEstadoSii(codigo, 'rechazado').estado).toBeNull();
    // No se rechaza un documento ya aceptado por el envío: se advierte.
    const r = mapearEstadoSii(codigo, 'aceptado');
    expect(r.estado).toBeNull();
    expect(r.advertencia).toBeDefined();
  });

  it('DNK no cambia el estado y advierte que los datos no coinciden', () => {
    const r = mapearEstadoSii('DNK', 'enviado');
    expect(r.estado).toBeNull();
    expect(r.advertencia).toContain('no coinciden');
  });

  it('FAU no cambia el estado', () => {
    const r = mapearEstadoSii('FAU', 'enviado');
    expect(r.estado).toBeNull();
    expect(r.advertencia).toBeDefined();
  });

  it('es insensible a mayúsculas y espacios', () => {
    expect(mapearEstadoSii(' dok ', 'enviado').estado).toBe('aceptado');
  });
});

describe('esErrorDeConsulta', () => {
  it('distingue estados de documento de errores de consulta', () => {
    for (const c of ['DOK', 'DNK', 'FAU', 'FNA', 'FAN', 'EMP', 'TMD', 'TMC', 'MMD', 'MMC', 'AND', 'ANC']) {
      expect(esErrorDeConsulta(c)).toBe(false);
    }
    for (const c of ['-1', '-4', '-14', '001', '002', '003', 'XYZ', '']) {
      expect(esErrorDeConsulta(c)).toBe(true);
    }
  });
});
