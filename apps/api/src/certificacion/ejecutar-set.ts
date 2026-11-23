import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fechaSantiago } from '../comun/fechas.js';
import { comoSistema } from '../database/contexto-empresa.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { DocumentosService } from '../documentos/documentos.service.js';
import type { Documento } from '../documentos/entities/documento.entity.js';
import { aIso88591, validarXsd } from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { EnviosService } from '../envios/envios.service.js';
import type { LibroArmado, LibrosService } from '../libros/libros.service.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import {
  type CasoEmitido,
  casoADocumento,
  receptoresDePrueba,
} from './generador.js';
import type { ComprasSet } from './libros-set.js';
import { ErrorSetPruebas, type SetPruebas } from './tipos.js';

export interface ServiciosCertificacion {
  /** Ejecutor de base de datos; la CLI corre con contexto de sistema (ver `ejecutarSet`). */
  ejecutor: EjecutorEmpresa;
  empresas: EmpresasService;
  documentos: DocumentosService;
  envios: EnviosService;
  sii: SiiClienteFactory;
  /** Requerido solo si se piden libros (`OpcionesEjecutarSet.libros`). */
  libros?: LibrosService;
}

/**
 * Libros del set (instrucciones del SII, secciones III y IV): Libro de Ventas (ESPECIAL, TOTAL, folio de
 * notificación 1) con los documentos emitidos del set, y Libro de Compras (ESPECIAL, TOTAL, folio 2) con los
 * documentos recibidos que entrega el SII (JSON). El libro de guías no forma parte del set; se genera solo
 * si se pide y hay guías (tipo 52).
 */
export interface OpcionesLibrosSet {
  /** Libro de ventas con las facturas y notas emitidas (por defecto true). */
  ventas?: boolean;
  compras?: ComprasSet;
  guias?: boolean;
  /** Modo real: además de guardar los libros, los sube al SII. */
  enviar?: boolean;
  /** `AAAA-MM`; por defecto el mes de la fecha de emisión. */
  periodo?: string;
  folioVentas?: number;
  folioCompras?: number;
  folioGuias?: number;
}

export interface OpcionesEjecutarSet {
  /** RUT de la empresa emisora (`76086428-5`). */
  rutEmpresa: string;
  /**
   * true: emite dentro de una transacción que se REVIERTE (no consume folios ni deja documentos),
   * escribe XML, PDF y el sobre en `carpetaSalida` y NO envía nada al SII.
   */
  simular: boolean;
  carpetaSalida?: string;
  /** Fecha de emisión `yyyy-mm-dd` (por defecto hoy en America/Santiago). */
  fecha?: string;
  /** Prefijo de las claves de idempotencia del modo real (por defecto `set-<atención>`). */
  prefijoClave?: string;
  /** Si se indica, genera (y en modo real guarda/envía) los libros del set. */
  libros?: OpcionesLibrosSet;
  log?: (mensaje: string) => void;
}

export interface ResultadoSet {
  simulado: boolean;
  documentos: Array<{
    caso: string;
    tipoDte: number;
    folio: number;
    id?: string;
    estado?: string;
  }>;
  envios: Array<{
    canal: string;
    trackId: string | null;
    documentos: number;
  }>;
  archivos: string[];
  /** Libros generados (en modo simulado solo se escriben los archivos; no se guardan). */
  libros: Array<{
    tipo: 'VENTA' | 'COMPRA' | 'GUIA';
    periodo: string;
    documentos: number;
    id?: string;
    trackId?: string | null;
  }>;
  advertencias: string[];
}

class Reversion extends Error {}

const BOLETAS = [39, 41];

/**
 * Emite todos los casos del set (en orden) y los envía, o los simula.
 *
 * Es un proceso interno y de confianza (CLI): corre con el contexto `sistema` (todas las empresas)
 * de RLS, igual que el admin, y accede a la empresa indicada por `rutEmpresa`.
 */
export async function ejecutarSet(
  svc: ServiciosCertificacion,
  set: SetPruebas,
  o: OpcionesEjecutarSet,
): Promise<ResultadoSet> {
  return comoSistema(() => ejecutarSetEnContexto(svc, set, o));
}

