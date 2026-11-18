import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Los recursos de negocio viven bajo /v1; "/" y /health quedan sin prefijo.
  app.setGlobalPrefix('v1', { exclude: ['health', '/'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
