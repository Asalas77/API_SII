import {
  construirDte,
  construirEnvioDte,
  desdeIso88591,
  firmarXml,
  validarXsd,
  verificarFirmaXml,
  type EsquemaSii,
} from '../dte-core/index.js';
import { cafDePrueba, documentoDePrueba } from '../dte-core/testing/documentos-prueba.js';
import { generarCertificadoPrueba } from '../dte-core/testing/testing.js';
import {
  analizarEnvioRecibido,
  construirEnvioRecibos,
  construirRecepcionEnvio,
  construirResultadoDte,
  DECLARACION_LEY_19983,
  documentoRecibidoDesdeAnalisis,
  EstadoDte,
  EstadoRecepDte,
  EstadoRecepEnv,
  resultadoDesdeAnalisis,
  type DatosRespuesta,
} from './index.js';

const RUT_A = '76086428-5'; // emisor de los DTE
const RUT_B = '12345678-5'; // receptor (quien responde)
const receptorB = { rut: '12345678', dv: '5' };
const certA = generarCertificadoPrueba({ rut: '11111111-1' });
const certB = generarCertificadoPrueba({ rut: RUT_B });
const fechaFirma = new Date('2026-02-02T13:00:00Z');

const caf = cafDePrueba(33, 1, 100);
function factura(folio: number): string {
  return construirDte(documentoDePrueba(33, folio), { caf, certificado: certA, fechaFirma }).xmlFirmado;
}
function sobre(dtes: string[], rutReceptor = RUT_B): Buffer {
  return construirEnvioDte({
    dtesFirmados: dtes,
    caratula: {
      rutEmisor: '76086428', dvEmisor: '5', rutEnvia: '11111111', dvEnvia: '1',
      rutReceptor, fechaResolucion: '2025-01-15', numeroResolucion: 80, fechaFirma,
    },
    certificado: certA,
  }).xmlIso;
}
const envioOk = sobre([factura(1), factura(2)]);

function esperarValido(xml: Buffer, esquema: EsquemaSii): void {
  const r = validarXsd(xml, esquema);
  expect(r.valido, `Errores XSD (${esquema}):\n${r.errores.join('\n')}`).toBe(true);
  const f = verificarFirmaXml(desdeIso88591(xml));
  expect(f.valida, `Errores de firma:\n${f.errores.join('\n')}`).toBe(true);
}

/** Altera un carácter del último `SignatureValue` (el del sobre). */
function conFirmaDelSobreAlterada(xml: Buffer): Buffer {
  const texto = desdeIso88591(xml);
  const i = texto.lastIndexOf('<SignatureValue>') + '<SignatureValue>'.length;
  return Buffer.from(texto.slice(0, i) + (texto[i] === 'A' ? 'B' : 'A') + texto.slice(i + 1), 'latin1');
}

/** Quita la firma del DTE y la vuelve a firmar (tras haberlo modificado). */
function refirmarDte(dteModificado: string): string {
  const sinFirma = dteModificado.replace(/<Signature[\s\S]*<\/Signature>/, '');
  const idDoc = /<Documento ID="([^"]+)"/.exec(sinFirma)?.[1] as string;
  return firmarXml(sinFirma, { ...certA, idReferencia: idDoc });
}

const datosRespuesta: DatosRespuesta = {
  idRespuesta: 1,
  certificado: certB,
  nombreContacto: 'Contacto Ñandú',
  fonoContacto: '+56 2 2345 6789',
  mailContacto: 'contacto@receptor.cl',
  fechaFirma,
};

