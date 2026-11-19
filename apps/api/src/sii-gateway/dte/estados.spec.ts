import { clasificarEstadoDte, clasificarEstadoEnvioDte } from './estados.js';

describe('clasificarEstadoEnvioDte', () => {
  it.each(['EPR', 'RPR', 'RCH', 'RCT', 'RFR', 'RSC', 'RCO', 'RPT'])('%s es final', (e) => {
    const c = clasificarEstadoEnvioDte(e);
    expect(c.esFinal).toBe(true);
    expect(c.descripcionEstado).not.toMatch(/desconocido/);
  });

  it.each(['REC', 'SOK', 'CRT', 'FOK', 'PDR', 'PRD'])('%s no es final', (e) => {
    expect(clasificarEstadoEnvioDte(e).esFinal).toBe(false);
  });

  it('describe los estados del PDF', () => {
    expect(clasificarEstadoEnvioDte('RSC').descripcionEstado).toBe('Rechazado por error en schema');
    expect(clasificarEstadoEnvioDte('EPR').descripcionEstado).toBe('Envío procesado');
    expect(clasificarEstadoEnvioDte('rfr').descripcionEstado).toBe('Rechazado por error en firma');
  });

  it('errores de consulta y desconocidos no son finales', () => {
    expect(clasificarEstadoEnvioDte('-11')).toMatchObject({ esFinal: false });
    expect(clasificarEstadoEnvioDte('-3').descripcionEstado).toMatch(/RUT del usuario/);
    expect(clasificarEstadoEnvioDte('002').descripcionEstado).toMatch(/Token inactivo/);
    expect(clasificarEstadoEnvioDte('ZZZ')).toEqual({ descripcionEstado: 'Estado desconocido: ZZZ', esFinal: false });
  });
});

describe('clasificarEstadoDte', () => {
  it('DOK/DNK/FAN/ANC son finales; FAU no', () => {
    for (const e of ['DOK', 'DNK', 'FNA', 'FAN', 'EMP', 'TMD', 'TMC', 'MMD', 'MMC', 'AND', 'ANC']) {
      expect(clasificarEstadoDte(e).esFinal).toBe(true);
    }
    expect(clasificarEstadoDte('FAU')).toEqual({ descripcionEstado: 'Documento no recibido por el SII', esFinal: false });
  });
});
