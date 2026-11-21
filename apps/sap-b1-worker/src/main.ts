import { ClienteApiSii } from './api-sii.js';
import { cargarEnv, ErrorConfig, leerConfig, secretos } from './config.js';
import { crearLogger } from './log.js';
import { ClienteServiceLayer } from './service-layer.js';
import { instalarUdfs } from './udfs.js';
import { Worker } from './worker.js';

const USO = `Uso: node dist/main.js <comando>

  start            ciclo continuo (npm start)
  once             un ciclo con conciliacion y termina (npm run once)
  instalar-udfs    crea los UDF U_SII_* en B1 (npm run instalar-udfs [-- --dry-run])
`;

async function main(): Promise<number> {
  const [comando, ...args] = process.argv.slice(2);
  if (!comando || !['start', 'once', 'instalar-udfs'].includes(comando)) {
    process.stderr.write(USO);
    return 2;
  }
  cargarEnv();
  const dryRun = comando === 'instalar-udfs' && args.includes('--dry-run');
  const cfg = leerConfig(process.env, {
    requiereSl: !dryRun,
    requiereApi: comando !== 'instalar-udfs',
  });
  const log = crearLogger({ secretos: secretos(cfg) });
  const sl = new ClienteServiceLayer(cfg.sl, log);

  if (comando === 'instalar-udfs') {
    const r = await instalarUdfs(dryRun ? null : sl, log, { dryRun });
    if (!dryRun) {
      await sl.cerrarSesion();
      log.info('instalacion de UDFs terminada', {
        creados: r.creados.length,
        existentes: r.existentes.length,
        errores: r.errores.length,
      });
    }
    return r.errores.length > 0 ? 1 : 0;
  }

  const worker = new Worker(cfg, sl, new ClienteApiSii(cfg.api), log);
  if (comando === 'once') {
    try {
      await worker.ciclo({ conciliar: true });
    } finally {
      await sl.cerrarSesion();
    }
    return 0;
  }

  const parar = (senal: string) => () => {
    log.info('senal recibida, apagado ordenado', { senal });
    worker.detener();
  };
  process.once('SIGINT', parar('SIGINT'));
  process.once('SIGTERM', parar('SIGTERM'));
  await worker.ejecutar();
  return 0;
}

main().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (e: unknown) => {
    if (e instanceof ErrorConfig) process.stderr.write(`${e.message}\n`);
    else process.stderr.write(`Error fatal: ${(e as Error).message}\n`);
    process.exitCode = 1;
  },
);
