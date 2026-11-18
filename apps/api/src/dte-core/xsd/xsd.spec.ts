import { aIso88591 } from '../xml/xml.util.js';
import { directorioXsdSii, validarXsd } from './xsd.js';

const respSiiValido =
  '<RESULTADO_ENVIO><IDENTIFICACION><RUTEMISOR>76086428-5</RUTEMISOR><RUTENVIA>12345678-5</RUTENVIA>' +
  '<TRACKID>123456</TRACKID><TMSTRECEPCION>2026-02-01 10:00:00</TMSTRECEPCION><ESTADO>REC</ESTADO>' +
  '</IDENTIFICACION></RESULTADO_ENVIO>';

describe('validarXsd', () => {
  it('encuentra la carpeta de XSD hacia arriba desde src', () => {
    expect(directorioXsdSii()).toMatch(/resources[\\/]sii[\\/]xsd$/);
  });

  it('acepta un XML mínimo válido contra RespSII', () => {
    expect(validarXsd(respSiiValido, 'RespSII')).toEqual({ valido: true, errores: [] });
  });

  it('acepta Buffer ISO-8859-1', () => {
    expect(validarXsd(aIso88591(respSiiValido), 'RespSII').valido).toBe(true);
  });

  it('XML inválido devuelve errores legibles con el nombre del elemento', () => {
    const r = validarXsd(respSiiValido.replace('<TRACKID>123456</TRACKID>', '<TRACKID>abc</TRACKID>'), 'RespSII');
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.errores.join('\n')).toContain('TRACKID');
    expect(r.errores[0]).toMatch(/^línea \d+/);
  });

  it('elemento faltante o desconocido se reporta', () => {
    const r = validarXsd('<RESULTADO_ENVIO><OTRO/></RESULTADO_ENVIO>', 'RespSII');
    expect(r.valido).toBe(false);
    expect(r.errores.join('\n')).toContain('OTRO');
  });

  it('XML mal formado devuelve error y no lanza', () => {
    const r = validarXsd('<a><b></a>', 'RespSII');
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
  });

  it.each(['DTE', 'EnvioDTE', 'EnvioBOLETA', 'RespuestaEnvioDTE'] as const)(
    'compila %s (includes/imports resueltos) y rechaza un documento vacío',
    (esquema) => {
      const r = validarXsd('<Vacio xmlns="http://www.sii.cl/SiiDte"/>', esquema);
      expect(r.valido).toBe(false);
      // Si el include no resolviera, el error sería de compilación del esquema (lanzaría).
      expect(r.errores.join('\n')).toContain('Vacio');
    },
  );
});
