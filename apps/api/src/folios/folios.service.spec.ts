import type { DataSource } from 'typeorm';
import { CafInvalidoError } from './folios.errors.js';
import { aFechaSql, FoliosService } from './folios.service.js';

describe('aFechaSql', () => {
  it('formatea YYYY-MM-DD con ceros', () => {
    expect(aFechaSql(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(aFechaSql(new Date(2026, 10, 14))).toBe('2026-11-14');
  });
});

describe('FoliosService.registrarCaf (validación de rango)', () => {
  const transaction = vi.fn();
  const service = new FoliosService({ transaction } as unknown as DataSource);
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
    expect(transaction).not.toHaveBeenCalled();
  });
});
