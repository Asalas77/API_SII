import { ClienteApiSii } from '../src/api-sii.js';
import { type Config, leerConfig } from '../src/config.js';
import { crearLogger } from '../src/log.js';
import { ClienteServiceLayer } from '../src/service-layer.js';
import { Worker } from '../src/worker.js';
import { ApiSimulada } from './api-simulada.js';
import { RUT_EMPRESA, socio, socioConsumidorFinal } from './fixtures.js';
import { ServiceLayerSimulado } from './sl-simulado.js';

export class Entorno {
  readonly sl = new ServiceLayerSimulado();
  readonly api = new ApiSimulada();
  readonly logs: string[] = [];
  config!: Config;
  cliente!: ClienteServiceLayer;
  worker!: Worker;
  reloj = Date.now();

  async iniciar(env: Record<string, string> = {}): Promise<this> {
    await this.sl.iniciar();
    await this.api.iniciar();
    this.config = leerConfig({
      SL_URL: this.sl.url,
      SL_VERSION: 'v2',
      SL_COMPANY_DB: this.sl.credenciales.companyDb,
      SL_USER: this.sl.credenciales.usuario,
      SL_PASSWORD: this.sl.credenciales.password,
      API_URL: this.api.url,
      API_KEY: this.api.apiKey,
      EMPRESA_RUT: RUT_EMPRESA,
      SL_PAGINA_MAX: '2',
      BACKOFF_BASE_MS: '0',
      SEGUIMIENTO_MIN_SEGUNDOS: '0',
      ...env,
    });
    // Sin lista de secretos a propósito: el código no debe escribirlos nunca.
    const log = crearLogger({ salida: (l) => this.logs.push(l) });
    this.cliente = new ClienteServiceLayer(this.config.sl, log);
    this.worker = new Worker(this.config, this.cliente, new ClienteApiSii(this.config.api), log, () => this.reloj);
    this.sl.socios.set('C20000', socio() as unknown as Record<string, unknown>);
    this.sl.socios.set('C99999', socioConsumidorFinal() as unknown as Record<string, unknown>);
    return this;
  }

  async detener(): Promise<void> {
    await this.sl.detener();
    await this.api.detener();
  }
}
