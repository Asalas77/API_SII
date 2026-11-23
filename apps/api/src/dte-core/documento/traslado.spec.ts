import { type Caf } from '../caf/caf.js';
import { verificarFirmaXml } from '../firma/firma.js';
import { cafDePrueba, documentoDePrueba } from '../testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../testing/testing.js';
import { calcularDv, desdeIso88591 } from '../xml/xml.util.js';
import { validarXsd } from '../xsd/xsd.js';
import { construirDte, type DteConstruido, type OpcionesConstruirDte } from './construir-dte.js';
import { ErrorValidacionDte } from './errores.js';
import { extraerMarcadoresNota, normalizarPatente, PATRON_PATENTE, type TrasladoDte } from './traslado.js';
import type { DocumentoDte, TipoDte } from './tipos.js';

const certificado = generarCertificadoPrueba({ rut: '12345678-5' });
const fechaFirma = new Date('2026-02-01T13:00:00Z');
const cafs = new Map<TipoDte, Caf>();
function caf(tipo: TipoDte): Caf {
  let c = cafs.get(tipo);
  if (!c) {
    c = cafDePrueba(tipo);
    cafs.set(tipo, c);
  }
  return c;
}

const rut = (cuerpo: string) => `${cuerpo}-${calcularDv(cuerpo)}`;
const RUT_TRANS = rut('76543210');
const RUT_CHOFER = rut('11222333');
const RUT_OTRO = rut('96511690');

function construir(doc: DocumentoDte, extra: Partial<OpcionesConstruirDte> = {}): DteConstruido {
  return construirDte(doc, { caf: caf(doc.idDoc.tipoDte), certificado, fechaFirma, ...extra });
}

function xsdValido(dte: DteConstruido): void {
  const r = validarXsd(dte.xmlIso, 'DTE');
  expect(r.valido, `Errores XSD:\n${r.errores.join('\n')}`).toBe(true);
  const f = verificarFirmaXml(desdeIso88591(dte.xmlIso));
  expect(f.valida, f.errores.join('\n')).toBe(true);
}

function traslado(extra: Partial<TrasladoDte> = {}): TrasladoDte {
  return {
    categoria: 'autogestionado',
    origen: { direccion: 'Bodega Central 100', comuna: 'Quilicura' },
    destino: { direccion: 'Los Leones 99', comuna: 'Ñuñoa', ciudad: 'Santiago' },
    fechaSalida: '2026-02-01',
    horaSalida: '09:30',
    transportista: { rut: RUT_TRANS },
    chofer: { rut: RUT_CHOFER, nombre: 'Juan Pérez Soto' },
    patente: 'bcdf-12',
    patenteCarro: 'AB1234',
    ...extra,
  };
}

function guia(t: Partial<TrasladoDte> | null = {}, ind: DocumentoDte['idDoc']['indTraslado'] = 1): DocumentoDte {
  const d = documentoDePrueba(52, 11);
  d.idDoc.indTraslado = ind;
  if (t !== null) d.traslado = traslado(t);
  return d;
}

function rechaza(doc: DocumentoDte, campo: string, extra: Partial<OpcionesConstruirDte> = {}): ErrorValidacionDte {
  try {
    construir(doc, extra);
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorValidacionDte);
    const err = e as ErrorValidacionDte;
    expect(err.campo, err.message).toBe(campo);
    expect(err.message.startsWith(`${campo}:`), err.message).toBe(true);
    return err;
  }
  throw new Error(`Se esperaba ErrorValidacionDte en ${campo}`);
}

describe('Res. 144: exigencia del bloque traslado en la guía (exigirTrasladoGuias)', () => {
  it('rechaza una guía sin traslado y cita la resolución', () => {
    const err = rechaza(guia(null), 'traslado', { exigirTrasladoGuias: true });
    expect(err.message).toContain('Res. Ex. SII 144/2026');
    expect(err.message).toContain('categoria');
  });
  it('sin la exigencia (por defecto) la guía sin traslado se construye', () => {
    xsdValido(construir(guia(null)));
    xsdValido(construir(guia(null), { exigirTrasladoGuias: false }));
  });
  it('con traslado presente aplica las validaciones por categoría de siempre', () => {
    xsdValido(construir(guia(), { exigirTrasladoGuias: true }));
    rechaza(guia({ patente: undefined }), 'traslado.patente', { exigirTrasladoGuias: true });
  });
  it('no afecta a las facturas sin traslado', () => {
    xsdValido(construir(documentoDePrueba(33, 11), { exigirTrasladoGuias: true }));
  });
});

