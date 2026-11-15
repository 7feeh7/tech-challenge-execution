import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '@/app.module';
import { JsonLoggerService } from '@/shared/observability/json-logger.service';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  const logger = app.get(JsonLoggerService);
  app.useLogger(logger);

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/ready', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Execution Service')
    .setDescription(
      'API da fila de diagnóstico e reparo e integração com o OS.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer(
      process.env.API_GATEWAY_URL ?? 'http://localhost:3000',
      'Gateway',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Execution API Docs',
  });

  await app.listen(PORT, '0.0.0.0');
  logger.log(`HTTP server running on port ${PORT}`, 'Bootstrap');
}

bootstrap();
