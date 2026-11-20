import { describe, expect, it } from 'vitest';
import {
  detectarImagen,
  normalizarUnidadSii,
  resolverUrlVerificacion,
  validarPlantillaUrl,
} from './opciones-pdf.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('detectarImagen', () => {
  it('reconoce PNG y JPEG por firma de bytes', () => {
    expect(detectarImagen(PNG_1X1)).toBe('image/png');
    expect(detectarImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('image/jpeg');
  });

  it('rechaza lo demás aunque se llame .png', () => {
    expect(detectarImagen(Buffer.from('GIF89a....'))).toBeNull();
    expect(detectarImagen(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectarImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectarImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // firma PNG incompleta
    expect(detectarImagen(Buffer.alloc(0))).toBeNull();
  });
});

describe('normalizarUnidadSii', () => {
  it('pasa a mayúsculas y recorta/compacta espacios', () => {
    expect(normalizarUnidadSii('  santiago   centro ')).toBe('SANTIAGO CENTRO');
    expect(normalizarUnidadSii('   ')).toBeNull();
    expect(normalizarUnidadSii(null)).toBeNull();
    expect(normalizarUnidadSii(undefined)).toBeNull();
  });
});

describe('plantilla de URL de verificación', () => {
  const v = { id: '0b0f-1', tipo: 33, folio: 15, rutEmisor: '76086428-5' };

  it('reemplaza todos los marcadores con valores codificados', () => {
    expect(
      resolverUrlVerificacion('https://x.cl/v/{rutEmisor}/{tipo}/{folio}?id={id}&otra={id}', v),
    ).toBe('https://x.cl/v/76086428-5/33/15?id=0b0f-1&otra=0b0f-1');
    expect(resolverUrlVerificacion('https://x.cl/{id}', { ...v, id: 'a b/c&d' })).toBe('https://x.cl/a%20b%2Fc%26d');
  });

  it('sin marcadores devuelve la URL tal cual', () => {
    expect(resolverUrlVerificacion('https://x.cl/consulta', v)).toBe('https://x.cl/consulta');
  });

  it('valida esquema, marcadores y llaves', () => {
    expect(validarPlantillaUrl('https://x.cl/{id}')).toBeNull();
    expect(validarPlantillaUrl('http://x.cl/{rutEmisor}/{tipo}/{folio}')).toBeNull();
    expect(validarPlantillaUrl('ftp://x.cl/{id}')).toMatch(/http/);
    expect(validarPlantillaUrl('javascript:alert(1)')).not.toBeNull();
    expect(validarPlantillaUrl('x.cl/{id}')).not.toBeNull();
    expect(validarPlantillaUrl('https://x.cl/{otro}')).toMatch(/desconocido/);
    expect(validarPlantillaUrl('https://x.cl/{id')).toMatch(/llaves/);
  });
});