describe('analizarEnvioRecibido', () => {
  it('envío correcto: estado 0 y 2 DTE recibidos OK', () => {
    const a = analizarEnvioRecibido(envioOk, receptorB, {}, { nombreArchivo: 'envio1.xml', codigoEnvio: 7, fechaRecepcion: fechaFirma });
    expect(a.erroresXsd).toEqual([]);
    expect(a.erroresFirma).toEqual([]);
    expect(a.estado).toBe(EstadoRecepEnv.OK);
    expect(a.glosa).toBe('Envio Recibido Conforme');
    expect(a.tipoSobre).toBe('EnvioDTE');
    expect(a.idSet).toBe('SetDoc');
    expect(a.rutEmisor).toBe(RUT_A);
    expect(a.rutReceptor).toBe(RUT_B);
    expect(a.digest).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.dtes).toHaveLength(2);
    for (const d of a.dtes) {
      expect(d.estado, d.errores.join('\n')).toBe(EstadoRecepDte.OK);
      expect(d.tipoDte).toBe(33);
      expect(d.rutEmisor).toBe(RUT_A);
      expect(d.rutReceptor).toBe(RUT_B);
      expect(d.montoTotal).toBe(1190);
      expect(d.fechaEmision).toBe('2026-02-01');
    }
    expect(a.dtes.map((d) => d.folio)).toEqual([1, 2]);
  });

  it('acepta el envío como string', () => {
    expect(analizarEnvioRecibido(desdeIso88591(envioOk), receptorB).estado).toBe(EstadoRecepEnv.OK);
  });

  it('firma del sobre alterada: estado 2 (los DTE siguen verificando)', () => {
    const a = analizarEnvioRecibido(conFirmaDelSobreAlterada(envioOk), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.ERROR_FIRMA);
    expect(a.glosa).toContain('Error de Firma');
    expect(a.erroresFirma.length).toBeGreaterThan(0);
    expect(a.dtes.map((d) => d.estado)).toEqual([EstadoRecepDte.OK, EstadoRecepDte.OK]);
  });

  it('contenido alterado tras firmar: error de firma (2) y DTE 1 rechazado por firma', () => {
    const alterado = desdeIso88591(envioOk).replace('<MntTotal>1190</MntTotal>', '<MntTotal>9999</MntTotal>');
    const a = analizarEnvioRecibido(Buffer.from(alterado, 'latin1'), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.ERROR_FIRMA);
    expect(a.dtes[0].estado).toBe(EstadoRecepDte.ERROR_FIRMA);
  });

  it('RUT receptor equivocado: envío 3 y DTE 3', () => {
    const a = analizarEnvioRecibido(envioOk, { rut: '11222333', dv: '9' });
    expect(a.estado).toBe(EstadoRecepEnv.RUT_RECEPTOR_NO_CORRESPONDE);
    expect(a.dtes.every((d) => d.estado === EstadoRecepDte.ERROR_RUT_RECEPTOR)).toBe(true);
  });

  it('carátula dirigida a otro receptor: 3', () => {
    const a = analizarEnvioRecibido(sobre([factura(3)], '11222333-9'), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.RUT_RECEPTOR_NO_CORRESPONDE);
  });

  it('XML ilegible: 91 (basura, truncado y vacío)', () => {
    for (const malo of [Buffer.from('esto no es xml <<<'), envioOk.subarray(0, envioOk.length - 40), Buffer.alloc(0)]) {
      const a = analizarEnvioRecibido(malo, receptorB);
      expect(a.estado).toBe(EstadoRecepEnv.ARCHIVO_ILEGIBLE);
      expect(a.dtes).toEqual([]);
    }
  });

  it('error de schema: 1', () => {
    const roto = desdeIso88591(envioOk).replace(/<RutEnvia>[^<]*<\/RutEnvia>/, '');
    const a = analizarEnvioRecibido(Buffer.from(roto, 'latin1'), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.ERROR_SCHEMA);
    expect(a.erroresXsd.length).toBeGreaterThan(0);
  });

  it('DTE con TED alterado (y DTE re-firmado): DTE rechazado, el otro OK', () => {
    const original = factura(5);
    const tedAlterado = original.replace(/(<TED[\s\S]*?<DD>[\s\S]*?<MNT>)\d+(<\/MNT>)/, '$11$2');
    expect(tedAlterado).not.toBe(original);
    const a = analizarEnvioRecibido(sobre([refirmarDte(tedAlterado), factura(6)]), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.OK);
    expect(a.dtes[0].estado).toBe(EstadoRecepDte.ERROR_FIRMA);
    expect(a.dtes[0].errores[0]).toContain('TED');
    expect(a.dtes[1].estado).toBe(EstadoRecepDte.OK);
  });

  it('DTE re-firmado cuyo monto difiere del TED: 99', () => {
    const cambiado = factura(8).replace('<MntTotal>1190</MntTotal>', '<MntTotal>2380</MntTotal>');
    const a = analizarEnvioRecibido(sobre([refirmarDte(cambiado)]), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.OK);
    expect(a.dtes[0].estado).toBe(EstadoRecepDte.OTROS);
    expect(a.dtes[0].errores[0]).toContain('MNT');
  });

  it('envío repetido (90) y DTE repetido (4) según historial', () => {
    const rep = analizarEnvioRecibido(envioOk, receptorB, { envios: [{ idSet: 'SetDoc', rutEmisor: RUT_A }] });
    expect(rep.estado).toBe(EstadoRecepEnv.ARCHIVO_REPETIDO);
    const otroEmisor = analizarEnvioRecibido(envioOk, receptorB, { envios: [{ idSet: 'SetDoc', rutEmisor: '11111111-1' }] });
    expect(otroEmisor.estado).toBe(EstadoRecepEnv.OK);
    const dtes = analizarEnvioRecibido(envioOk, receptorB, { dtes: [{ rutEmisor: RUT_A, tipoDte: 33, folio: 2 }] });
    expect(dtes.estado).toBe(EstadoRecepEnv.OK);
    expect(dtes.dtes.map((d) => d.estado)).toEqual([EstadoRecepDte.OK, EstadoRecepDte.REPETIDO]);
  });

  it('mismo DTE dos veces en el envío: el XSD lo rechaza por ID duplicado (1)', () => {
    const a = analizarEnvioRecibido(sobre([factura(9), factura(9)]), receptorB);
    expect(a.estado).toBe(EstadoRecepEnv.ERROR_SCHEMA);
    expect(a.erroresXsd.join(' ')).toMatch(/F9T33/);
  });
});

