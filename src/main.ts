import './config/decimal.config.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { UPLOADS_ROOT } from './common/storage/local-storage.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.enableShutdownHooks();

  // En producción todas las peticiones llegan a través de Caddy. Sin esto, req.ip sería
  // la IP de Caddy para todos los usuarios y el límite de peticiones los sumaría como
  // si fueran uno solo.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useStaticAssets(UPLOADS_ROOT, { prefix: '/uploads/' });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
