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

describe('guía de despacho: traslado Res. Ex. SII 144/2026', () => {
  const entrega = {
    ShipToStreet: 'Los Leones',
    ShipToStreetNo: '99',
    ShipToCounty: 'Ñuñoa',
    ShipToCity: 'Santiago',
  };
  const completa = (extra: Record<string, unknown> = {}) =>
    guia({
      U_SII_CatTraslado: 'AUTOGESTIONADO',
      U_SII_DirOrigen: 'Bodega Central 100',
      U_SII_CmnaOrigen: 'Quilicura',
      U_SII_RutTrans: '76.543.210-3',
      U_SII_RutChofer: '11.222.333-9',
      U_SII_NomChofer: 'Juan Pérez Soto',
      U_SII_Patente: 'BCDF12',
      U_SII_PatenteCarro: 'AB1234',
      U_SII_FchSalida: '2026-11-23T00:00:00',
      U_SII_HraSalida: '09:30',
      U_SII_FchLlegada: '2026-11-23',
      AddressExtension: entrega,
      ...extra,
    });

  it('sin U_SII_CatTraslado no hay bloque traslado y avisa (U_SII_Transporte obsoleto)', () => {
    const r = ok(mapearDocumento(ODLN, guia(), ctx()));
    expect(r.cuerpo.traslado).toBeUndefined();
    expect(r.advertencias.join(' ')).toMatch(/Res\. Ex\. SII 144.*obsoleto/);
  });

  it('autogestionada: mapea los UDF estructurados y el destino desde la dirección de entrega', () => {
    const r = ok(mapearDocumento(ODLN, completa(), ctx()));
    expect(r.cuerpo.traslado).toEqual({
      categoria: 'autogestionado',
      origen: { direccion: 'Bodega Central 100', comuna: 'Quilicura' },
      destino: { direccion: 'Los Leones 99', comuna: 'Ñuñoa', ciudad: 'Santiago' },
      transportista: { rut: '76543210-3' },
      chofer: { rut: '11222333-9', nombre: 'Juan Pérez Soto' },
      patente: 'BCDF12',
      patenteCarro: 'AB1234',
      fechaSalida: '2026-11-23',
      horaSalida: '09:30',
      fechaLlegada: '2026-11-23',
    });
    expect(r.cuerpo.idDoc.indTraslado).toBe(1);
  });

  it('autogestionada incompleta: errores con el UDF exacto', () => {
    const e = errores(
      mapearDocumento(ODLN, completa({ U_SII_Patente: null, U_SII_RutChofer: '', U_SII_FchSalida: null, AddressExtension: null }), ctx()),
    ).join(' | ');
    expect(e).toMatch(/U_SII_Patente es obligatorio/);
    expect(e).toMatch(/U_SII_RutChofer es obligatorio/);
    expect(e).toMatch(/U_SII_FchSalida es obligatorio/);
    expect(e).toMatch(/dirección de entrega/);
  });

  it('valida formatos: RUT con DV, nombre de 30, origen en par', () => {
    const e = errores(
      mapearDocumento(ODLN, completa({ U_SII_RutTrans: '76543210-0', U_SII_NomChofer: 'X'.repeat(31), U_SII_CmnaOrigen: '' }), ctx()),
    ).join(' | ');
    expect(e).toMatch(/U_SII_RutTrans inválido/);
    expect(e).toMatch(/U_SII_NomChofer admite hasta 30/);
    expect(e).toMatch(/U_SII_DirOrigen y U_SII_CmnaOrigen/);
  });

  it('tercerizada: lo vacío se informa diferido y "SIN DATO" se respeta', () => {
    const r = ok(
      mapearDocumento(
        ODLN,
        completa({ U_SII_CatTraslado: 'tercerizado', U_SII_RutTrans: '', U_SII_RutChofer: '', U_SII_NomChofer: 'Sin dato', U_SII_Patente: '', U_SII_FchSalida: null, U_SII_HraSalida: null }),
        ctx(),
      ),
    );
    expect(r.cuerpo.traslado?.diferido).toEqual(['transportista', 'choferRut', 'patente', 'fechaSalida']);
    expect(r.cuerpo.traslado?.sinDato).toEqual(['choferNombre']);
    expect(r.cuerpo.traslado?.chofer).toBeUndefined();
    expect(r.cuerpo.traslado?.patenteCarro).toBe('AB1234');
  });

  it('régimen especial: basta con lo mínimo y no exige destino', () => {
    const r = ok(
      mapearDocumento(
        ODLN,
        guia({ U_SII_CatTraslado: 'REGIMEN_ESPECIAL', U_SII_IndTraslado: '6', DocumentLines: [linea(0, { Quantity: 1, UnitPrice: 0 })], Comments: 'Guía habilitante SAG' }),
        ctx(),
      ),
    );
    expect(r.cuerpo.traslado).toEqual({ categoria: 'regimen_especial', motivoSinPrecio: 'Guía habilitante SAG' });
  });

  it('categoría inválida, IndTraslado 10 (GDT) y 11/12 sin llegada ni descripción', () => {
    expect(errores(mapearDocumento(ODLN, completa({ U_SII_CatTraslado: 'OTRA' }), ctx())).join(' ')).toMatch(/U_SII_CatTraslado "OTRA"/);
    expect(errores(mapearDocumento(ODLN, completa({ U_SII_IndTraslado: '10' }), ctx())).join(' ')).toMatch(/GDT/);
    const e = errores(mapearDocumento(ODLN, completa({ U_SII_IndTraslado: '11', U_SII_FchLlegada: null, Comments: null }), ctx())).join(' | ');
    expect(e).toMatch(/U_SII_FchLlegada/);
    expect(e).toMatch(/Comments/);
    const ok11 = ok(mapearDocumento(ODLN, completa({ U_SII_IndTraslado: '11', Comments: 'Distancia Arica-Santiago' }), ctx()));
    expect(ok11.cuerpo.idDoc.indTraslado).toBe(11);
    expect(ok11.cuerpo.traslado?.descripcionProlongado).toBe('Distancia Arica-Santiago');
    expect(errores(mapearDocumento(ODLN, completa({ U_SII_IndTraslado: '13' }), ctx())).join(' ')).toMatch(/1 a 12/);
  });
});
