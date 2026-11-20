import type { DataSource } from 'typeorm';
import { comoSistema, conContextoEmpresa, ContextoEmpresaFaltanteError } from './contexto-empresa.js';
import { EjecutorEmpresa } from './ejecutor-empresa.js';

function crear() {
  const query = vi.fn().mockResolvedValue([]);
  const em = { query, queryRunner: { isTransactionActive: true } };
  const transaction = vi.fn((fn: (e: unknown) => unknown) => fn(em));
  const ejecutor = new EjecutorEmpresa({ transaction } as unknown as DataSource);
  return { ejecutor, query, transaction };
}

describe('EjecutorEmpresa', () => {
  it('falla ruidosamente sin contexto de empresa', async () => {
    const { ejecutor, transaction } = crear();
    await expect(ejecutor.ejecutar(async () => 1)).rejects.toBeInstanceOf(ContextoEmpresaFaltanteError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('fija los GUC locales a la transacción con el contexto vigente', async () => {
    const { ejecutor, query } = crear();
    await conContextoEmpresa({ todasLasEmpresas: false, ruts: ['76086428-5', 'x,y'] }, () =>
      ejecutor.ejecutar(async () => 1),
    );
    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain('set_config');
    expect(sql).not.toContain('false');
    expect(params).toEqual(['off', '76086428-5']); // descarta valores que no son RUT normalizados
  });

  it('modo sistema y reutilización de la transacción anidada', async () => {
    const { ejecutor, query, transaction } = crear();
    await comoSistema(() =>
      ejecutor.ejecutar(async () => {
        await ejecutor.ejecutar(async () => 1);
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0] as [string, string[]])[1][0]).toBe('on');
  });

  it('ampliarRuts suma el RUT solo a esa ejecución', async () => {
    const { ejecutor, query } = crear();
    await conContextoEmpresa({ todasLasEmpresas: false, ruts: ['1-9'] }, () =>
      ejecutor.ejecutar(async () => 1, { ampliarRuts: ['2-7'] }),
    );
    expect((query.mock.calls[0] as [string, string[]])[1][1]).toBe('1-9,2-7');
  });
});
