import { describe, expect, it } from 'vitest';
import { ClienteApiSii, ErrorApi, esErrorDefinitivo } from '../src/api-sii.js';

// Formas de respuesta observadas en la API real (apps/api) durante la verificación del contrato.
const problema422 = {
  type: 'https://api-sii.example/errores/documento-invalido',
  title: 'Documento inválido',
  status: 422,
  code: 'DOCUMENTO_INVALIDO',
  detail: 'El tipo 33 requiere al menos un ítem afecto; para ventas exentas use 34',
  requestId: '04a58015-5a52-4969-a927-2acc92627c0e',
};

function cliente(respuesta: () => Response) {
  const log: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    log.push({ url, init });
    return respuesta();
  }) as unknown as typeof fetch;
  return { api: new ClienteApiSii({ url: 'http://api.test', apiKey: 'k', rutEmpresa: '76086428-5', timeoutMs: 5000 }, f), log };
}

describe('contrato con la API real', () => {
  it('problem+json: código, detalle y clasificación definitiva', async () => {
    const { api } = cliente(() => new Response(JSON.stringify(problema422), { status: 422, headers: { 'Content-Type': 'application/problem+json' } }));
    const e = await api.emitir('76086428-5', { idDoc: { tipoDte: 33, fechaEmision: '2026-01-01' }, detalle: [] }, 'b1:76086428-5:13:1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(esErrorDefinitivo(e)).toBe(true);
    expect((e as ErrorApi).glosa()).toContain('DOCUMENTO_INVALIDO: El tipo 33 requiere');
  });

  it('502 SII_NO_DISPONIBLE al enviar es transitorio', async () => {
    const { api } = cliente(() => new Response(JSON.stringify({ status: 502, code: 'SII_NO_DISPONIBLE', detail: 'x' }), { status: 502 }));
    const e = await api.crearEnvio('76086428-5', ['a']).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect(esErrorDefinitivo(e)).toBe(false);
  });

  it('emitir: ruta, Idempotency-Key, Bearer y detección de Idempotent-Replayed', async () => {
    const { api, log } = cliente(
      () => new Response(JSON.stringify({ id: 'u', tipoDte: 33, folio: 7, estado: 'emitido', trackId: null }), { status: 200, headers: { 'Idempotent-Replayed': 'true' } }),
    );
    const r = await api.emitir('76086428-5', { idDoc: { tipoDte: 33, fechaEmision: '2026-01-01' }, detalle: [] }, 'clave-1');
    expect(r.repetido).toBe(true);
    expect(r.documento.folio).toBe(7);
    expect(log[0]?.url).toBe('http://api.test/v1/empresas/76086428-5/documentos');
    const h = log[0]?.init.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('clave-1');
    expect(h['Authorization']).toBe('Bearer k');
  });

  it('envío: cuerpo { documentoIds } y lectura de { envios }', async () => {
    const { api, log } = cliente(() => new Response(JSON.stringify({ envios: [{ id: 'e', canal: 'dte', trackId: '99', estado: 'REC', documentos: [{ documentoId: 'a', tipoDte: 33, folio: 1 }] }] }), { status: 201 }));
    const r = await api.crearEnvio('76086428-5', ['a']);
    expect(r[0]?.trackId).toBe('99');
    expect(JSON.parse(String(log[0]?.init.body))).toEqual({ documentoIds: ['a'] });
    expect(log[0]?.url).toBe('http://api.test/v1/empresas/76086428-5/envios');
  });
});
