import { existsSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigModule } from '../src/config/config.module.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { Empresa } from '../src/empresas/entities/empresa.entity.js';
import { EmpresasModule } from '../src/empresas/empresas.module.js';
import { Caf } from '../src/folios/entities/caf.entity.js';
import {
  CafInvalidoError,
  SinFoliosDisponiblesError,
} from '../src/folios/folios.errors.js';
import { FoliosModule } from '../src/folios/folios.module.js';
import { FoliosService } from '../src/folios/folios.service.js';

// Mismo mecanismo que src/database/data-source.ts: .env.local y .env sin dependencias.
for (const archivo of ['.env.local', '.env']) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

// Requiere Postgres (docker compose up -d postgres) con las migraciones aplicadas.
describe.skipIf(!process.env.DATABASE_HOST)(
  'FoliosService (e2e, con DB)',
  () => {
    let dataSource: DataSource;
    let service: FoliosService;
    let close: () => Promise<void>;
    let empresaId: string;
    const rut = 90000000 + Math.floor(Math.random() * 9000000);

    beforeAll(async () => {
      const modulo = await Test.createTestingModule({
        imports: [ConfigModule, DatabaseModule, EmpresasModule, FoliosModule],
      }).compile();
      await modulo.init();
      close = () => modulo.close();
      dataSource = modulo.get(DataSource);
      service = modulo.get(FoliosService);

      const empresa = await dataSource.getRepository(Empresa).save({
        rut,
        dv: '9',
        razonSocial: 'Empresa Prueba Folios',
        giro: 'Pruebas',
        actecos: [620200],
        direccion: 'Calle 1',
        comuna: 'Santiago',
        ciudad: 'Santiago',
      });
      empresaId = empresa.id;
    });

    afterAll(async () => {
      if (empresaId) {
        await dataSource.getRepository(Caf).delete({ empresaId });
        await dataSource.getRepository(Empresa).delete({ id: empresaId });
      }
      await close();
    });

    it('50 asignaciones concurrentes entregan folios únicos 1..50 y la 51 falla', async () => {
      const caf = await service.registrarCaf(empresaId, {
        tipoDte: 33,
        folioDesde: 1,
        folioHasta: 50,
        fechaAutorizacion: new Date(),
        xml: '<AUTORIZACION>prueba</AUTORIZACION>',
      });
      expect(caf.folioSiguiente).toBe(1);

      const resultados = await Promise.all(
        Array.from({ length: 50 }, () =>
          service.asignarSiguienteFolio(empresaId, 33),
        ),
      );
      const folios = resultados.map((r) => r.folio).sort((a, b) => a - b);
      expect(new Set(folios).size).toBe(50);
      expect(folios).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(resultados.every((r) => r.cafId === caf.id)).toBe(true);
      expect(resultados[0].xmlCaf).toContain('prueba');

      await expect(
        service.asignarSiguienteFolio(empresaId, 33),
      ).rejects.toBeInstanceOf(SinFoliosDisponiblesError);

      const [resumen] = await service.foliosDisponibles(empresaId, 33);
      expect(resumen.disponibles).toBe(0);
      expect(resumen.agotado).toBe(true);
    });

    it('rechaza un CAF con rango solapado', async () => {
      await expect(
        service.registrarCaf(empresaId, {
          tipoDte: 33,
          folioDesde: 40,
          folioHasta: 60,
          fechaAutorizacion: new Date(),
          xml: '<x/>',
        }),
      ).rejects.toBeInstanceOf(CafInvalidoError);
    });

    it('pasa al siguiente CAF al agotarse el primero y omite los vencidos', async () => {
      const ayer = new Date(Date.now() - 86_400_000 * 2);
      await service.registrarCaf(empresaId, {
        tipoDte: 39,
        folioDesde: 1,
        folioHasta: 5,
        fechaAutorizacion: ayer,
        fechaVencimiento: new Date(Date.now() - 86_400_000),
        xml: '<vencido/>',
      });
      const a = await service.registrarCaf(empresaId, {
        tipoDte: 39,
        folioDesde: 100,
        folioHasta: 101,
        fechaAutorizacion: ayer,
        xml: '<a/>',
      });
      const b = await service.registrarCaf(empresaId, {
        tipoDte: 39,
        folioDesde: 200,
        folioHasta: 200,
        fechaAutorizacion: new Date(),
        xml: '<b/>',
      });

      const r = await Promise.all(
        Array.from({ length: 3 }, () =>
          service.asignarSiguienteFolio(empresaId, 39),
        ),
      );
      expect(r.map((x) => x.folio).sort((x, y) => x - y)).toEqual([
        100, 101, 200,
      ]);
      expect(r.filter((x) => x.cafId === a.id)).toHaveLength(2);
      expect(r.filter((x) => x.cafId === b.id)).toHaveLength(1);
      await expect(
        service.asignarSiguienteFolio(empresaId, 39),
      ).rejects.toBeInstanceOf(SinFoliosDisponiblesError);
    });
  },
);
