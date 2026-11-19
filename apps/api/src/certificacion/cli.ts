import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { DocumentosService } from '../documentos/documentos.service.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { EnviosService } from '../envios/envios.service.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { ejecutarSet } from './ejecutar-set.js';
import { parsearSet } from './index.js';

const AYUDA = `Uso: npm run certificacion:set -- --empresa <rut> --archivo <set.txt|set.json> [opciones]

  --empresa   RUT de la empresa emisora (76086428-5)
  --archivo   Set de pruebas: texto del SII o JSON (ver src/certificacion/README.md)
  --simular   No envía al SII ni consume folios: genera XML, PDF y sobre en --salida
  --salida    Carpeta de salida del modo simulado (por defecto ./salida-set)
  --fecha     Fecha de emisión yyyy-mm-dd (por defecto hoy, America/Santiago)
  --clave     Prefijo de las claves de idempotencia (por defecto set-<número de atención>)
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
        dataSource: app.get(DataSource),
        empresas: app.get(EmpresasService),
        documentos: app.get(DocumentosService),
        envios: app.get(EnviosService),
        sii: app.get(SiiClienteFactory),
      },
      set,
      {
        rutEmpresa: values.empresa,
        simular: values.simular,
        carpetaSalida: values.salida,
        fecha: values.fecha,
        prefijoClave: values.clave,
        log: (m) => console.log(m),
      },
    );
    for (const a of r.advertencias) console.warn(`  ! ${a}`);
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
