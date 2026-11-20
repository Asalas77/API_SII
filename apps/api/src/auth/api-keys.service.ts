import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import {
  type AmbienteClave,
  generarApiKey,
  parsearApiKey,
  verificarClave,
} from './api-key.js';
import { ApiKey } from './entities/api-key.entity.js';
import { esPermiso, type Permiso } from './permisos.js';
import { contieneAcceso, type Principal } from './principal.js';

/** Mínimo entre actualizaciones de `ultimo_uso_en` de una misma clave. */
export const INTERVALO_ULTIMO_USO_MS = 60_000;

export interface CrearApiKeyDatos {
  nombre: string;
  permisos: Permiso[];
  empresas: string[];
  todasLasEmpresas: boolean;
  expiraEn?: Date | null;
}

export interface ApiKeyRespuesta {
  id: string;
  nombre: string;
  prefijo: string;
  permisos: string[];
  empresas: string[];
  todasLasEmpresas: boolean;
  estado: 'activa' | 'revocada' | 'expirada';
  expiraEn: Date | null;
  ultimoUsoEn: Date | null;
  creadaEn: Date;
  revocadaEn: Date | null;
}

export function estadoDe(k: ApiKey, ahora = new Date()): ApiKeyRespuesta['estado'] {
  if (!k.activa || k.revocadaEn) return 'revocada';
  if (k.expiraEn && k.expiraEn.getTime() <= ahora.getTime()) return 'expirada';
  return 'activa';
}

export function aRespuestaApiKey(k: ApiKey): ApiKeyRespuesta {
  return {
    id: k.id,
    nombre: k.nombre,
    prefijo: k.prefijo,
    permisos: k.permisos,
    empresas: k.empresas,
    todasLasEmpresas: k.todasLasEmpresas,
    estado: estadoDe(k),
    expiraEn: k.expiraEn,
    ultimoUsoEn: k.ultimoUsoEn,
    creadaEn: k.creadaEn,
    revocadaEn: k.revocadaEn,
  };
}

/** Alcance de una clave almacenada, con permisos desconocidos descartados. */
function alcanceDe(k: ApiKey): Pick<Principal, 'permisos' | 'todasLasEmpresas' | 'empresas'> {
  return {
    permisos: k.permisos.filter(esPermiso),
    todasLasEmpresas: k.todasLasEmpresas,
    empresas: k.empresas,
  };
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @InjectRepository(ApiKey) private readonly claves: Repository<ApiKey>,
  ) {}

  /**
   * Crea una clave. `solicitante` (si es una API key, no admin) no puede otorgar permisos ni
   * empresas que no tenga. Devuelve la clave completa: es la única vez que existe en claro.
   */
  async crear(
    datos: CrearApiKeyDatos,
    solicitante: Principal,
    ambiente: AmbienteClave,
  ): Promise<{ apiKey: ApiKey; clave: string }> {
    this.asegurarSinEscalada(solicitante, datos);
    const { clave, prefijo, hash } = generarApiKey(ambiente);
    const apiKey = await this.claves.save(
      this.claves.create({
        nombre: datos.nombre,
        prefijo,
        hashClave: hash,
        permisos: [...new Set(datos.permisos)],
        empresas: datos.todasLasEmpresas ? [] : [...new Set(datos.empresas)],
        todasLasEmpresas: datos.todasLasEmpresas,
        activa: true,
        expiraEn: datos.expiraEn ?? null,
        ultimoUsoEn: null,
        revocadaEn: null,
      }),
    );
    return { apiKey, clave };
  }

  /** Anti-escalada: el admin puede todo; una API key solo lo que ella misma tiene. */
  asegurarSinEscalada(solicitante: Principal, pedido: CrearApiKeyDatos): void {
    if (solicitante.tipo === 'admin') return;
    if (!contieneAcceso(solicitante, pedido)) {
      throw new ProblemaHttp(
        403,
        'ESCALADA_DE_PRIVILEGIOS',
        'Escalada de privilegios',
        'No se puede crear una API key con permisos o empresas que la credencial actual no tiene',
      );
    }
  }

  /** Claves que el solicitante puede ver/revocar: el admin todas; una key, las que no excedan su alcance. */
  private visiblePara(solicitante: Principal, k: ApiKey): boolean {
    return solicitante.tipo === 'admin' || contieneAcceso(solicitante, alcanceDe(k));
  }

  async listar(solicitante: Principal): Promise<ApiKey[]> {
    const todas = await this.claves.find({ order: { creadaEn: 'DESC' } });
    return todas.filter((k) => this.visiblePara(solicitante, k));
  }

  /** Revoca (soft). 404 si no existe o excede el alcance del solicitante. Idempotente. */
  async revocar(id: string, solicitante: Principal): Promise<void> {
    const k = await this.claves.findOne({ where: { id } });
    if (!k || !this.visiblePara(solicitante, k)) throw noEncontrado('La API key', id);
    if (k.activa || !k.revocadaEn) {
      await this.claves.update(id, { activa: false, revocadaEn: k.revocadaEn ?? new Date() });
    }
  }

  /** Agrega una empresa a la lista de la clave (creación de empresa por una key acotada). */
  async agregarEmpresa(id: string, rut: string): Promise<void> {
    await this.claves
      .createQueryBuilder()
      .update(ApiKey)
      .set({ empresas: () => 'array_append("empresas", CAST(:rut AS text))' })
      .setParameter('rut', rut)
      .where('id = :id AND NOT (CAST(:rut AS text) = ANY("empresas"))', { id })
      .execute();
  }

  /**
   * Valida una clave presentada. `undefined` si el formato es inválido, no existe, el hash no
   * coincide, está revocada o expirada (el llamador responde 401 sin distinguir la causa).
   */
  async autenticar(clave: string, ahora = new Date()): Promise<Principal | undefined> {
    const partes = parsearApiKey(clave);
    if (!partes) return undefined;
    const k = await this.claves.findOne({ where: { prefijo: partes.prefijo } });
    if (!k || !verificarClave(clave, k.hashClave)) return undefined;
    if (estadoDe(k, ahora) !== 'activa') return undefined;
    this.registrarUso(k, ahora);
    return { tipo: 'api_key', apiKeyId: k.id, ...alcanceDe(k) };
  }

  /** Actualiza `ultimo_uso_en` sin bloquear la petición y como mucho una vez por minuto por clave. */
  private registrarUso(k: ApiKey, ahora: Date): void {
    if (
      k.ultimoUsoEn &&
      ahora.getTime() - k.ultimoUsoEn.getTime() < INTERVALO_ULTIMO_USO_MS
    ) {
      return;
    }
    this.claves.update(k.id, { ultimoUsoEn: ahora }).catch((e: unknown) => {
      this.logger.warn(`No se pudo actualizar ultimo_uso_en: ${String(e)}`);
    });
  }
}
