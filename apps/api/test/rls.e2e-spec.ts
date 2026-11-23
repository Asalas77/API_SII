import { DataSource } from 'typeorm';
import { calcularDv } from '../src/dte-core/index.js';
import { cargarEntorno, postgresDisponible, rutAleatorio } from './helpers/db.js';
import { crearDsFixtures } from './helpers/fixtures.js';

cargarEntorno();
const hayApp = Boolean(process.env.DATABASE_APP_USER && process.env.DATABASE_APP_PASSWORD);
const hayDb = (await postgresDisponible()) && hayApp;

interface Lado {
  rut: ReturnType<typeof rutAleatorio>;
  empresaId: string;
  cafId: string;
  docId: string;
  envioId: string;
  libroId: string;
}

// Demuestra RLS con SQL directo, conectado con el ROL DE APLICACIÓN (no superusuario).
describe.skipIf(!hayDb)('Row Level Security por empresa (e2e, rol de aplicación)', () => {
  let fx: DataSource;
  let app: DataSource;
  let A: Lado;
  let B: Lado;

  /** Ejecuta `fn` en una transacción con el contexto indicado (set_config local), como EjecutorEmpresa. */
  async function conContexto<T>(
    ctx: { todas?: boolean; ruts?: string[] } | null,
    fn: (q: (sql: string, p?: unknown[]) => Promise<any[]>) => Promise<T>,
  ): Promise<T> {
    const qr = app.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      if (ctx) {
        await qr.query(`SELECT set_config('app.todas_empresas', $1, true), set_config('app.empresas', $2, true)`, [
          ctx.todas ? 'on' : 'off',
          (ctx.ruts ?? []).join(','),
        ]);
      }
      return await fn((sql, p) => qr.query(sql, p) as Promise<any[]>);
    } finally {
      await qr.rollbackTransaction().catch(() => undefined);
      await qr.release();
    }
  }

  async function sembrar(): Promise<Lado> {
    const rut = rutAleatorio((n) => calcularDv(n));
    const [e] = (await fx.query(
      `INSERT INTO empresas (rut, dv, razon_social, giro, actecos, direccion, comuna, ciudad)
       VALUES ($1, $2, 'RLS', 'g', '{1}', 'd', 'c', 'c') RETURNING id`,
      [rut.numero, rut.dv],
    )) as Array<{ id: string }>;
    await fx.query(
      `INSERT INTO certificados (empresa_id, rut_firmante, dv_firmante, nombre_firmante, pfx_cifrado, password_cifrada, valido_desde, valido_hasta)
       VALUES ($1, 1, '9', 'n', '\\x00', '\\x00', now(), now())`,
      [e.id],
    );
    const [caf] = (await fx.query(
      `INSERT INTO cafs (empresa_id, tipo_dte, folio_desde, folio_hasta, folio_siguiente, fecha_autorizacion, xml)
       VALUES ($1, 33, 1, 10, 1, '2026-01-01', 'x') RETURNING id`,
      [e.id],
    )) as Array<{ id: string }>;
    const [doc] = (await fx.query(
      `INSERT INTO documentos (empresa_id, caf_id, tipo_dte, folio, fecha_emision, monto_total, estado, xml_firmado, ted)
       VALUES ($1, $2, 33, 1, '2026-01-01', 100, 'emitido', 'x', 't') RETURNING id`,
      [e.id, caf.id],
    )) as Array<{ id: string }>;
    const [env] = (await fx.query(
      `INSERT INTO envios (empresa_id, canal, ambiente_sii) VALUES ($1, 'dte', 'certificacion') RETURNING id`,
      [e.id],
    )) as Array<{ id: string }>;
    await fx.query(`INSERT INTO envio_documentos (envio_id, documento_id) VALUES ($1, $2)`, [env.id, doc.id]);
    const [libro] = (await fx.query(
      `INSERT INTO libros (empresa_id, tipo_operacion, tipo_libro, tipo_envio, periodo, ambiente_sii, xml_libro)
       VALUES ($1, 'VENTA', 'MENSUAL', 'TOTAL', '2026-01', 'certificacion', '<LibroCompraVenta/>') RETURNING id`,
      [e.id],
    )) as Array<{ id: string }>;
    return { rut, empresaId: e.id, cafId: caf.id, docId: doc.id, envioId: env.id, libroId: libro.id };
  }

  async function limpiar(l: Lado | undefined) {
    if (!l) return;
    await fx.query(`DELETE FROM libros WHERE empresa_id = $1`, [l.empresaId]);
    await fx.query(`DELETE FROM envio_documentos WHERE envio_id = $1`, [l.envioId]);
    await fx.query(`DELETE FROM envios WHERE empresa_id = $1`, [l.empresaId]);
    await fx.query(`DELETE FROM documentos WHERE empresa_id = $1`, [l.empresaId]);
    await fx.query(`DELETE FROM cafs WHERE empresa_id = $1`, [l.empresaId]);
    await fx.query(`DELETE FROM certificados WHERE empresa_id = $1`, [l.empresaId]);
    await fx.query(`DELETE FROM empresas WHERE id = $1`, [l.empresaId]);
  }

  beforeAll(async () => {
    fx = await crearDsFixtures();
    app = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_APP_USER,
      password: process.env.DATABASE_APP_PASSWORD,
      database: process.env.DATABASE_NAME,
    });
    await app.initialize();
    A = await sembrar();
    B = await sembrar();
  });

  afterAll(async () => {
    await limpiar(A);
    await limpiar(B);
    if (app?.isInitialized) await app.destroy();
    if (fx?.isInitialized) await fx.destroy();
  });

  const ctxA = () => ({ ruts: [`${A.rut.numero}-${A.rut.dv}`] });
  const ctxB = () => ({ ruts: [`${B.rut.numero}-${B.rut.dv}`] });

  it('el rol de aplicación no es superusuario ni tiene BYPASSRLS', async () => {
    const [r] = await app.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });

  it('toda tabla con empresa_id (y envio_documentos) tiene RLS activada y forzada', async () => {
    const filas = (await app.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND (c.relname = 'empresas' OR c.relname = 'envio_documentos'
              OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'empresa_id' AND NOT a.attisdropped))`)) as Array<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>;
    expect(filas.map((f) => f.relname).sort()).toEqual(
      [
        'buzones_correo',
        'cafs',
        'certificados',
        'documentos',
        'dte_recibidos',
        'empresas',
        'envio_documentos',
        'envios',
        'envios_recibidos',
        'libros',
      ],
    );
    for (const f of filas) expect([f.relname, f.relrowsecurity, f.relforcerowsecurity]).toEqual([f.relname, true, true]);
  });

  const TABLAS: Array<[string, string, () => string]> = [
    ['empresas', 'id', () => A.empresaId],
    ['certificados', 'empresa_id', () => A.empresaId],
    ['cafs', 'empresa_id', () => A.empresaId],
    ['documentos', 'empresa_id', () => A.empresaId],
    ['envios', 'empresa_id', () => A.empresaId],
    ['libros', 'empresa_id', () => A.empresaId],
    ['envio_documentos', 'envio_id', () => A.envioId],
  ];

  it.each(TABLAS)('con contexto de B, SELECT en %s no ve filas de A', async (tabla, col, valorA) => {
    await conContexto(ctxB(), async (q) => {
      expect(await q(`SELECT 1 FROM ${tabla} WHERE ${col} = $1`, [valorA()])).toHaveLength(0);
    });
    await conContexto(ctxA(), async (q) => {
      expect((await q(`SELECT 1 FROM ${tabla} WHERE ${col} = $1`, [valorA()])).length).toBeGreaterThan(0);
    });
  });

  it('UPDATE y DELETE sobre filas de A afectan 0 filas con contexto B', async () => {
    await conContexto(ctxB(), async (q) => {
      for (const [sql, p] of [
        [`UPDATE empresas SET razon_social = 'x' WHERE id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE certificados SET activo = false WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE cafs SET agotado = true WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE documentos SET monto_total = 1 WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE envios SET intentos = 9 WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE libros SET estado = 'X' WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`UPDATE envio_documentos SET glosa = 'x' WHERE envio_id = $1 RETURNING 1`, A.envioId],
        [`DELETE FROM envio_documentos WHERE envio_id = $1 RETURNING 1`, A.envioId],
        [`DELETE FROM envios WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`DELETE FROM libros WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`DELETE FROM documentos WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`DELETE FROM cafs WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`DELETE FROM certificados WHERE empresa_id = $1 RETURNING 1`, A.empresaId],
        [`DELETE FROM empresas WHERE id = $1 RETURNING 1`, A.empresaId],
      ] as Array<[string, string]>) {
        // TypeORM devuelve [filas, afectadas] en UPDATE/DELETE.
        const [filas, afectadas] = (await q(sql, [p])) as unknown as [unknown[], number];
        expect([filas.length, afectadas], sql).toEqual([0, 0]);
      }
    });
    // Siguen intactas.
    const [c] = await fx.query(`SELECT count(*)::int AS n FROM documentos WHERE empresa_id = $1`, [A.empresaId]);
    expect(c.n).toBe(1);
  });

  it('INSERT con empresa_id de A desde el contexto de B falla por WITH CHECK', async () => {
    const intentos = [
      `INSERT INTO envios (empresa_id, canal, ambiente_sii) VALUES ($1, 'dte', 'certificacion')`,
      `INSERT INTO cafs (empresa_id, tipo_dte, folio_desde, folio_hasta, folio_siguiente, fecha_autorizacion, xml) VALUES ($1, 39, 1, 2, 1, '2026-01-01', 'x')`,
      `INSERT INTO certificados (empresa_id, rut_firmante, dv_firmante, nombre_firmante, pfx_cifrado, password_cifrada, valido_desde, valido_hasta) VALUES ($1, 1, '9', 'n', '\\x00', '\\x00', now(), now())`,
      `INSERT INTO documentos (empresa_id, tipo_dte, folio, fecha_emision, monto_total, estado, xml_firmado, ted) VALUES ($1, 33, 77, '2026-01-01', 1, 'emitido', 'x', 't')`,
      `INSERT INTO libros (empresa_id, tipo_operacion, tipo_libro, tipo_envio, periodo, ambiente_sii, xml_libro) VALUES ($1, 'COMPRA', 'MENSUAL', 'TOTAL', '2026-01', 'certificacion', 'x')`,
    ];
    for (const sql of intentos) {
      await expect(conContexto(ctxB(), (q) => q(sql, [A.empresaId])), sql).rejects.toThrow(/row-level security/i);
    }
    await expect(
      conContexto(ctxB(), (q) =>
        q(
          `INSERT INTO empresas (rut, dv, razon_social, giro, actecos, direccion, comuna, ciudad) VALUES ($1, $2, 'x', 'g', '{1}', 'd', 'c', 'c')`,
          [A.rut.numero + 1, 'K'],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    // Un documento propio no puede apuntar al CAF de otra empresa.
    await expect(
      conContexto(ctxB(), (q) =>
        q(
          `INSERT INTO documentos (empresa_id, caf_id, tipo_dte, folio, fecha_emision, monto_total, estado, xml_firmado, ted) VALUES ($1, $2, 33, 78, '2026-01-01', 1, 'emitido', 'x', 't')`,
          [B.empresaId, A.cafId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    // Un envio_documento no puede enlazar un envío propio con un documento ajeno.
    await expect(
      conContexto(ctxB(), (q) =>
        q(`INSERT INTO envio_documentos (envio_id, documento_id) VALUES ($1, $2)`, [B.envioId, A.docId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('INSERT con la empresa propia sí funciona', async () => {
    await conContexto(ctxB(), async (q) => {
      const r = await q(
        `INSERT INTO envios (empresa_id, canal, ambiente_sii) VALUES ($1, 'dte', 'certificacion') RETURNING id`,
        [B.empresaId],
      );
      expect(r).toHaveLength(1);
    });
  });

  it('sin GUC fijado no hay filas (fail-closed) y no se puede escribir', async () => {
    await conContexto(null, async (q) => {
      for (const t of ['empresas', 'certificados', 'cafs', 'documentos', 'envios', 'envio_documentos', 'libros', 'envios_recibidos', 'dte_recibidos', 'buzones_correo']) {
        expect(await q(`SELECT 1 FROM ${t}`), t).toHaveLength(0);
      }
      await expect(
        q(`INSERT INTO envios (empresa_id, canal, ambiente_sii) VALUES ($1, 'dte', 'certificacion')`, [B.empresaId]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('contexto vacío (off, sin RUT) tampoco ve nada', async () => {
    await conContexto({ todas: false, ruts: [] }, async (q) => {
      expect(await q(`SELECT 1 FROM empresas`)).toHaveLength(0);
    });
  });

  it('todas_empresas=on ve las filas de A y de B', async () => {
    await conContexto({ todas: true }, async (q) => {
      const r = await q(`SELECT id FROM empresas WHERE id = ANY($1)`, [[A.empresaId, B.empresaId]]);
      expect(r).toHaveLength(2);
      expect(await q(`SELECT 1 FROM documentos WHERE empresa_id = ANY($1)`, [[A.empresaId, B.empresaId]])).toHaveLength(2);
    });
  });

  it('una lista con varios RUT ve solo esas empresas', async () => {
    await conContexto({ ruts: [`${A.rut.numero}-${A.rut.dv}`, `${B.rut.numero}-${B.rut.dv}`] }, async (q) => {
      expect(await q(`SELECT id FROM empresas WHERE id = ANY($1)`, [[A.empresaId, B.empresaId]])).toHaveLength(2);
    });
  });

  it('el GUC no se filtra a la siguiente transacción de la misma conexión', async () => {
    const qr = app.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      await qr.query(`SELECT set_config('app.todas_empresas', 'on', true), set_config('app.empresas', $1, true)`, [
        `${A.rut.numero}-${A.rut.dv}`,
      ]);
      expect(((await qr.query(`SELECT 1 FROM empresas WHERE id = $1`, [A.empresaId])) as unknown[]).length).toBe(1);
      await qr.commitTransaction();

      // Misma conexión física, transacción nueva y sin contexto.
      await qr.startTransaction();
      expect(((await qr.query(`SELECT 1 FROM empresas WHERE id = $1`, [A.empresaId])) as unknown[]).length).toBe(0);
      const [g] = (await qr.query(`SELECT current_setting('app.todas_empresas', true) AS t`)) as Array<{ t: string | null }>;
      expect(g.t === null || g.t === '').toBe(true);
      await qr.commitTransaction();
    } finally {
      await qr.release();
    }
  });

  it('api_keys no tiene RLS: el rol de aplicación la lee sin contexto', async () => {
    await expect(app.query(`SELECT count(*) FROM api_keys`)).resolves.toBeDefined();
  });
});
