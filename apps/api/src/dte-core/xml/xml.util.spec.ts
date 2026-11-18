import {
  aIso88591, calcularDv, desdeIso88591, escaparXml, formatearFechaSii, formatearRut,
  formatearTimestampSii, separarRut, validarDv, validarRut,
} from './xml.util.js';

describe('xml.util', () => {
  it('escapa caracteres especiales', () => {
    expect(escaparXml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
  });

  it('codifica a ISO-8859-1 con declaración y reemplaza lo no representable', () => {
    const buf = aIso88591('<?xml version="1.0" encoding="UTF-8"?><a>ñÁ “x” 日</a>');
    expect(buf.subarray(0, 44).toString('latin1')).toBe('<?xml version="1.0" encoding="ISO-8859-1"?>\n');
    expect(buf.includes(0xf1)).toBe(true); // ñ en un solo byte
    const texto = desdeIso88591(buf);
    expect(texto).toContain('<a>ñÁ "x" ?</a>');
    expect(texto.match(/<\?xml/g)).toHaveLength(1);
  });

  it('formatea fecha y timestamp en hora de Chile', () => {
    // 2026-01-15 02:30 UTC = 2026-01-14 23:30 en Chile (UTC-3 verano)
    const d = new Date('2026-01-15T02:30:05Z');
    expect(formatearFechaSii(d)).toBe('2026-01-14');
    expect(formatearTimestampSii(d)).toBe('2026-01-14T23:30:05');
    // invierno UTC-4
    expect(formatearTimestampSii(new Date('2026-07-01T04:00:00Z'))).toBe('2026-07-01T00:00:00');
  });

  it('maneja RUT', () => {
    expect(formatearRut(12345678, '9')).toBe('12345678-9');
    expect(calcularDv(12345678)).toBe('5');
    expect(validarDv(12345678, '5')).toBe(true);
    expect(validarDv(12345678, '9')).toBe(false);
    expect(calcularDv(76086428)).toBe('5');
    expect(calcularDv(10000013)).toBe('K');
    expect(validarRut('12.345.678-5')).toBe(true);
    expect(validarRut('12345678-4')).toBe(false);
    expect(separarRut('12345678-k')).toEqual({ numero: '12345678', dv: 'K' });
    expect(separarRut('xx')).toBeUndefined();
  });
});
