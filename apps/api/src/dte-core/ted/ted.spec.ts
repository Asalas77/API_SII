import { parsearCaf } from '../caf/caf.js';
import { generarCafPrueba } from '../testing/testing.js';
import { type DatosTed, generarTed, verificarTed } from './ted.js';

const caf = parsearCaf(generarCafPrueba({ tipoDte: 33, folioDesde: 1, folioHasta: 100, rutEmisor: '76086428-5' }));

const datos: DatosTed = {
  rutEmisor: '76086428-5',
  tipoDte: 33,
  folio: 7,
  fechaEmision: '2026-02-01',
  rutReceptor: '66666666-6',
  razonSocialReceptor: 'Compañía Ñandú & Hijos <Ltda>',
  monto: 11900,
  itemPrimero: 'Producto con descripción larga que excede los cuarenta caracteres',
  timestamp: '2026-02-01T10:20:30',
};

describe('generarTed / verificarTed', () => {
  const ted = generarTed(datos, caf);

  it('respeta el orden de tags, sin espacios, y trunca RSR/IT1 a 40', () => {
    const esperado =
      /^<TED version="1\.0"><DD><RE>76086428-5<\/RE><TD>33<\/TD><F>7<\/F><FE>2026-02-01<\/FE><RR>66666666-6<\/RR><RSR>([^<]*)<\/RSR><MNT>11900<\/MNT><IT1>([^<]*)<\/IT1><CAF version="1\.0">/;
    const m = esperado.exec(ted);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('Compañía Ñandú &amp; Hijos &lt;Ltda&gt;');
    expect(m![2]).toBe('Producto con descripción larga que exced');
    expect(m![2]).toHaveLength(40);
    expect(ted).toContain(`${caf.xmlCaf}<TSTED>2026-02-01T10:20:30</TSTED></DD><FRMT algoritmo="SHA1withRSA">`);
    expect(ted.endsWith('</FRMT></TED>')).toBe(true);
    expect(ted).not.toMatch(/>\s+</);
  });

  it('el truncado se hace sobre el texto crudo (40 caracteres)', () => {
    const t = generarTed({ ...datos, razonSocialReceptor: 'A'.repeat(50) }, caf);
    expect(/<RSR>(A+)<\/RSR>/.exec(t)![1]).toHaveLength(40);
  });

  it('la firma verifica con la clave pública del CAF', () => {
    expect(verificarTed(ted, caf.clavePublicaPem)).toBe(true);
  });

  it('detecta alteraciones del DD, de la firma y claves ajenas', () => {
    expect(verificarTed(ted.replace('<MNT>11900', '<MNT>11901'), caf.clavePublicaPem)).toBe(false);
    expect(verificarTed(ted.replace(/<FRMT([^>]*)>.{4}/, '<FRMT$1>AAAA'), caf.clavePublicaPem)).toBe(false);
    const otro = parsearCaf(generarCafPrueba({ tipoDte: 33, folioDesde: 1, folioHasta: 2, rutEmisor: '76086428-5' }));
    expect(verificarTed(ted, otro.clavePublicaPem)).toBe(false);
    expect(verificarTed('<TED></TED>', caf.clavePublicaPem)).toBe(false);
  });

  it('usa timestamp actual en hora de Chile por defecto', () => {
    const t = generarTed({ ...datos, timestamp: undefined }, caf);
    expect(t).toMatch(/<TSTED>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}<\/TSTED>/);
  });
});
