import type { Empresa } from '../empresas/entities/empresa.entity.js';
import type { EmitirDocumentoDto } from './documentos.dto.js';
import { armarDocumento, huellaSolicitud } from './documentos.service.js';

const empresa = {
  id: 'e1',
  rut: 76086428,
  dv: '5',
  razonSocial: 'EMPRESA SPA',
  giro: 'Servicios',
  actecos: [620200],
  direccion: 'Calle 1',
  comuna: 'Santiago',
  ciudad: 'Santiago',
  codigoSucursalSii: null,
  telefono: null,
  correoIntercambio: 'dte@empresa.cl',
  rutProveedorSoftware: 11111111,
  dvProveedorSoftware: '1',
} as unknown as Empresa;

describe('huellaSolicitud', () => {
  it('no depende del orden de las claves y distingue cuerpos', () => {
    expect(huellaSolicitud({ a: 1, b: { c: 2, d: 3 } })).toBe(huellaSolicitud({ b: { d: 3, c: 2 }, a: 1 }));
    expect(huellaSolicitud({ a: 1 })).not.toBe(huellaSolicitud({ a: 2 }));
  });
});

describe('armarDocumento', () => {
  const factura: EmitirDocumentoDto = {
    idDoc: { tipoDte: 33 },
    receptor: { rut: '12345678-5', razonSocial: 'CLIENTE' },
    detalle: [{ nombre: 'X', cantidad: 1, precioUnitario: 100 }],
    referencias: [{ tipoDocRef: '801', folioRef: 5 }],
  };

  it('toma el emisor de la empresa, parte el RUT y completa fechaRef', () => {
    const d = armarDocumento(empresa, factura, 9, '2026-11-18');
    expect(d.idDoc).toMatchObject({ folio: 9, fechaEmision: '2026-11-18' });
    expect(d.emisor).toMatchObject({ rut: '76086428', dv: '5', actecos: [620200], correo: 'dte@empresa.cl' });
    expect(d.receptor).toMatchObject({ rut: '12345678', dv: '5' });
    expect(d.referencias?.[0].fechaRef).toBe('2026-11-18');
    expect(d.proveedorSoftware).toBeUndefined();
  });

  it('boleta: sin receptor usa consumidor final, sin acteco y con proveedor de software', () => {
    const d = armarDocumento(empresa, { idDoc: { tipoDte: 39 }, detalle: factura.detalle }, 1, '2026-11-18');
    expect(d.receptor).toMatchObject({ rut: '66666666', dv: '6' });
    expect(d.emisor.actecos).toBeUndefined();
    expect(d.proveedorSoftware).toEqual({ rut: '11111111', dv: '1' });
  });

  it('factura sin receptor es un error 422', () => {
    expect(() =>
      armarDocumento(empresa, { ...factura, receptor: undefined }, 1, '2026-11-18'),
    ).toThrow(expect.objectContaining({ code: 'DOCUMENTO_INVALIDO' }));
  });
});
