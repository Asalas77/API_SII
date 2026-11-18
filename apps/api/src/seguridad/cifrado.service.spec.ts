import { randomBytes } from 'node:crypto';
import { CifradoService } from './cifrado.service.js';

const crear = (clave: Buffer) =>
  new CifradoService({ certificadosMasterKey: clave as Buffer<ArrayBuffer> });

describe('CifradoService', () => {
  const clave = randomBytes(32);

  it('ida y vuelta', () => {
    const s = crear(clave);
    const plano = Buffer.from('contenido del PFX \u0000ÿ');
    const blob = s.cifrar(plano);
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 12 + 16 + plano.length);
    expect(blob.subarray(29).equals(plano)).toBe(false);
    expect(s.descifrar(blob).equals(plano)).toBe(true);
  });

  it('usa un IV distinto en cada cifrado', () => {
    const s = crear(clave);
    const p = Buffer.from('x');
    expect(s.cifrar(p).equals(s.cifrar(p))).toBe(false);
  });

  it('falla si el blob fue alterado', () => {
    const s = crear(clave);
    const blob = s.cifrar(Buffer.from('secreto'));
    for (const pos of [1, 13, blob.length - 1]) {
      const malo = Buffer.from(blob);
      malo[pos] ^= 0xff;
      expect(() => s.descifrar(malo)).toThrow();
    }
  });

  it('falla con versión desconocida o blob corto', () => {
    const s = crear(clave);
    const blob = s.cifrar(Buffer.from('a'));
    blob[0] = 2;
    expect(() => s.descifrar(blob)).toThrow(/Versión/);
    expect(() => s.descifrar(Buffer.alloc(5))).toThrow(/corto/);
  });

  it('falla con una clave distinta', () => {
    const blob = crear(clave).cifrar(Buffer.from('secreto'));
    expect(() => crear(randomBytes(32)).descifrar(blob)).toThrow();
  });

  it('rechaza claves que no son de 32 bytes', () => {
    expect(() => crear(randomBytes(16))).toThrow(/32 bytes/);
  });
});
