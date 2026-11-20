import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProblemaHttp } from '../comun/problema.js';
import {
  generarApiKey,
  hashearClave,
  igualesEnTiempoConstante,
  parsearApiKey,
  verificarClave,
} from './api-key.js';
import { ApiKeysService } from './api-keys.service.js';
import { AuthGuard } from './auth.guard.js';
import { PERMISOS_KEY, PUBLICO_KEY, type RequestConPrincipal } from './decoradores.js';
import { ApiKey } from './entities/api-key.entity.js';
import { PermisosGuard } from './permisos.guard.js';
import { PERMISOS, TODOS_LOS_PERMISOS, type Permiso } from './permisos.js';
import {
  asegurarAccesoEmpresa,
  asegurarRecursoDeEmpresa,
  normalizarRut,
  type Principal,
} from './principal.js';

const ADMIN = 'admin-key-de-prueba-con-mas-de-32-caracteres!';

function contexto(
  req: Partial<RequestConPrincipal>,
  meta: { publico?: boolean; permisos?: Permiso[] } = {},
): ExecutionContext {
  const handler = () => undefined;
  const clase = class {};
  if (meta.publico) Reflect.defineMetadata(PUBLICO_KEY, true, handler);
  if (meta.permisos) Reflect.defineMetadata(PERMISOS_KEY, meta.permisos, handler);
  return {
    getHandler: () => handler,
    getClass: () => clase,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function principal(parcial: Partial<Principal> = {}): Principal {
  return {
    tipo: 'api_key',
    apiKeyId: 'k1',
    permisos: [],
    todasLasEmpresas: false,
    empresas: [],
    ...parcial,
  };
}

/** Repositorio en memoria mÃ­nimo para ApiKeysService. */
function crearServicio(filas: ApiKey[] = []) {
  const actualizaciones: { id: string; datos: Partial<ApiKey> }[] = [];
  const repo = {
    create: (d: Partial<ApiKey>) => ({ id: `id-${filas.length + 1}`, creadaEn: new Date(), ...d }) as ApiKey,
    save: (k: ApiKey) => {
      filas.push(k);
      return Promise.resolve(k);
    },
    findOne: ({ where }: { where: { prefijo?: string; id?: string } }) =>
      Promise.resolve(
        filas.find((f) => (where.prefijo ? f.prefijo === where.prefijo : f.id === where.id)) ?? null,
      ),
    find: () => Promise.resolve([...filas]),
    update: (id: string, datos: Partial<ApiKey>) => {
      actualizaciones.push({ id, datos });
      Object.assign(filas.find((f) => f.id === id) ?? {}, datos);
      return Promise.resolve();
    },
  };
  return {
    servicio: new ApiKeysService(repo as never),
    filas,
    actualizaciones,
  };
}

describe('claves API', () => {
  it('genera el formato sk_<ambiente>_<prefijo>_<secreto>', () => {
    const k = generarApiKey('live');
    expect(k.clave).toMatch(/^sk_live_[0-9a-f]{10}_[A-Za-z0-9_-]{43}$/);
    expect(parsearApiKey(k.clave)).toEqual({ ambiente: 'live', prefijo: k.prefijo });
    expect(k.hash).toBe(hashearClave(k.clave));
    expect(k.hash).toHaveLength(64);
    expect(k.hash).not.toContain(k.clave.split('_').pop() as string);
    expect(generarApiKey('test').clave).not.toBe(generarApiKey('test').clave);
  });

  it('verifica solo la clave correcta', () => {
    const k = generarApiKey('test');
    expect(verificarClave(k.clave, k.hash)).toBe(true);
    expect(verificarClave(`${k.clave}x`, k.hash)).toBe(false);
    expect(verificarClave(generarApiKey('test').clave, k.hash)).toBe(false);
    expect(verificarClave(k.clave, 'abc')).toBe(false);
  });

  it('rechaza formatos invÃ¡lidos', () => {
    expect(parsearApiKey('sk_dev_0123456789_' + 'a'.repeat(43))).toBeUndefined();
    expect(parsearApiKey('sk_test_xyz_' + 'a'.repeat(43))).toBeUndefined();
    expect(parsearApiKey('sk_test_0123456789_corto')).toBeUndefined();
    expect(parsearApiKey('')).toBeUndefined();
  });

  it('compara en tiempo constante cadenas de distinto largo', () => {
    expect(igualesEnTiempoConstante('a', 'a')).toBe(true);
    expect(igualesEnTiempoConstante('a', 'ab')).toBe(false);
  });
});

describe('ApiKeysService.autenticar', () => {
  it('acepta una clave activa, rechaza revocada, expirada, desconocida y manipulada', async () => {
    const { servicio, filas } = crearServicio();
    const { clave, apiKey } = await servicio.crear(
      {
        nombre: 'n',
        permisos: [PERMISOS.EMPRESAS_LEER],
        empresas: ['76086428-5'],
        todasLasEmpresas: false,
      },
      principal({ tipo: 'admin' }),
      'test',
    );
    const p = await servicio.autenticar(clave);
    expect(p).toMatchObject({
      tipo: 'api_key',
      apiKeyId: apiKey.id,
      permisos: ['empresas.leer'],
      empresas: ['76086428-5'],
      todasLasEmpresas: false,
    });
    expect(await servicio.autenticar(`${clave.slice(0, -1)}${clave.endsWith('A') ? 'B' : 'A'}`)).toBeUndefined();
    expect(await servicio.autenticar(generarApiKey('test').clave)).toBeUndefined();
    expect(await servicio.autenticar('basura')).toBeUndefined();

    filas[0].expiraEn = new Date(Date.now() - 1000);
    expect(await servicio.autenticar(clave)).toBeUndefined();
    filas[0].expiraEn = null;
    expect(await servicio.autenticar(clave)).toBeDefined();

    await servicio.revocar(apiKey.id, principal({ tipo: 'admin' }));
    expect(filas[0].activa).toBe(false);
    expect(filas[0].revocadaEn).toBeInstanceOf(Date);
    expect(await servicio.autenticar(clave)).toBeUndefined();
  });

  it('actualiza ultimo_uso_en como mucho una vez por minuto', async () => {
    const { servicio, actualizaciones } = crearServicio();
    const { clave } = await servicio.crear(
      { nombre: 'n', permisos: [], empresas: [], todasLasEmpresas: false },
      principal({ tipo: 'admin' }),
      'test',
    );
    const t0 = new Date('2026-11-19T10:00:00Z');
    await servicio.autenticar(clave, t0);
    await servicio.autenticar(clave, new Date(t0.getTime() + 5_000));
    expect(actualizaciones).toHaveLength(1);
    await servicio.autenticar(clave, new Date(t0.getTime() + 120_000));
    expect(actualizaciones).toHaveLength(2);
  });
});

describe('anti-escalada', () => {
  const solicitante = principal({
    permisos: [PERMISOS.API_KEYS_GESTIONAR, PERMISOS.EMPRESAS_LEER],
    empresas: ['76086428-5'],
  });
  const pedido = (p: Partial<Parameters<ApiKeysService['crear']>[0]> = {}) => ({
    nombre: 'n',
    permisos: [PERMISOS.EMPRESAS_LEER],
    empresas: ['76086428-5'],
    todasLasEmpresas: false,
    ...p,
  });

  it('una key no otorga permisos ni empresas que no tiene', async () => {
    const { servicio } = crearServicio();
    await expect(servicio.crear(pedido(), solicitante, 'test')).resolves.toBeDefined();
    await expect(
      servicio.crear(pedido({ permisos: [PERMISOS.EMPRESAS_CREAR] }), solicitante, 'test'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      servicio.crear(pedido({ empresas: ['11111111-1'] }), solicitante, 'test'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      servicio.crear(pedido({ todasLasEmpresas: true }), solicitante, 'test'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('el admin puede otorgar todo', async () => {
    const { servicio } = crearServicio();
    await expect(
      servicio.crear(
        pedido({ permisos: [...TODOS_LOS_PERMISOS], todasLasEmpresas: true }),
        principal({ tipo: 'admin', permisos: TODOS_LOS_PERMISOS, todasLasEmpresas: true }),
        'live',
      ),
    ).resolves.toBeDefined();
  });

  it('una key solo ve y revoca claves dentro de su alcance', async () => {
    const { servicio } = crearServicio();
    const admin = principal({ tipo: 'admin', permisos: TODOS_LOS_PERMISOS, todasLasEmpresas: true });
    const propia = await servicio.crear(pedido(), admin, 'test');
    const ajena = await servicio.crear(pedido({ empresas: ['11111111-1'] }), admin, 'test');
    const visibles = (await servicio.listar(solicitante)).map((k) => k.id);
    expect(visibles).toContain(propia.apiKey.id);
    expect(visibles).not.toContain(ajena.apiKey.id);
    await expect(servicio.revocar(ajena.apiKey.id, solicitante)).rejects.toMatchObject({ status: 404 });
    await expect(servicio.revocar(propia.apiKey.id, solicitante)).resolves.toBeUndefined();
  });
});

describe('AuthGuard', () => {
  const config = { adminKey: ADMIN };
  const sinClaves = { autenticar: () => Promise.resolve(undefined) } as unknown as ApiKeysService;
  const guard = (claves = sinClaves, cfg: { adminKey: string | undefined } = config) =>
    new AuthGuard(new Reflector(), claves, cfg);

  it('sin credencial: 401', async () => {
    const r = guard().canActivate(contexto({ headers: {} }));
    await expect(r).rejects.toBeInstanceOf(ProblemaHttp);
    await expect(r).rejects.toMatchObject({ status: 401 });
  });

  it('clave invÃ¡lida: 401', async () => {
    await expect(
      guard().canActivate(contexto({ headers: { authorization: 'Bearer x' } })),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      guard().canActivate(contexto({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('@Publico pasa sin credencial', async () => {
    await expect(guard().canActivate(contexto({ headers: {} }, { publico: true }))).resolves.toBe(true);
  });

  it('clave admin por Bearer y por X-API-Key deja un principal admin', async () => {
    const req1: Partial<RequestConPrincipal> = { headers: { authorization: `Bearer ${ADMIN}` } };
    await guard().canActivate(contexto(req1));
    expect(req1.principal).toMatchObject({ tipo: 'admin', todasLasEmpresas: true });
    expect(req1.principal?.permisos).toEqual(TODOS_LOS_PERMISOS);

    const req2: Partial<RequestConPrincipal> = { headers: { 'x-api-key': ADMIN } };
    await guard().canActivate(contexto(req2));
    expect(req2.principal?.tipo).toBe('admin');
  });

  it('sin API_ADMIN_KEY configurada la clave admin no existe', async () => {
    await expect(
      guard(sinClaves, { adminKey: undefined }).canActivate(contexto({ headers: { authorization: `Bearer ${ADMIN}` } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('delega en ApiKeysService y deja el principal', async () => {
    const p = principal({ permisos: [PERMISOS.EMPRESAS_LEER] });
    const g = guard({ autenticar: () => Promise.resolve(p) } as unknown as ApiKeysService);
    const req: Partial<RequestConPrincipal> = { headers: { 'x-api-key': 'sk_test_0123456789_' + 'a'.repeat(43) } };
    await expect(g.canActivate(contexto(req))).resolves.toBe(true);
    expect(req.principal).toBe(p);
  });
});

describe('PermisosGuard', () => {
  const guard = new PermisosGuard(new Reflector());

  it('@Publico pasa', () => {
    expect(guard.canActivate(contexto({}, { publico: true }))).toBe(true);
  });

  it('sin permisos declarados: 403 (fail-closed), incluso para el admin', () => {
    const admin = principal({ tipo: 'admin', permisos: TODOS_LOS_PERMISOS, todasLasEmpresas: true });
    expect(() => guard.canActivate(contexto({ principal: admin, params: {} }))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('falta un permiso: 403; con todos: pasa', () => {
    const req = (permisos: Permiso[]) => ({ principal: principal({ permisos }), params: {} });
    const meta = { permisos: [PERMISOS.DOCUMENTOS_LEER, PERMISOS.ENVIOS_LEER] };
    expect(() =>
      guard.canActivate(contexto(req([PERMISOS.DOCUMENTOS_LEER]), meta)),
    ).toThrowError(expect.objectContaining({ status: 403 }));
    expect(
      guard.canActivate(contexto(req([PERMISOS.DOCUMENTOS_LEER, PERMISOS.ENVIOS_LEER]), meta)),
    ).toBe(true);
  });

  it('sin principal: 403', () => {
    expect(() =>
      guard.canActivate(contexto({ params: {} }, { permisos: [PERMISOS.EMPRESAS_LEER] })),
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('en rutas con :rut exige acceso a esa empresa', () => {
    const meta = { permisos: [PERMISOS.EMPRESAS_LEER] };
    const p = principal({ permisos: [PERMISOS.EMPRESAS_LEER], empresas: ['76086428-5'] });
    expect(guard.canActivate(contexto({ principal: p, params: { rut: '76.086.428-5' } }, meta))).toBe(true);
    expect(() =>
      guard.canActivate(contexto({ principal: p, params: { rut: '11111111-1' } }, meta)),
    ).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() =>
      guard.canActivate(contexto({ principal: p, params: { rut: 'basura' } }, meta)),
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

describe('aislamiento por empresa', () => {
  const p = principal({ empresas: ['76086428-5'] });

  it('normaliza RUT con puntos, ceros y DV en minÃºscula', () => {
    expect(normalizarRut('76.086.428-5')).toBe('76086428-5');
    expect(normalizarRut('012345678-k')).toBe('12345678-K');
    expect(normalizarRut('xx')).toBeUndefined();
  });

  it('asegurarAccesoEmpresa: 403 fuera de alcance, ok dentro y para todas', () => {
    expect(() => asegurarAccesoEmpresa(p, '76086428-5')).not.toThrow();
    expect(() => asegurarAccesoEmpresa(p, '11111111-1')).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    expect(() =>
      asegurarAccesoEmpresa({ todasLasEmpresas: true, empresas: [] }, '11111111-1'),
    ).not.toThrow();
  });

  it('asegurarRecursoDeEmpresa: 404 fuera de alcance', () => {
    expect(() => asegurarRecursoDeEmpresa(p, '76086428-5', 'El documento', 'x')).not.toThrow();
    expect(() => asegurarRecursoDeEmpresa(p, '11111111-1', 'El documento', 'x')).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
