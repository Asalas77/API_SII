import { createPrivateKey, createSign } from 'node:crypto';
import { generarPfxPrueba } from '../testing/testing.js';
import { cargarPfx } from './certificado.js';

describe('cargarPfx', () => {
  it('carga certificado, clave y RUT del SAN', () => {
    const pfx = generarPfxPrueba('clave', { nombre: 'Juan Perez', rut: '12345678-9' });
    const c = cargarPfx(pfx, 'clave');
    expect(c.sujeto).toBe('Juan Perez');
    expect(c.rutFirmante).toBe('12345678-9');
    expect(c.certificadoPem).toContain('BEGIN CERTIFICATE');
    expect(c.vigente()).toBe(true);
    expect(c.vigente(new Date(c.validoHasta.getTime() + 1000))).toBe(false);
    expect(c.vigente(new Date(c.validoDesde.getTime() - 1000))).toBe(false);
    const k = createPrivateKey(c.clavePrivadaPem);
    expect(createSign('sha1').update('x').sign(k).length).toBe(256);
  });

  it('sin SAN el RUT queda undefined y no falla', () => {
    const c = cargarPfx(generarPfxPrueba('p'), 'p');
    expect(c.rutFirmante).toBeUndefined();
  });

  it('falla con contraseña incorrecta o archivo inválido', () => {
    expect(() => cargarPfx(generarPfxPrueba('a'), 'b')).toThrow(/PFX/);
    expect(() => cargarPfx(Buffer.from('basura'), 'a')).toThrow(/PFX/);
  });
});
