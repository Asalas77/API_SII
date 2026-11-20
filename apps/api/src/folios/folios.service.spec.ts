import type { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { CafInvalidoError } from './folios.errors.js';
import type { CifradoService } from '../seguridad/cifrado.service.js';
import { aFechaSql, calcularVencimientoCaf, FoliosService } from './folios.service.js';

describe('aFechaSql', () => {
  it('formatea YYYY-MM-DD con ceros', () => {
    expect(aFechaSql(new Date('2026-01-05T15:00:00Z'))).toBe('2026-01-05');
    expect(aFechaSql(new Date('2026-11-14T15:00:00Z'))).toBe('2026-11-14');
  });

  it('usa America/Santiago, no la zona del servidor', () => {
    // 02:00Z de noviembre = 23:00 del día anterior en Santiago (UTC-3, horario de verano).
    expect(aFechaSql(new Date('2026-11-15T02:00:00Z'))).toBe('2026-11-14');
    // 02:00Z de julio = 22:00 del día anterior (UTC-4, horario de invierno).
    expect(aFechaSql(new Date('2026-07-15T02:00:00Z'))).toBe('2026-07-14');
  });
});

describe('calcularVencimientoCaf', () => {
  it('suma 6 meses solo en tipos con crédito fiscal', () => {
    expect(calcularVencimientoCaf(33, '2026-11-14')).toBe('2027-05-14');
    expect(calcularVencimientoCaf(61, '2026-08-31')).toBe('2027-02-28');
    expect(calcularVencimientoCaf(39, '2026-11-14')).toBeNull();
    expect(calcularVencimientoCaf(52, '2026-11-14')).toBeNull();
  });
});

describe('FoliosService.registrarCaf (validación de rango)', () => {
  const ejecutar = vi.fn();
  const service = new FoliosService(
    { ejecutar } as unknown as EjecutorEmpresa,
    {} as unknown as CifradoService,
  );
  const base = {
    tipoDte: 33,
    fechaAutorizacion: new Date(),
    xml: '<CAF/>',
  };

  it('rechaza rangos invertidos o no enteros sin tocar la base', async () => {
    await expect(
      service.registrarCaf('e', { ...base, folioDesde: 10, folioHasta: 5 }),
    ).rejects.toBeInstanceOf(CafInvalidoError);
    await expect(
      service.registrarCaf('e', { ...base, folioDesde: 0, folioHasta: 5 }),
    ).rejects.toBeInstanceOf(CafInvalidoError);
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe('FoliosService.registrarCaf (RUT del CAF)', () => {
  function crear(empresa: unknown) {
    const em = {
      findOne: vi.fn().mockResolvedValue(empresa),
      query: vi.fn(),
    };
    const ejecutor = {
      ejecutar: (fn: (em: unknown) => unknown) => fn(em),
    } as unknown as EjecutorEmpresa;
    return { service: new FoliosService(ejecutor, {} as CifradoService), em };
  }
  const caf = {
    tipoDte: 33,
    folioDesde: 1,
    folioHasta: 10,
    fechaAutorizacion: '2026-11-14',
    xml: '<CAF/>',
  };

  it('rechaza un CAF de otro RUT sin escribir', async () => {
    const { service, em } = crear({ id: 'e', rut: 76086428, dv: '5' });
    await expect(
      service.registrarCaf('e', { ...caf, rutEmisor: '11111111-1' }),
    ).rejects.toThrow(/pertenece al RUT 11111111-1/);
    expect(em.query).not.toHaveBeenCalled();
  });

  it('rechaza si la empresa no existe', async () => {
    const { service } = crear(null);
    await expect(
      service.registrarCaf('e', { ...caf, rutEmisor: '76086428-5' }),
    ).rejects.toBeInstanceOf(CafInvalidoError);
  });
});
