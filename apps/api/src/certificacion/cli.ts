import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { DocumentosService } from '../documentos/documentos.service.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { EnviosService } from '../envios/envios.service.js';
import { LibrosService } from '../libros/libros.service.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { ejecutarSet } from './ejecutar-set.js';
import { parsearComprasSet, parsearSet } from './index.js';

const AYUDA = `Uso: npm run certificacion:set -- --empresa <rut> --archivo <set.txt|set.json> [opciones]

  --empresa   RUT de la empresa emisora (76086428-5)
  --archivo   Set de pruebas: texto del SII o JSON (ver src/certificacion/README.md)
  --simular   No envía al SII ni consume folios: genera XML, PDF y sobre en --salida
  --salida    Carpeta de salida del modo simulado (por defecto ./salida-set)
  --fecha     Fecha de emisión yyyy-mm-dd (por defecto hoy, America/Santiago)
  --clave     Prefijo de las claves de idempotencia (por defecto set-<número de atención>)

Libros del set (IEV/IEC, ver docs/certificacion/GUIA-CERTIFICACION.md):
  --libros    Genera el Libro de Ventas (ESPECIAL, folio de notificación 1) con los documentos del set
  --compras   JSON con los documentos recibidos del set de compras: genera el Libro de Compras (folio 2)
  --guias     Genera además el Libro de Guías de Despacho (folio 3) si el set trae guías (52)
  --enviar-libros  Modo real: sube los libros al SII (sin esto solo se guardan)
  --periodo   Período tributario AAAA-MM de los libros (por defecto el mes de --fecha / hoy)
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      empresa: { type: 'string' },
      archivo: { type: 'string' },
      simular: { type: 'boolean', default: false },
      salida: { type: 'string' },
      fecha: { type: 'string' },
      clave: { type: 'string' },
      libros: { type: 'boolean', default: false },
      compras: { type: 'string' },
      guias: { type: 'boolean', default: false },
      'enviar-libros': { type: 'boolean', default: false },
      periodo: { type: 'string' },
      ayuda: { type: 'boolean', default: false },
    },
  });
  if (values.ayuda || !values.empresa || !values.archivo) {
    console.log(AYUDA);
    return values.ayuda ? 0 : 1;
  }

  const set = parsearSet(await readFile(values.archivo, 'utf8'));
  console.log(
    `Set ${set.numeroAtencion ?? '(sin número)'}: ${set.casos.length} casos`,
  );
  for (const a of set.advertencias) console.warn(`  ! ${a}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const r = await ejecutarSet(
      {
        ejecutor: app.get(EjecutorEmpresa),
        empresas: app.get(EmpresasService),
        documentos: app.get(DocumentosService),
        envios: app.get(EnviosService),
        sii: app.get(SiiClienteFactory),
        libros: app.get(LibrosService),
      },
      set,
      {
        rutEmpresa: values.empresa,
        simular: values.simular,
        carpetaSalida: values.salida,
        fecha: values.fecha,
        prefijoClave: values.clave,
        ...(values.libros || values.compras || values.guias
          ? {
              libros: {
                ventas: values.libros || !values.compras,
                ...(values.compras
                  ? { compras: parsearComprasSet(await readFile(values.compras, 'utf8')) }
                  : {}),
                guias: values.guias,
                enviar: values['enviar-libros'],
                periodo: values.periodo,
              },
            }
          : {}),
        log: (m) => console.log(m),
      },
    );
    for (const a of r.advertencias) console.warn(`  ! ${a}`);
    for (const l of r.libros) {
      console.log(`Libro ${l.tipo} ${l.periodo}: ${l.documentos} documentos${l.id ? ` (id ${l.id}${l.trackId ? `, TRACK ID ${l.trackId}` : ''})` : ''}`);
    }
    if (r.simulado) {
      console.log(`Archivos generados (${r.archivos.length}):`);
      for (const f of r.archivos) console.log(`  ${f}`);
    } else {
      for (const e of r.envios) console.log(`TRACK ID ${e.trackId} (${e.canal}, ${e.documentos} documentos)`);
      console.log(
        'Consulte el estado con POST /v1/envios/<id>/consultar (el SII tarda unos minutos en procesar).',
      );
    }
    return 0;
  } finally {
    await app.close();
  }
}

process.exitCode = await main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  return 1;
});