describe('Res. 144: transporte autogestionado', () => {
  it('arma Transporte en el orden del XSD, normaliza patentes y valida contra DTE_v10.xsd', () => {
    const dte = construir(guia());
    xsdValido(dte);
    const xml = dte.xmlFirmado;
    const orden = ['<Patente>BCDF12</Patente>', '<PatenteCarro>AB1234</PatenteCarro>', `<RUTTrans>${RUT_TRANS}</RUTTrans>`,
      `<Chofer><RUTChofer>${RUT_CHOFER}</RUTChofer><NombreChofer>Juan Pérez Soto</NombreChofer></Chofer>`,
      '<DirDest>Los Leones 99</DirDest>', '<CmnaDest>Ñuñoa</CmnaDest>', '<CiudadDest>Santiago</CiudadDest>',
      '<FchSalida>2026-02-01</FchSalida>', '<HraSalida>09:30:00</HraSalida>'];
    let pos = -1;
    for (const e of orden) {
      const i = xml.indexOf(e);
      expect(i, e).toBeGreaterThan(pos);
      pos = i;
    }
    expect(xml).toContain('<DirOrigen>Bodega Central 100</DirOrigen>');
    expect(xml).toContain('<CmnaOrigen>Quilicura</CmnaOrigen>');
    expect(xml.indexOf('<Transporte>')).toBeGreaterThan(xml.indexOf('</Receptor>'));
    expect(xml.indexOf('<Transporte>')).toBeLessThan(xml.indexOf('<Totales>'));
    expect(dte.traslado?.pendiente).toBe(false);
  });

  it('sin origen informado usa la dirección del emisor', () => {
    const dte = construir(guia({ origen: undefined }));
    expect(dte.xmlFirmado).toContain('<DirOrigen>Av. Providencia 1234</DirOrigen>');
    xsdValido(dte);
  });

  it('factura 33 que ampara traslado también lleva Transporte', () => {
    const doc = documentoDePrueba(33, 3);
    doc.traslado = traslado();
    const dte = construir(doc);
    expect(dte.xmlFirmado).toContain('<Patente>BCDF12</Patente>');
    xsdValido(dte);
  });

  it('exige todos los datos: cada campo faltante se reporta con su ruta', () => {
    rechaza(guia({ transportista: undefined }), 'traslado.transportista.rut');
    rechaza(guia({ chofer: undefined }), 'traslado.chofer.rut');
    rechaza(guia({ chofer: { rut: RUT_CHOFER } }), 'traslado.chofer.nombre');
    rechaza(guia({ chofer: { nombre: 'Juan' } }), 'traslado.chofer.rut');
    rechaza(guia({ patente: undefined }), 'traslado.patente');
    rechaza(guia({ fechaSalida: undefined, horaSalida: undefined }), 'traslado.fechaSalida');
    rechaza(guia({ destino: undefined }), 'traslado.destino');
    rechaza(guia({ destino: { direccion: 'Calle 1', comuna: '' } }), 'traslado.destino.comuna');
  });

  it('no admite diferido/sinDato (hay que declararse tercerizado)', () => {
    const e = rechaza(guia({ patente: undefined, diferido: ['patente'] }), 'traslado.patente');
    expect(e.message).toContain('tercerizado');
  });

  it('valida formatos: RUT con DV, nombre <= 30, patente, fechas, hora', () => {
    rechaza(guia({ chofer: { rut: '11222333-0', nombre: 'Juan' } }), 'traslado.chofer.rut');
    rechaza(guia({ transportista: { rut: '12-4' } }), 'traslado.transportista.rut');
    rechaza(guia({ chofer: { rut: RUT_CHOFER, nombre: 'N'.repeat(31) } }), 'traslado.chofer.nombre');
    rechaza(guia({ patente: 'XYZ' }), 'traslado.patente');
    rechaza(guia({ patenteCarro: '1234AB' }), 'traslado.patenteCarro');
    rechaza(guia({ fechaSalida: '2026-02-30' }), 'traslado.fechaSalida');
    rechaza(guia({ horaSalida: '25:00' }), 'traslado.horaSalida');
    rechaza(guia({ fechaLlegada: '2026-01-31' }), 'traslado.fechaLlegada');
  });

  it('patentes: patrón documentado', () => {
    for (const p of ['AB1234', 'BCDF12', 'ABC12', 'ABC123', 'AB123']) expect(PATRON_PATENTE.test(p), p).toBe(true);
    for (const p of ['A1234', 'ABCDE1', '123456', 'AB12345']) expect(PATRON_PATENTE.test(p), p).toBe(false);
    expect(normalizarPatente(' bc-df.12 ')).toBe('BCDF12');
  });

  it('exige categoría, indTraslado y rechaza boletas y notas', () => {
    rechaza(guia({ categoria: undefined }), 'traslado.categoria');
    const sinInd = guia();
    sinInd.idDoc.indTraslado = undefined;
    rechaza(sinInd, 'idDoc.indTraslado');
    const boleta = documentoDePrueba(39, 3);
    boleta.traslado = traslado();
    rechaza(boleta, 'traslado');
    const nota = documentoDePrueba(61, 3);
    nota.referencias = [{ tipoDocRef: '33', folioRef: 1, fechaRef: '2026-01-01', codRef: 1 }];
    nota.traslado = traslado();
    rechaza(nota, 'traslado');
  });
});

