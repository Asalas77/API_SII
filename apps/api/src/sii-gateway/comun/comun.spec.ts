import {
  SiiAutenticacionError,
  SiiError,
  SiiLimiteExcedidoError,
  SiiNoEncontradoError,
  SiiPeticionInvalidaError,
  SiiServidorError,
  errorDesdeHttp,
} from './errores.js';
import { GestorToken, conReintentos, normalizarRut } from './http.js';
import { almacenNuevo } from './testing.js';
import { buscarTexto, codificarXml, comoArreglo, escaparXml, parsearXml } from './xml.js';

describe('errorDesdeHttp', () => {
  it.each([
    [400, SiiPeticionInvalidaError],
    [401, SiiAutenticacionError],
    [404, SiiNoEncontradoError],
    [405, SiiLimiteExcedidoError],
    [500, SiiServidorError],
    [503, SiiServidorError],
    [418, SiiError],
  ])('HTTP %i', (status, clase) => {
    const e = errorDesdeHttp(status, 'texto', 'ctx');
    expect(e).toBeInstanceOf(clase);
    expect(e).toBeInstanceOf(SiiError);
    expect(e.statusHttp).toBe(status);
    expect(e.name).toBe(clase.name);
  });
});

describe('conReintentos', () => {
  it('no reintenta errores no reintentables', async () => {
    const op = vi.fn().mockRejectedValue(new SiiPeticionInvalidaError('x'));
    await expect(conReintentos(op, { esperar: async () => {} })).rejects.toBeInstanceOf(SiiPeticionInvalidaError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('respeta maxIntentos y factor', async () => {
    const op = vi.fn().mockRejectedValue(new SiiServidorError('x'));
    const esperar = vi.fn(async (_ms: number) => {});
    await expect(conReintentos(op, { maxIntentos: 4, esperaBaseMs: 10, factor: 3, esperar })).rejects.toBeInstanceOf(SiiServidorError);
    expect(op).toHaveBeenCalledTimes(4);
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([10, 30, 90]);
  });
});

describe('GestorToken', () => {
  it('deduplica generaciones concurrentes', async () => {
    const g = new GestorToken('dte', 'certificacion', '1', { almacen: almacenNuevo() });
    const generar = vi.fn(async () => 'T');
    const [a, b] = await Promise.all([g.obtener(generar), g.obtener(generar)]);
    expect([a, b]).toEqual(['T', 'T']);
    expect(generar).toHaveBeenCalledTimes(1);
  });

  it('separa por tipo, ambiente y rut', async () => {
    const almacen = almacenNuevo();
    const a = new GestorToken('dte', 'certificacion', '1', { almacen });
    const b = new GestorToken('boleta', 'certificacion', '1', { almacen });
    await a.obtener(async () => 'A');
    expect(await b.obtener(async () => 'B')).toBe('B');
  });
});

describe('xml', () => {
  it('normaliza RUT', () => expect(normalizarRut('76.123.456')).toBe('76123456'));
  it('escapa caracteres', () => expect(escaparXml(`<a b="1">&'`)).toBe('&lt;a b=&quot;1&quot;&gt;&amp;&apos;'));
  it('parsea sin prefijos y conserva ceros', () => {
    const d = parsearXml('<SII:R xmlns:SII="x"><ESTADO>00</ESTADO></SII:R>');
    expect(buscarTexto(d, 'ESTADO')).toBe('00');
  });
  it('comoArreglo', () => {
    expect(comoArreglo('a')).toEqual(['a']);
    expect(comoArreglo(['a', 'b'])).toEqual(['a', 'b']);
    expect(comoArreglo(undefined)).toEqual([]);
  });
  it('codifica latin1 o utf8 según el prólogo', () => {
    expect(Array.from(codificarXml('<?xml version="1.0" encoding="ISO-8859-1"?>ñ')).pop()).toBe(0xf1);
    expect(Array.from(codificarXml('<?xml version="1.0" encoding="UTF-8"?>ñ')).slice(-2)).toEqual([0xc3, 0xb1]);
  });
});
