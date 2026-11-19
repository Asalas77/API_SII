import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource, EntityManager } from 'typeorm';
import { fechaSantiago } from '../comun/fechas.js';
import { DocumentosService } from '../documentos/documentos.service.js';
import type { Documento } from '../documentos/entities/documento.entity.js';
import { aIso88591, validarXsd } from '../dte-core/index.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { EnviosService } from '../envios/envios.service.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import {
  type CasoEmitido,
  casoADocumento,
  receptoresDePrueba,
} from './generador.js';
import { ErrorSetPruebas, type SetPruebas } from './tipos.js';

export interface ServiciosCertificacion {
  dataSource: DataSource;
  empresas: EmpresasService;
  documentos: DocumentosService;
  envios: EnviosService;
  sii: SiiClienteFactory;
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
  advertencias: string[];
}

class Reversion extends Error {}

const BOLETAS = [39, 41];

/** Emite todos los casos del set (en orden) y los envía, o los simula. */
export async function ejecutarSet(
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
    advertencias: [...set.advertencias],
  };
  if (set.casos.length === 0) throw new ErrorSetPruebas('El set no tiene casos');

  const receptores = receptoresDePrueba(set.casos.length);
  const emitidos = new Map<string, CasoEmitido>();
  const docs: Array<{ caso: string; doc: Documento }> = [];
  const prefijo = o.prefijoClave ?? `set-${set.numeroAtencion ?? 'sin-numero'}`;

  const emitirTodos = async (manager?: EntityManager) => {
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
        { manager },
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
      await svc.dataSource.transaction(async (em) => {
        await emitirTodos(em);
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
  return resultado;
}