describe('Res. 144: precios según el tipo de traslado', () => {
  it('1-3, 9 y 11 llevan precio unitario', () => {
    for (const ind of [1, 2, 3, 9] as const) {
      const d = guia({}, ind);
      d.detalle[0]!.precioUnitario = 0;
      rechaza(d, 'detalle[0].precioUnitario');
    }
    const d11 = guia({ fechaLlegada: '2026-02-02', descripcionProlongado: 'Distancia' }, 11);
    d11.detalle[0]!.precioUnitario = 0;
    rechaza(d11, 'detalle[0].precioUnitario', { permitirIndTrasladoRes144: true });
  });

  it('4-8 y 12 pueden omitir el precio indicando el motivo', () => {
    for (const ind of [4, 5, 6, 7, 8] as const) {
      const d = guia({ motivoSinPrecio: undefined }, ind);
      d.detalle[0]!.precioUnitario = 0;
      rechaza(d, 'traslado.motivoSinPrecio');
      d.traslado!.motivoSinPrecio = 'Traslado entre bodegas del propio emisor';
      const dte = construir(d);
      expect(dte.xmlFirmado).toContain('Sin precio unitario: Traslado entre bodegas del propio emisor.');
      expect(dte.xmlFirmado).not.toContain('<PrcItem>');
      xsdValido(dte);
    }
  });

  it('con precio no exige motivo', () => {
    xsdValido(construir(guia({}, 5)));
  });
});

describe('Res. 144: transporte tercerizado con datos diferidos', () => {
  const tercerizado = (extra: Partial<TrasladoDte> = {}) =>
    guia({
      categoria: 'tercerizado',
      transportista: undefined,
      chofer: undefined,
      patente: undefined,
      patenteCarro: undefined,
      fechaSalida: undefined,
      horaSalida: undefined,
      diferido: ['transportista', 'choferRut', 'choferNombre', 'patente', 'fechaSalida'],
      ...extra,
    });

  it('escribe "Diferido" en los campos de texto, omite RUT/fechas y deja constancia en el detalle', () => {
    const dte = construir(tercerizado());
    xsdValido(dte);
    expect(dte.xmlFirmado).toContain('<Patente>Diferido</Patente>');
    expect(dte.xmlFirmado).not.toContain('<Chofer>');
    expect(dte.xmlFirmado).not.toContain('<RUTTrans>');
    expect(dte.xmlFirmado).not.toContain('<FchSalida>');
    expect(dte.xmlFirmado).toContain('Datos de traslado pendientes (Res. Ex. SII 144/2026): RUT transportista: DIFERIDO; RUT chofer: DIFERIDO;');
    expect(dte.traslado?.pendiente).toBe(true);
    expect(extraerMarcadoresNota(dte.xmlFirmado.match(/<DscItem>([^<]*)<\/DscItem>/)?.[1])).toMatchObject({
      patente: 'Diferido',
      fechaSalida: 'Diferido',
      transportista: 'Diferido',
    });
  });

  it('"Sin Dato" con RUT del chofer conocido: el nombre va literal en NombreChofer', () => {
    const dte = construir(
      tercerizado({
        chofer: { rut: RUT_CHOFER },
        diferido: ['transportista', 'patente', 'fechaSalida'],
        sinDato: ['choferNombre'],
      }),
    );
    xsdValido(dte);
    expect(dte.xmlFirmado).toContain(`<Chofer><RUTChofer>${RUT_CHOFER}</RUTChofer><NombreChofer>Sin Dato</NombreChofer></Chofer>`);
  });

  it('cada dato debe informarse o marcarse; no se puede marcar un dato informado', () => {
    rechaza(tercerizado({ diferido: ['transportista', 'choferRut', 'choferNombre', 'fechaSalida'] }), 'traslado.patente');
    rechaza(tercerizado({ patente: 'AB1234' }), 'traslado.patente');
    rechaza(tercerizado({ sinDato: ['patente'] }), 'traslado.sinDato');
    rechaza(tercerizado({ diferido: ['inexistente' as never] }), 'traslado.diferido');
  });

  it('origen y destino siguen siendo obligatorios', () => {
    rechaza(tercerizado({ destino: undefined }), 'traslado.destino');
  });

  it('también aplica a una factura 34 que ampara traslado', () => {
    const doc = documentoDePrueba(34, 4);
    doc.traslado = tercerizado().traslado;
    const dte = construir(doc);
    expect(dte.traslado?.pendiente).toBe(true);
    xsdValido(dte);
  });
});