async function ejecutarSetEnContexto(
  svc: ServiciosCertificacion,
  set: SetPruebas,
  o: OpcionesEjecutarSet,
): Promise<ResultadoSet> {
  const log = o.log ?? (() => undefined);
  const fecha = o.fecha ?? fechaSantiago();
  const empresa = await svc.empresas.obtenerPorRut(o.rutEmpresa);
  const resultado: ResultadoSet = {
    simulado: o.simular,
    documentos: [],
    envios: [],
    archivos: [],
    libros: [],
    advertencias: [...set.advertencias],
  };
  if (set.casos.length === 0) throw new ErrorSetPruebas('El set no tiene casos');

  const receptores = receptoresDePrueba(set.casos.length);
  const emitidos = new Map<string, CasoEmitido>();
  const docs: Array<{ caso: string; doc: Documento }> = [];
  const prefijo = o.prefijoClave ?? `set-${set.numeroAtencion ?? 'sin-numero'}`;

  const emitirTodos = async () => {
    for (const [i, caso] of set.casos.entries()) {
      const dto = casoADocumento(caso, {
        fechaEmision: fecha,
        receptor: receptores[i],
        emitidos,
      });
      const { resultado: r } = await svc.documentos.emitir(
        o.rutEmpresa,
        dto,
        o.simular ? undefined : `${prefijo}-${caso.id}`,
        // El set del SII no trae datos de transporte: exento de EXIGIR_TRASLADO_GUIAS.
        { omitirExigenciaTraslado: true },
      );
      emitidos.set(caso.id, {
        tipoDte: r.documento.tipoDte,
        folio: r.documento.folio,
        fechaEmision: r.documento.fechaEmision,
        items: caso.items,
      });
      docs.push({ caso: caso.id, doc: r.documento });
      log(
        `Caso ${caso.id}: tipo ${r.documento.tipoDte} folio ${r.documento.folio} total ${r.documento.montoTotal}${r.repetido ? ' (ya emitido antes)' : ''}`,
      );
    }
  };

  const agruparPorCanal = (lista: Documento[]) => {
    const boletas = lista.filter((d) => BOLETAS.includes(d.tipoDte));
    const dte = lista.filter((d) => !BOLETAS.includes(d.tipoDte));
    return [dte, boletas].filter((g) => g.length > 0);
  };

  if (o.simular) {
    const carpeta = o.carpetaSalida ?? join(process.cwd(), 'salida-set');
    await mkdir(carpeta, { recursive: true });
    try {
      // La transacción vigente (ALS) la reutilizan emitir() y los folios mediante savepoints.
      await svc.ejecutor.ejecutarComoSistema(async () => {
        await emitirTodos();
        const certificado = await svc.sii.certificadoActivo(empresa.id);
        for (const { caso, doc } of docs) {
          const base = `${caso}_T${doc.tipoDte}_F${doc.folio}`;
          const rutaXml = join(carpeta, `${base}.xml`);
          await writeFile(rutaXml, aIso88591(doc.xmlFirmado));
          resultado.archivos.push(rutaXml);
          try {
            const pdf = await svc.documentos.pdfDe(doc, empresa, {
              cedible: doc.tipoDte === 33 || doc.tipoDte === 34,
            });
            const rutaPdf = join(carpeta, `${base}.pdf`);
            await writeFile(rutaPdf, pdf.buffer);
            resultado.archivos.push(rutaPdf);
          } catch (e) {
            resultado.advertencias.push(
              `PDF del caso ${caso} no generado: ${(e as Error).message}`,
            );
          }
        }
        for (const grupo of agruparPorCanal(docs.map((d) => d.doc))) {
          const { canal, grupos } = svc.envios.agrupar(grupo);
          for (const [n, lote] of grupos.entries()) {
            const sobre = svc.envios.construirSobre(empresa, canal, lote, certificado);
            const nombre = `${canal === 'boleta' ? 'EnvioBOLETA' : 'EnvioDTE'}${grupos.length > 1 ? `_${n + 1}` : ''}.xml`;
            const ruta = join(carpeta, nombre);
            await writeFile(ruta, sobre.xmlIso);
            resultado.archivos.push(ruta);
            const xsd = validarXsd(sobre.xml, canal === 'boleta' ? 'EnvioBOLETA' : 'EnvioDTE');
            log(`${nombre}: ${xsd.valido ? 'válido contra el XSD' : `INVÁLIDO: ${xsd.errores.join('; ')}`}`);
            if (!xsd.valido) resultado.advertencias.push(`${nombre} inválido: ${xsd.errores.join('; ')}`);
            resultado.envios.push({ canal, trackId: null, documentos: lote.length });
          }
        }
        resultado.documentos = docs.map(({ caso, doc }) => ({
          caso,
          tipoDte: doc.tipoDte,
          folio: doc.folio,
        }));
        if (o.libros) {
          await generarLibros(svc, empresa, o, fecha, docs.map((d) => d.doc), resultado, carpeta, certificado);
        }
        throw new Reversion(); // no consumir folios ni dejar documentos
      });
    } catch (e) {
      if (!(e instanceof Reversion)) throw e;
    }
    log('Simulación terminada: se revirtieron los folios y no se envió nada al SII.');
    return resultado;
  }

  // --- Modo real ---
  await emitirTodos();
  resultado.documentos = docs.map(({ caso, doc }) => ({
    caso,
    tipoDte: doc.tipoDte,
    folio: doc.folio,
    id: doc.id,
    estado: doc.estado,
  }));
  for (const grupo of agruparPorCanal(docs.map((d) => d.doc))) {
    const pendientes = grupo.filter((d) => d.estado === 'emitido');
    if (pendientes.length !== grupo.length) {
      resultado.advertencias.push(
        `${grupo.length - pendientes.length} documento(s) ya habían sido enviados en una ejecución anterior; no se reenvían`,
      );
    }
    if (pendientes.length === 0) continue;
    const envios = await svc.envios.crear(o.rutEmpresa, {
      documentoIds: pendientes.map((d) => d.id),
    });
    for (const e of envios) {
      log(`Envío ${e.canal}: track id ${e.trackId} (${e.documentos.length} documentos)`);
      resultado.envios.push({
        canal: e.canal,
        trackId: e.trackId,
        documentos: e.documentos.length,
      });
    }
  }
  if (o.libros) {
    await generarLibros(svc, empresa, o, fecha, docs.map((d) => d.doc), resultado);
  }
  return resultado;
}

