import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppController } from './../src/app.controller.js';
import { AppService } from './../src/app.service.js';
import { siiConfig } from './../src/config/index.js';
import { AppModule } from './../src/app.module.js';
import { postgresDisponible } from './helpers/db.js';

const hayDb = await postgresDisponible();

// GET / no requiere base de datos: se monta solo AppController con la config SII.
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.SII_AMBIENTE = 'certificacion';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [siiConfig] })],
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health', '/'] });
    await app.init();
  });

  it('/ (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body).toEqual({
      nombre: 'api-sii',
      version: expect.any(String) as string,
      ambienteSii: 'certificacion',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});

// Requiere Postgres (docker compose up -d postgres) y .env cargado.
describe.skipIf(!hayDb)(
  'AppModule completo (e2e, con DB)',
  () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      await app.init();
    });

    it('/health (GET)', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    afterAll(async () => {
      await app.close();
    });
  },
);