describe('Res. 144: régimen especial', () => {
  const especial = (extra: Partial<TrasladoDte> = {}): DocumentoDte => {
    const d = guia(
      {
        categoria: 'regimen_especial',
        destino: undefined,
        transportista: undefined,
        chofer: undefined,
        patente: undefined,
        patenteCarro: undefined,
        fechaSalida: undefined,
        horaSalida: undefined,
        motivoSinPrecio: 'Guía habilitante ante Sernapesca, aún sin traslado',
        ...extra,
      },
      6,
    );
    d.detalle[0]!.precioUnitario = 0;
    return d;
  };

  it('basta con origen, tipo de traslado y descripción (resolutivo 11°)', () => {
    const dte = construir(especial());
    xsdValido(dte);
    expect(dte.xmlFirmado).not.toContain('<Transporte>');
    expect(dte.xmlFirmado).toContain('<IndTraslado>6</IndTraslado>');
    expect(dte.traslado?.pendiente).toBe(false);
  });

  it('admite datos parciales de transporte', () => {
    const dte = construir(especial({ patente: 'BCDF12' }));
    expect(dte.xmlFirmado).toContain('<Transporte><Patente>BCDF12</Patente></Transporte>');
    xsdValido(dte);
  });

  it('exige la dirección de origen y el tipo de traslado', () => {
    rechaza(especial({ origen: { direccion: '', comuna: '' } }), 'traslado.origen');
    const d = especial();
    d.idDoc.indTraslado = undefined;
    rechaza(d, 'idDoc.indTraslado');
  });
});

describe('Res. 144: retiro por el comprador', () => {
  it('la factura basta: sin Transporte ni datos de transporte', () => {
    const doc = documentoDePrueba(33, 8);
    doc.traslado = { retiroComprador: true };
    const dte = construir(doc);
    expect(dte.xmlFirmado).not.toContain('<Transporte>');
    expect(dte.traslado?.retiroComprador).toBe(true);
    xsdValido(dte);
  });

  it('no admite datos de transporte ni se usa en guías', () => {
    const doc = documentoDePrueba(33, 8);
    doc.traslado = { retiroComprador: true, patente: 'BCDF12' };
    rechaza(doc, 'traslado.patente');
    const g = guia({ retiroComprador: true });
    rechaza(g, 'traslado.retiroComprador');
  });
});

