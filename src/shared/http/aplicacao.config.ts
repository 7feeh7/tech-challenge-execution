import {
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';

/** Prefixo e validação globais, compartilhados entre `main.ts` e os testes e2e. */
export function configurarAplicacao(app: INestApplication): void {
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
}
