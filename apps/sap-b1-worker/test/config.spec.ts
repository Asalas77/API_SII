import { describe, expect, it } from 'vitest';
import { ErrorConfig, leerConfig } from '../src/config.js';

const base = {
  SL_URL: 'https://b1.local:50000/',
  SL_COMPANY_DB: 'SBO',
  SL_USER: 'manager',
  SL_PASSWORD: 'x-secreta',
  API_KEY: 'sk_test_abc',
  EMPRESA_RUT: '76.086.428-5',
};

describe('configuración', () => {
  it('aplica valores por defecto y normaliza', () => {
    const c = leerConfig(base);
    expect(c.sl.url).toBe('https://b1.local:50000');
    expect(c.sl.version).toBe('v2');
    expect(c.api.url).toBe('http://localhost:3000');
    expect(c.api.rutEmpresa).toBe('76086428-5');
    expect(c.intervaloSegundos).toBe(30);
    expect(c.conciliacionMinutos).toBe(60);
    expect(c.concurrencia).toBe(2);
    expect(c.enviarAutomaticamente).toBe(true);
    expect(c.b1.codigosExentos).toEqual(['IVA_EXE', 'EXE']);
  });

  it('acumula todos los errores', () => {
    try {
      leerConfig({ SL_VERSION: 'v9', EMPRESA_RUT: '76086428-0', CONCURRENCIA: '0' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorConfig);
      const m = (e as Error).message;
      for (const campo of ['SL_URL', 'SL_COMPANY_DB', 'SL_USER', 'SL_PASSWORD', 'API_KEY', 'SL_VERSION', 'EMPRESA_RUT', 'CONCURRENCIA']) {
        expect(m).toContain(campo);
      }
    }
  });

  it('dry-run de UDFs no exige credenciales', () => {
    expect(() => leerConfig({}, { requiereSl: false, requiereApi: false })).not.toThrow();
  });

  it('exportación: moneda local y glosas de moneda del SII', () => {
    const c = leerConfig({ ...base, B1_MONEDA_LOCAL: 'clp', B1_MONEDAS_SII: 'brl=otras monedas, ARS=PESO' });
    expect(c.b1.monedaLocal).toBe('CLP');
    expect(c.b1.monedasSii).toEqual({ BRL: 'OTRAS MONEDAS', ARS: 'PESO' });
    expect(leerConfig(base).b1.monedasSii).toEqual({});
    expect(() => leerConfig({ ...base, B1_MONEDAS_SII: 'BRL' })).toThrow(/CODIGO=GLOSA/);
  });
});
