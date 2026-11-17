import { ConfigService } from '@nestjs/config';
import { DynamoDbTabelasService } from './dynamodb-tabelas.config';

describe('DynamoDbTabelasService', () => {
  it('lê nomes das três tabelas', () => {
    const config = {
      getOrThrow: jest.fn((k: string) => `valor-${k}`),
    } as unknown as ConfigService;
    const service = new DynamoDbTabelasService(config);
    expect(service.tarefas).toContain('TAREFAS');
    expect(service.outbox).toContain('OUTBOX');
    expect(service.mensagensProcessadas).toContain('MENSAGENS');
  });
});