describe('respuestas generadas', () => {
  it('RecepcionEnvio de un envío OK: XSD y firma válidos', () => {
    const a = analizarEnvioRecibido(envioOk, receptorB, {}, { nombreArchivo: 'envio1.xml', codigoEnvio: 7, fechaRecepcion: fechaFirma });
    const r = construirRecepcionEnvio(a, datosRespuesta);
    esperarValido(r.xmlIso, 'RespuestaEnvioDTE');
    expect(r.xml).toContain('<RutResponde>12345678-5</RutResponde><RutRecibe>76086428-5</RutRecibe>');
    expect(r.xml).toContain('<EstadoRecepEnv>0</EstadoRecepEnv>');
    expect(r.xml).toContain('<NroDTE>2</NroDTE>');
    expect(r.xml.match(/<RecepcionDTE>/g)).toHaveLength(2);
    expect(r.xml).toContain('<Resultado ID="Resultado">');
    expect(r.xmlIso.subarray(0, 45).toString('latin1')).toContain('encoding="ISO-8859-1"');
    expect(r.xmlIso.includes(0xd1)).toBe(true); // Ñ en Latin-1
  });

  it('RecepcionEnvio con envíos rechazados (2, 3, 90) y DTE repetido valida', () => {
    const analisis = [
      analizarEnvioRecibido(conFirmaDelSobreAlterada(envioOk), receptorB, {}, { codigoEnvio: 1 }),
      analizarEnvioRecibido(envioOk, { rut: '11222333', dv: '9' }, {}, { codigoEnvio: 2 }),
      analizarEnvioRecibido(envioOk, receptorB, { envios: [{ idSet: 'SetDoc', rutEmisor: RUT_A }] }, { codigoEnvio: 3 }),
      analizarEnvioRecibido(envioOk, receptorB, { dtes: [{ rutEmisor: RUT_A, tipoDte: 33, folio: 1 }] }, { codigoEnvio: 4 }),
    ];
    expect(analisis.map((x) => x.estado)).toEqual([2, 3, 90, 0]);
    esperarValido(construirRecepcionEnvio(analisis, datosRespuesta).xmlIso, 'RespuestaEnvioDTE');
  });

  it('RecepcionEnvio de un archivo ilegible (91) exige rutRecibe y valida', () => {
    const a = analizarEnvioRecibido(Buffer.from('basura'), receptorB);
    expect(() => construirRecepcionEnvio(a, datosRespuesta)).toThrow(/rutRecibe/);
    const r = construirRecepcionEnvio(a, { ...datosRespuesta, rutRecibe: RUT_A });
    esperarValido(r.xmlIso, 'RespuestaEnvioDTE');
    expect(r.xml).toContain('<EstadoRecepEnv>91</EstadoRecepEnv>');
  });

  it('ResultadoDTE (aceptado, con discrepancias y rechazado Ley 19.983): XSD y firma válidos', () => {
    const a = analizarEnvioRecibido(envioOk, receptorB, {}, { codigoEnvio: 7 });
    const resultados = [
      resultadoDesdeAnalisis(a.dtes[0], 7),
      resultadoDesdeAnalisis(a.dtes[1], 7, EstadoDte.RECHAZADO, 'RECHAZADO: mercaderias no recibidas, Ley 19.983', -1),
      resultadoDesdeAnalisis(a.dtes[1], 7, EstadoDte.ACEPTADO_CON_DISCREPANCIAS),
    ];
    const r = construirResultadoDte(resultados, { ...datosRespuesta, rutResponde: RUT_B });
    esperarValido(r.xmlIso, 'RespuestaEnvioDTE');
    expect(r.xml).toContain('<NroDetalles>3</NroDetalles>');
    expect(r.xml).toContain('<CodRchDsc>-1</CodRchDsc>');
    expect(r.xml).toContain('<EstadoDTE>0</EstadoDTE>');
    expect(() => construirResultadoDte(resultados, datosRespuesta)).toThrow(/rutResponde/);
    expect(() =>
      construirResultadoDte([{ ...resultados[0], codigoRechazo: 5 }], { ...datosRespuesta, rutResponde: RUT_B }),
    ).toThrow(/negativo/);
  });

  it('EnvioRecibos: un Recibo firmado por DTE + firma del set; todo válido', () => {
    const a = analizarEnvioRecibido(envioOk, receptorB);
    const docs = a.dtes.map(documentoRecibidoDesdeAnalisis);
    const r = construirEnvioRecibos(docs, {
      rutResponde: RUT_B, rutFirma: '11111111-1', recinto: 'Bodega Central, Santiago', certificado: certB,
      nombreContacto: 'Contacto', mailContacto: 'c@receptor.cl', fechaFirma,
    });
    esperarValido(r.xmlIso, 'EnvioRecibos');
    expect(r.xml).toContain(`<Declaracion>${DECLARACION_LEY_19983}</Declaracion>`);
    expect(r.xml.match(/<Recibo /g)).toHaveLength(2);
    // 2 firmas de Recibo + 1 del set
    expect(r.xml.match(/<Signature /g)).toHaveLength(3);
    expect(r.xml).toContain('<Reference URI="#SetRecibos">');
    expect(r.xml).toContain('<Reference URI="#R1T33F1">');
    expect(r.xml).toContain('<Reference URI="#R2T33F2">');
    // Cada Recibo también verifica por separado (firma individual).
    const recibos = r.xml.match(/<Recibo [\s\S]*?<\/Recibo>/g) ?? [];
    expect(recibos).toHaveLength(2);
    for (const rec of recibos) expect(verificarFirmaXml(rec).valida).toBe(true);
  });

  it('EnvioRecibos: alterar un recibo rompe la verificación', () => {
    const docs = analizarEnvioRecibido(envioOk, receptorB).dtes.map(documentoRecibidoDesdeAnalisis);
    const r = construirEnvioRecibos(docs, { rutResponde: RUT_B, rutFirma: RUT_B, recinto: 'Oficina', certificado: certB, fechaFirma });
    const alterado = r.xml.replace('<Recinto>Oficina</Recinto>', '<Recinto>Otro</Recinto>');
    expect(verificarFirmaXml(alterado).valida).toBe(false);
  });

  it('validaciones de entrada de los constructores', () => {
    const base = { rutResponde: RUT_B, rutFirma: RUT_B, recinto: 'X', certificado: certB };
    const doc = { tipoDoc: 33, folio: 1, fechaEmision: '2026-02-01', rutEmisor: RUT_A, rutReceptor: RUT_B, montoTotal: 1 };
    expect(() => construirEnvioRecibos([], base)).toThrow();
    expect(() => construirEnvioRecibos([{ ...doc, tipoDoc: 39 }], base)).toThrow(/no admitido/);
    expect(() => construirEnvioRecibos([{ ...doc, rutEmisor: '76086428-0' }], base)).toThrow(/RUT/);
  });
});