const TIPOS_VENTAS_LIBRO = [33, 34, 56, 61, 110, 111, 112];

/**
 * Genera los libros del set. En modo simulado arma y valida los libros (sin guardar ni enviar) y
 * escribe sus XML; en modo real los guarda y, con `libros.enviar`, los sube al SII.
 */
async function generarLibros(
  svc: ServiciosCertificacion,
  empresa: Empresa,
  o: OpcionesEjecutarSet,
  fecha: string,
  docs: Documento[],
  resultado: ResultadoSet,
  carpeta?: string,
  certificado?: Awaited<ReturnType<SiiClienteFactory['certificadoActivo']>>,
): Promise<void> {
  const opciones = o.libros as OpcionesLibrosSet;
  const libros = svc.libros;
  if (!libros) throw new ErrorSetPruebas('Para generar libros se requiere el servicio de libros (LibrosService)');
  const log = o.log ?? (() => undefined);
  const periodo = opciones.periodo ?? fecha.slice(0, 7);
  const ids = (tipos: number[]) => docs.filter((d) => tipos.includes(d.tipoDte)).map((d) => d.id);

  const tareas: Array<{
    tipo: 'VENTA' | 'COMPRA' | 'GUIA';
    nombre: string;
    armar: () => Promise<LibroArmado>;
    generar: () => ReturnType<LibrosService['generarVentas']>;
  }> = [];

  const ventasIds = ids(TIPOS_VENTAS_LIBRO);
  if (opciones.ventas !== false) {
    if (ventasIds.length === 0) {
      resultado.advertencias.push('Libro de ventas omitido: el set no emitió facturas ni notas (33, 34, 56, 61, 110, 111, 112)');
    } else {
      const dto = {
        periodo,
        tipoLibro: 'ESPECIAL' as const,
        tipoEnvio: 'TOTAL' as const,
        folioNotificacion: opciones.folioVentas ?? 1,
        incluirBoletas: false,
        documentoIds: ventasIds,
        enviar: opciones.enviar === true,
      };
      tareas.push({
        tipo: 'VENTA',
        nombre: 'LibroVentas.xml',
        armar: () => libros.armarVentas(empresa, dto, { certificado }),
        generar: () => libros.generarVentas(o.rutEmpresa, dto),
      });
    }
  }
  if (opciones.compras) {
    const dto = {
      periodo,
      tipoLibro: 'ESPECIAL' as const,
      tipoEnvio: 'TOTAL' as const,
      folioNotificacion: opciones.folioCompras ?? 2,
      documentos: opciones.compras.documentos,
      ...(opciones.compras.factorProporcionalidad !== undefined
        ? { factorProporcionalidad: opciones.compras.factorProporcionalidad }
        : {}),
      enviar: opciones.enviar === true,
    };
    tareas.push({
      tipo: 'COMPRA',
      nombre: 'LibroCompras.xml',
      armar: () => libros.armarCompras(empresa, dto, { certificado }),
      generar: () => libros.generarCompras(o.rutEmpresa, dto),
    });
  }
  if (opciones.guias) {
    const guiasIds = ids([52]);
    if (guiasIds.length === 0) {
      resultado.advertencias.push('Libro de guías omitido: el set no emitió guías de despacho (52)');
    } else {
      const dto = {
        periodo,
        tipoLibro: 'ESPECIAL' as const,
        tipoEnvio: 'TOTAL' as const,
        folioNotificacion: opciones.folioGuias ?? 3,
        documentoIds: guiasIds,
        enviar: opciones.enviar === true,
      };
      tareas.push({
        tipo: 'GUIA',
        nombre: 'LibroGuias.xml',
        armar: () => libros.armarGuias(empresa, dto, { certificado }),
        generar: () => libros.generarGuias(o.rutEmpresa, dto),
      });
    }
  }

  for (const t of tareas) {
    if (o.simular) {
      const armado = await t.armar();
      const ruta = join(carpeta ?? process.cwd(), t.nombre);
      await writeFile(ruta, armado.xmlIso);
      resultado.archivos.push(ruta);
      resultado.advertencias.push(...armado.advertencias);
      resultado.libros.push({ tipo: t.tipo, periodo, documentos: armado.cantidadDocumentos });
      log(`${t.nombre}: válido contra el XSD (${armado.cantidadDocumentos} documentos)`);
    } else {
      const r = await t.generar();
      resultado.libros.push({
        tipo: t.tipo,
        periodo,
        documentos: r.cantidadDocumentos,
        id: r.id,
        trackId: r.trackId,
      });
      log(`Libro ${t.tipo}: id ${r.id}${r.trackId ? `, track id ${r.trackId}` : ' (guardado, sin enviar)'}`);
    }
  }
}