describe('Res. 144: IndTraslado 10-12 (pendientes de XSD oficial)', () => {
  const habilitar = { permitirIndTrasladoRes144: true };
  const gdt = (extra: Partial<TrasladoDte> = {}): DocumentoDte => {
    const d = guia(
      { categoria: 'tercerizado', fechaSalida: '2026-02-01', ...extra },
      10,
    );
    d.detalle = [{ nombre: 'Según documento referenciado', precioUnitario: 0 }];
    d.referencias = [
      { tipoDocRef: '52', folioRef: 77, fechaRef: '2026-01-30', rutOtroContribuyente: RUT_OTRO, razonRef: 'GDT del traslado' },
    ];
    return d;
  };

  it('por defecto se rechazan con una explicación clara', () => {
    for (const ind of [10, 11, 12] as const) {
      const e = rechaza(guia({}, ind), 'idDoc.indTraslado');
      expect(e.message).toContain('XSD oficial');
      expect(e.message).toContain('PERMITIR_INDTRASLADO_RES144');
    }
  });

  it('GDT: referencia al original con RUTOtr, detalle mínimo sin cantidad ni precio', () => {
    const dte = construir(gdt(), habilitar);
    const xml = dte.xmlFirmado;
    expect(xml).toContain('<IndTraslado>10</IndTraslado>');
    expect(xml).toContain(`<FolioRef>77</FolioRef><RUTOtr>${RUT_OTRO}</RUTOtr><FchRef>2026-01-30</FchRef>`);
    expect(xml).not.toContain('<QtyItem>');
    // SUPUESTO documentado: mientras el XSD oficial no enumere 10-12, el único error del XSD es IndTraslado.
    const r = validarXsd(dte.xmlIso, 'DTE');
    expect(r.valido).toBe(false);
    expect(r.errores.join('\n')).toContain('IndTraslado');
  });

  it('GDT: categoría tercerizado, referencia tributaria y cantidad solo omitible aquí', () => {
    rechaza(gdt({ categoria: 'autogestionado' }), 'traslado.categoria', habilitar);
    const sinRef = gdt();
    sinRef.referencias = undefined;
    rechaza(sinRef, 'referencias', habilitar);
    const oc = gdt();
    oc.referencias = [{ tipoDocRef: '801', folioRef: 1, fechaRef: '2026-01-30' }];
    rechaza(oc, 'referencias', habilitar);
    const normal = guia();
    delete normal.detalle[0]!.cantidad;
    rechaza(normal, 'detalle[0].cantidad');
  });

  it('GDT sin el bloque traslado se rechaza', () => {
    const d = gdt();
    delete d.traslado;
    rechaza(d, 'traslado', habilitar);
  });

  it('11 y 12: exigen fecha de llegada y descripción del traslado prolongado', () => {
    for (const ind of [11, 12] as const) {
      const base = (extra: Partial<TrasladoDte>) => {
        const d = guia({ fechaLlegada: '2026-02-03', descripcionProlongado: 'Distancia Arica-Punta Arenas', ...extra }, ind);
        if (ind === 12) d.traslado!.motivoSinPrecio = 'Traslado entre sucursales';
        return d;
      };
      const dte = construir(base({}), habilitar);
      expect(dte.xmlFirmado).toContain('<FchLlegada>2026-02-03</FchLlegada>');
      expect(dte.xmlFirmado).toContain('Traslado prolongado: Distancia Arica-Punta Arenas. Fecha estimada de llegada: 2026-02-03.');
      rechaza(base({ fechaLlegada: undefined }), 'traslado.fechaLlegada', habilitar);
      rechaza(base({ descripcionProlongado: undefined }), 'traslado.descripcionProlongado', habilitar);
    }
  });
});

describe('Res. 144: RUTOtr en referencias', () => {
  const conRef = (r: Partial<NonNullable<DocumentoDte['referencias']>[number]>): DocumentoDte => {
    const d = guia();
    d.referencias = [{ tipoDocRef: '33', folioRef: 5, fechaRef: '2026-01-20', ...r }];
    return d;
  };

  it('se emite entre FolioRef y FchRef y valida contra el XSD', () => {
    const dte = construir(conRef({ rutOtroContribuyente: RUT_OTRO.toLowerCase() }));
    expect(dte.xmlFirmado).toContain(`<FolioRef>5</FolioRef><RUTOtr>${RUT_OTRO}</RUTOtr><FchRef>2026-01-20</FchRef>`);
    xsdValido(dte);
  });

  it('solo si el documento referido es tributario y de otro contribuyente', () => {
    rechaza(conRef({ rutOtroContribuyente: '11111111-9' }), 'referencias[0].rutOtroContribuyente');
    rechaza(conRef({ tipoDocRef: '801', rutOtroContribuyente: RUT_OTRO }), 'referencias[0].rutOtroContribuyente');
    rechaza(conRef({ rutOtroContribuyente: '76086428-5' }), 'referencias[0].rutOtroContribuyente');
  });
});

describe('Res. 144: peso y volumen del ítem', () => {
  it('se informan en DscItem (el formato no tiene campo por ítem)', () => {
    const d = guia();
    d.detalle[0]!.descripcion = 'Pallet de cemento';
    d.detalle[0]!.peso = { valor: 1250.5, unidad: 'KG' };
    d.detalle[0]!.volumen = { valor: 2, unidad: 'M3' };
    const dte = construir(d);
    expect(dte.xmlFirmado).toContain('<DscItem>Pallet de cemento Peso: 1250.5 KG. Volumen: 2 M3.</DscItem>');
    xsdValido(dte);
  });
});
