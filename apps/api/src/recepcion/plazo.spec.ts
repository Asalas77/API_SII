import { calcularPlazoReclamo, DIAS_PLAZO_RECLAMO, diasRestantes, plazoDeReclamo, plazoVencido } from './plazo.js';

describe('plazo de reclamo (Ley 20.956)', () => {
  const recepcion = new Date('2026-03-01T15:00:00.000Z');

  it('son 8 días corridos exactos desde la recepción', () => {
    expect(DIAS_PLAZO_RECLAMO).toBe(8);
    expect(calcularPlazoReclamo(recepcion).toISOString()).toBe('2026-03-09T15:00:00.000Z');
  });

  it('cuenta días corridos: los fines de semana también corren', () => {
    // 2026-03-06 es viernes: el plazo vence el sábado 14.
    expect(calcularPlazoReclamo(new Date('2026-03-06T10:00:00.000Z')).toISOString()).toBe('2026-03-14T10:00:00.000Z');
  });

  it('vence recién después de cumplidas las 192 horas', () => {
    const hasta = calcularPlazoReclamo(recepcion);
    expect(plazoVencido(hasta, new Date('2026-03-09T14:59:59.999Z'))).toBe(false);
    expect(plazoVencido(hasta, new Date('2026-03-09T15:00:00.000Z'))).toBe(false);
    expect(plazoVencido(hasta, new Date('2026-03-09T15:00:00.001Z'))).toBe(true);
  });

  it('días restantes: decimales y nunca negativos', () => {
    const hasta = calcularPlazoReclamo(recepcion);
    expect(diasRestantes(hasta, recepcion)).toBeCloseTo(8, 10);
    expect(diasRestantes(hasta, new Date('2026-03-05T15:00:00.000Z'))).toBeCloseTo(4, 10);
    expect(diasRestantes(hasta, new Date('2026-03-20T00:00:00.000Z'))).toBe(0);
  });

  it('sin la fecha del SII se estima con la recepción propia y no queda confirmado', () => {
    const p = plazoDeReclamo(recepcion);
    expect(p).toMatchObject({ confirmadoSii: false });
    expect(p.desde).toEqual(recepcion);
    expect(p.hasta.toISOString()).toBe('2026-03-09T15:00:00.000Z');
  });

  it('con la fecha real del SII manda esa (el emisor suele enviar por correo después de enviar al SII)', () => {
    const sii = new Date('2026-02-27T12:00:00.000Z');
    const p = plazoDeReclamo(recepcion, sii);
    expect(p.confirmadoSii).toBe(true);
    expect(p.desde).toEqual(sii);
    expect(p.hasta.toISOString()).toBe('2026-03-07T12:00:00.000Z');
    expect(p.hasta.getTime()).toBeLessThan(plazoDeReclamo(recepcion).hasta.getTime());
  });

  it('la fecha del SII nula equivale a no conocerla', () => {
    expect(plazoDeReclamo(recepcion, null).confirmadoSii).toBe(false);
  });
});
