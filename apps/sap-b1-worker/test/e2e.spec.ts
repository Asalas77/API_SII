import { describe, expect, it } from 'vitest';
import { ClienteApiSii } from '../src/api-sii.js';
import { leerConfig } from '../src/config.js';
import { crearLogger } from '../src/log.js';
import { ClienteServiceLayer } from '../src/service-layer.js';
import { Worker } from '../src/worker.js';
import { mapearDocumento } from '../src/mapeador.js';
import { ENTIDADES, type EntidadB1 } from '../src/tipos-b1.js';
import { facturaAfecta, facturaExenta, linea, notaCredito, socio } from './fixtures.js';
import { ServiceLayerSimulado } from './sl-simulado.js';

/**
 * Prueba de integración OPCIONAL contra la API real (no corre por defecto).
 *
 *   API_SII_E2E=1 API_URL=http://localhost:3000 API_KEY=sk_test_... EMPRESA_RUT=76086428-5 npm run test:e2e
 *
 * Requisitos: la API en marcha con la empresa creada (scripts/preparar-api-real.mjs lo deja todo listo),
 * CAF de 33, 34 y 61, certificado activo y una API key con documentos.emitir/leer y envios.crear/leer. Service Layer sigue siendo el
 * simulado; solo la API es real. Emite UNA factura de prueba y consume un folio real del ambiente.
 * No se envía al SII (ENVIAR_AUTOMATICAMENTE=false).
 */
describe.skipIf(process.env['API_SII_E2E'] !== '1')('e2e contra la API real', () => {
  it('emite 33, 34 y nota de crédito 61 con referencia; la repetición es idempotente', async () => {
    const sl = new ServiceLayerSimulado();
    await sl.iniciar();
    try {
      const cfg = leerConfig({
        SL_URL: sl.url,
        SL_COMPANY_DB: sl.credenciales.companyDb,
        SL_USER: sl.credenciales.usuario,
        SL_PASSWORD: sl.credenciales.password,
        API_URL: process.env['API_URL'] ?? 'http://localhost:3000',
        API_KEY: process.env['API_KEY'] ?? '',
        EMPRESA_RUT: process.env['EMPRESA_RUT'] ?? '',
        ENVIAR_AUTOMATICAMENTE: 'false',
      });
      const log = crearLogger({ secretos: [cfg.api.apiKey] });
      const cliente = new ClienteServiceLayer(cfg.sl, log);
      const api = new ClienteApiSii(cfg.api);
      const worker = new Worker(cfg, cliente, api, log);

      // DocEntry únicos por ejecución => Idempotency-Key distintas.
      const n = Math.floor(Date.now() / 1000) % 1_000_000;
      const hoy = new Date().toISOString().slice(0, 10);
      sl.socios.set('C20000', socio() as unknown as Record<string, unknown>);
      sl.agregarDoc('Invoices', { ...facturaAfecta(), DocEntry: n, DocDate: hoy, DocDueDate: hoy });
      sl.agregarDoc('Invoices', { ...facturaExenta(), DocEntry: n + 1, DocDate: hoy, DocDueDate: hoy });

      await worker.ciclo({ conciliar: true });
      const f33 = sl.doc('Invoices', n);
      const f34 = sl.doc('Invoices', n + 1);
      expect(f33['U_SII_Estado'], String(f33['U_SII_Glosa'])).toBe('EMITIDO');
      expect(f34['U_SII_Estado'], String(f34['U_SII_Glosa'])).toBe('EMITIDO');
      expect(f33['U_SII_TipoDTE']).toBe('33');
      expect(f34['U_SII_TipoDTE']).toBe('34');
      expect(String(f33['U_SII_DocId'])).toMatch(/^[0-9a-f-]{36}$/);

      // Nota de crédito que referencia la factura 33 (por BaseEntry).
      sl.agregarDoc('CreditNotes', { ...notaCredito(), DocEntry: n + 2, DocDate: hoy, DocDueDate: hoy, DocumentLines: [linea(0, { BaseType: 13, BaseEntry: n, BaseLine: 0 })] });
      await worker.ciclo({ conciliar: true });
      const nc = sl.doc('CreditNotes', n + 2);
      expect(nc['U_SII_Estado'], String(nc['U_SII_Glosa'])).toBe('EMITIDO');
      expect(nc['U_SII_TipoDTE']).toBe('61');

      // Repetición con la misma clave: 200 Idempotent-Replayed y mismo folio.
      const cuerpo = mapearDocumento(ENTIDADES[0] as EntidadB1, { ...facturaAfecta(), DocEntry: n, DocDate: hoy, DocDueDate: hoy }, {
        config: cfg.b1,
        socio: socio(),
        bases: new Map(),
      });
      if (!cuerpo.ok) throw new Error(cuerpo.errores.join(';'));
      const rep = await api.emitir(cfg.api.rutEmpresa, cuerpo.cuerpo, String(f33['U_SII_IdemKey']));
      expect(rep.repetido).toBe(true);
      expect(rep.documento.folio).toBe(f33['U_SII_Folio']);

      // Y por el worker: ENVIANDO con la misma clave no consume otro folio.
      const folio = f33['U_SII_Folio'];
      f33['U_SII_Estado'] = 'ENVIANDO';
      await worker.ciclo({ conciliar: true });
      expect(sl.doc('Invoices', n)['U_SII_Folio']).toBe(folio);
      expect(sl.doc('Invoices', n)['U_SII_Estado']).toBe('EMITIDO');
      await cliente.cerrarSesion();
    } finally {
      await sl.detener();
    }
  });
});
