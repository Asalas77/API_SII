import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: vi.fn().mockReturnValue('certificacion') },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('devuelve nombre, versión y ambiente SII', () => {
      expect(appController.getInfo()).toEqual({
        nombre: 'api-sii',
        version: expect.stringMatching(/^\d+\.\d+\.\d+/) as string,
        ambienteSii: 'certificacion',
      });
    });
  });
});
