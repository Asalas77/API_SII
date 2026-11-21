import { describe, expect, it } from 'vitest';
import { claveBase, mapearDocumento, type ContextoMapeo } from '../src/mapeador.js';
import { normalizarRut } from '../src/rut.js';
import { ENTIDADES, type SocioB1 } from '../src/tipos-b1.js';
import {
  baseConFolio,
  baseSinFolio,
  boleta,
  configB1,
  facturaAfecta,
  facturaConDescuentoCabecera,
  facturaExenta,
  facturaMixta,
  guia,
  linea,
  notaCredito,
  socio,
  socioConsumidorFinal,
} from './fixtures.js';

const [OINV, ORIN, ODLN] = ENTIDADES as [(typeof ENTIDADES)[0], (typeof ENTIDADES)[1], (typeof ENTIDADES)[2]];

function ctx(s: SocioB1 | null = socio(), bases: ContextoMapeo['bases'] = new Map()): ContextoMapeo {
  return { config: configB1, socio: s, bases };
}

function ok(r: ReturnType<typeof mapearDocumento>) {
  if (!r.ok) throw new Error(`se esperaba ok: ${r.errores.join(' | ')}`);
  return r;
}
function errores(r: ReturnType<typeof mapearDocumento>) {
  if (r.ok) throw new Error('se esperaba error');
  return r.errores;
}

describe('normalizarRut', () => {
  it('acepta puntos, guion y K; rechaza DV incorrecto', () => {
    expect(normalizarRut('76.086.428-5')).toBe('76086428-5');
    expect(normalizarRut('760864285')).toBe('76086428-5');
    expect(normalizarRut('96511470-k')).toBe('96511470-K');
    expect(normalizarRut('76086428-4')).toBeNull();
    expect(normalizarRut('abc')).toBeNull();
    expect(normalizarRut('')).toBeNull();
  });
});

