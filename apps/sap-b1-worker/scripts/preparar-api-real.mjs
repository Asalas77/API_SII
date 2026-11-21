// Prepara datos de prueba en una API REAL para el e2e opcional (test/e2e.spec.ts).
//
// Uso (con la API en marcha, p. ej. PORT=3055):
//   node scripts/preparar-api-real.mjs --api http://localhost:3055 --api-env ../api/.env
//
// Crea una empresa de prueba con RUT aleatorio, un PFX sintético, CAF sintéticos (RSA 512) de
// 33/34/61 y una API key acotada a esa empresa. Imprime las variables para el e2e (la API key de
// prueba se muestra una vez). Requiere API_ADMIN_KEY (se lee del .env de la API, no se imprime) y
// la API compilada (`npm run build` en apps/api): reutiliza sus helpers de prueba desde dist/.
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const api = arg('--api', 'http://localhost:3000').replace(/\/+$/, '');
const apiEnv = resolve(arg('--api-env', '../api/.env'));
process.loadEnvFile(apiEnv);
const admin = process.env.API_ADMIN_KEY;
if (!admin) throw new Error('API_ADMIN_KEY no está definida');
const dist = resolve(apiEnv, '..', 'dist');
const { generarPfxPrueba } = await import(pathToFileURL(resolve(dist, 'dte-core/testing/testing.js')).href);
const { generarCafRealista } = await import(pathToFileURL(resolve(dist, 'testing/caf-realista.js')).href);

function dv(c) { let s = 0, f = 2; for (let i = c.length - 1; i >= 0; i--) { s += +c[i] * f; f = f === 7 ? 2 : f + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); }
const cuerpo = String(randomInt(70_000_000, 79_999_999));
const rut = `${cuerpo}-${dv(cuerpo)}`;

async function llamar(metodo, ruta, { json, form } = {}) {
  const r = await fetch(`${api}/v1${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${admin}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${ruta} -> ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}

await llamar('POST', '/empresas', { json: {
  rut, razonSocial: 'PRUEBA WORKER B1 (BORRAR)', giro: 'Servicios de prueba', actecos: [620200],
  direccion: 'Calle Falsa 123', comuna: 'Santiago', ciudad: 'Santiago',
  nroResolucionSii: 0, fechaResolucionSii: '2026-01-01', ambienteSii: 'certificacion',
} });

const pfxPass = 'prueba-pfx-1';
const pfx = generarPfxPrueba(pfxPass, { rut: '11111111-1', nombre: 'Firmante Prueba' });
const f = new FormData();
f.append('archivo', new Blob([pfx]), 'prueba.pfx');
f.append('password', pfxPass);
f.append('rutFirmante', '11111111-1');
await llamar('POST', `/empresas/${rut}/certificados`, { form: f });

for (const tipo of [33, 34, 61]) {
  const xml = generarCafRealista({ tipoDte: tipo, folioDesde: 1, folioHasta: 500, rutEmisor: rut, razonSocial: 'PRUEBA WORKER B1 (BORRAR)' });
  await llamar('POST', `/empresas/${rut}/cafs`, { json: { xml } });
}

const k = await llamar('POST', '/api-keys', { json: {
  nombre: 'worker-b1-prueba (borrar)',
  permisos: ['documentos.emitir', 'documentos.leer', 'envios.crear', 'envios.leer'],
  empresas: [rut],
} });
console.log(`API_URL=${api}\nEMPRESA_RUT=${rut}\nAPI_KEY=${k.clave}\nAPI_KEY_ID=${k.id ?? ''}`);