describe('mapeador B1 -> DTE', () => {
  it('factura afecta: tipo 33, receptor del socio, crédito, líneas netas', () => {
    const r = ok(mapearDocumento(OINV, facturaAfecta(), ctx()));
    expect(r.tipoDte).toBe(33);
    expect(r.cuerpo.idDoc).toEqual({
      tipoDte: 33,
      fechaEmision: '2026-03-16',
      fechaVencimiento: '2026-04-15',
      formaPago: 2,
    });
    expect(r.cuerpo.receptor).toEqual({
      rut: '77123456-9',
      razonSocial: 'Comercial Los Andes SpA',
      giro: 'Venta al por mayor de ferreteria',
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      ciudad: 'Santiago',
      correo: 'compras@losandes.cl',
      telefono: '+56 2 2345 6789',
    });
    expect(r.cuerpo.detalle).toEqual([
      { nombre: 'Artículo de prueba 1', codigoItem: 'ART001', unidad: 'UN', cantidad: 2, precioUnitario: 10000 },
      { nombre: 'Artículo de prueba 2', codigoItem: 'ART002', unidad: 'UN', cantidad: 1, precioUnitario: 5000 },
    ]);
    expect(r.cuerpo.referencias).toBeUndefined();
    expect(r.cuerpo.descuentosRecargos).toBeUndefined();
    expect(r.cuerpo.origen).toEqual({ sistema: 'SAP_B1', objType: 13, docEntry: 100, docNum: 1500 });
  });

  it('factura con todas las líneas exentas deriva a tipo 34 y marca exento', () => {
    const r = ok(mapearDocumento(OINV, facturaExenta(), ctx()));
    expect(r.tipoDte).toBe(34);
    expect(r.cuerpo.detalle.every((d) => d.exento === true)).toBe(true);
  });

  it('factura mixta sigue siendo 33; solo las líneas exentas llevan exento', () => {
    const r = ok(mapearDocumento(OINV, facturaMixta(), ctx()));
    expect(r.tipoDte).toBe(33);
    expect(r.cuerpo.detalle.map((d) => d.exento)).toEqual([undefined, true]);
  });

  it('descuento de cabecera y de línea; pago contado => formaPago 1; mixto => descuento afecto y exento', () => {
    const r = ok(mapearDocumento(OINV, facturaConDescuentoCabecera(), ctx()));
    expect(r.cuerpo.idDoc.formaPago).toBe(1);
    expect(r.cuerpo.detalle[0]?.descuentoPorcentaje).toBe(5);
    expect(r.cuerpo.descuentosRecargos).toEqual([
      { tipo: 'D', glosa: 'Descuento', tipoValor: '%', valor: 10 },
      { tipo: 'D', glosa: 'Descuento', tipoValor: '%', valor: 10, exento: true },
    ]);
  });

  it('boleta con consumidor final: sin receptor, precio con IVA incluido, sin formaPago', () => {
    const r = ok(mapearDocumento(OINV, boleta(), ctx(socioConsumidorFinal())));
    expect(r.tipoDte).toBe(39);
    expect(r.cuerpo.receptor).toBeUndefined();
    expect(r.cuerpo.idDoc.formaPago).toBeUndefined();
    expect(r.cuerpo.idDoc.fechaVencimiento).toBeUndefined();
    expect(r.cuerpo.detalle[0]?.precioUnitario).toBe(10000);
  });

  it('boleta con RUT genérico 66666666-6 omite el receptor', () => {
    const r = ok(mapearDocumento(OINV, boleta(), ctx(socio({ LicTradNum: '66.666.666-6' }))));
    expect(r.cuerpo.receptor).toBeUndefined();
  });

  it('boleta sin PriceAfterVAT calcula el bruto desde el neto', () => {
    const doc = boleta();
    doc.DocumentLines = [linea(0, { Quantity: 1, UnitPrice: 1000, PriceAfterVAT: null, TaxPercentagePerRow: 19 })];
    expect(ok(mapearDocumento(OINV, doc, ctx(socioConsumidorFinal()))).cuerpo.detalle[0]?.precioUnitario).toBe(1190);
  });

  it('nota de crédito con base: referencia con folio, tipo y fecha del documento base', () => {
    const bases = new Map([[claveBase(13, 100), baseConFolio()]]);
    const r = ok(mapearDocumento(ORIN, notaCredito(), ctx(socio(), bases)));
    expect(r.tipoDte).toBe(61);
    expect(r.cuerpo.referencias).toEqual([
      { tipoDocRef: '33', folioRef: 4521, fechaRef: '2026-03-10', codRef: 1, razonRef: 'Anula factura por error de precio' },
    ]);
  });

  it('nota de crédito sin U_SII_CodRef usa codRef 3', () => {
    const bases = new Map([[claveBase(13, 100), baseConFolio()]]);
    const r = ok(mapearDocumento(ORIN, notaCredito({ U_SII_CodRef: null, U_SII_RazonRef: null }), ctx(socio(), bases)));
    expect(r.cuerpo.referencias?.[0]?.codRef).toBe(3);
  });

  it('nota de crédito cuyo documento base no tiene folio: error claro', () => {
    const bases = new Map([[claveBase(13, 100), baseSinFolio()]]);
    const e = errores(mapearDocumento(ORIN, notaCredito(), ctx(socio(), bases)));
    expect(e.join(' ')).toMatch(/no tiene folio \(U_SII_Folio\)/);
  });

  it('nota de crédito sin documento base ni UDFs de referencia: error', () => {
    const doc = notaCredito({ DocumentLines: [linea(0)] });
    expect(errores(mapearDocumento(ORIN, doc, ctx())).join(' ')).toMatch(/debe referenciar/);
  });

  it('nota de débito (factura con U_SII_TipoDTE=56) referencia por UDFs si no hay base', () => {
    const doc = facturaAfecta();
    doc.U_SII_TipoDTE = '56';
    doc.U_SII_TipoDocRef = '33';
    doc.U_SII_FolioRef = '4521';
    doc.U_SII_CodRef = '3';
    const r = ok(mapearDocumento(OINV, doc, ctx()));
    expect(r.tipoDte).toBe(56);
    expect(r.cuerpo.referencias).toEqual([{ tipoDocRef: '33', folioRef: '4521', codRef: 3 }]);
  });

  it('guía de despacho con IndTraslado: tipo 52, sin formaPago, transporte en origen', () => {
    const r = ok(mapearDocumento(ODLN, guia(), ctx()));
    expect(r.tipoDte).toBe(52);
    expect(r.cuerpo.idDoc.indTraslado).toBe(1);
    expect(r.cuerpo.idDoc.formaPago).toBeUndefined();
    expect(r.cuerpo.origen?.['transporte']).toMatch(/ABCD-12/);
  });

  it('guía sin IndTraslado: error', () => {
    expect(errores(mapearDocumento(ODLN, guia({ U_SII_IndTraslado: null }), ctx())).join(' ')).toMatch(/U_SII_IndTraslado/);
  });

  it('RUT con dígito verificador inválido: error antes de llamar a la API', () => {
    const e = errores(mapearDocumento(OINV, facturaAfecta(), ctx(socio({ LicTradNum: '77.123.456-0' }))));
    expect(e.join(' ')).toMatch(/RUT del receptor inválido/);
  });

  it('socio sin RUT en factura: error; socio inexistente: error', () => {
    expect(errores(mapearDocumento(OINV, facturaAfecta(), ctx(socio({ LicTradNum: '' })))).join(' ')).toMatch(/no tiene RUT/);
    expect(errores(mapearDocumento(OINV, facturaAfecta(), ctx(null))).join(' ')).toMatch(/No se pudo leer el socio/);
  });

  it('más de 60 líneas en una factura: error; en boleta hasta 1000', () => {
    const muchas = Array.from({ length: 61 }, (_, i) => linea(i));
    const doc = facturaAfecta();
    doc.DocumentLines = muchas;
    expect(errores(mapearDocumento(OINV, doc, ctx())).join(' ')).toMatch(/máximo 60 líneas/);
    const b = boleta();
    b.DocumentLines = Array.from({ length: 61 }, (_, i) => linea(i));
    ok(mapearDocumento(OINV, b, ctx(socioConsumidorFinal())));
    b.DocumentLines = Array.from({ length: 1001 }, (_, i) => linea(i));
    expect(errores(mapearDocumento(OINV, b, ctx(socioConsumidorFinal()))).join(' ')).toMatch(/máximo 1000 líneas/);
  });

  it('descripción larga: nombre truncado a 80 y texto completo en descripcion', () => {
    const doc = facturaAfecta();
    const largo = 'X'.repeat(120);
    doc.DocumentLines = [linea(0, { ItemDescription: largo })];
    const d = ok(mapearDocumento(OINV, doc, ctx())).cuerpo.detalle[0];
    expect(d?.nombre).toHaveLength(80);
    expect(d?.descripcion).toBe(largo);
  });

  it('U_SII_TipoDTE inválido o incompatible con la entidad: error', () => {
    const a = facturaAfecta();
    a.U_SII_TipoDTE = '99';
    expect(errores(mapearDocumento(OINV, a, ctx())).join(' ')).toMatch(/no es un tipo válido/);
    a.U_SII_TipoDTE = '52';
    expect(errores(mapearDocumento(OINV, a, ctx())).join(' ')).toMatch(/no corresponde/);
  });

  it('tipo 33 explícito con todo exento y tipo 34 con ítems afectos: error', () => {
    const e = facturaExenta();
    e.U_SII_TipoDTE = '33';
    expect(errores(mapearDocumento(OINV, e, ctx())).join(' ')).toMatch(/al menos un ítem afecto/);
    const a = facturaAfecta();
    a.U_SII_TipoDTE = '34';
    expect(errores(mapearDocumento(OINV, a, ctx())).join(' ')).toMatch(/solo admite ítems exentos/);
  });

  it('acumula varios errores y avisa si el socio no informa giro', () => {
    const doc = facturaAfecta();
    doc.DocumentLines = [linea(0, { Quantity: 0 }), linea(1, { UnitPrice: null, PriceAfterVAT: null })];
    expect(errores(mapearDocumento(OINV, doc, ctx())).length).toBeGreaterThanOrEqual(2);
    const sinGiro = ok(mapearDocumento(OINV, facturaAfecta(), ctx(socio({ U_SII_Giro: undefined }))));
    expect(sinGiro.advertencias.join(' ')).toMatch(/giro/);
  });
});
