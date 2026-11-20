import { ConfigService } from '@nestjs/config';
import { criarOpcoesClienteDynamodb } from './config-cliente-dynamodb-aws';

describe('criarOpcoesClienteDynamodb', () => {
  it('aplica timeout de tentativa e deadline total', () => {
    const config = {
      get: jest.fn((chave: string) => {
        if (chave === 'DYNAMODB_OPERATION_DEADLINE_MS') return '15000';
        if (chave === 'DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS') return '5000';
        return undefined;
      }),
    } as unknown as ConfigService;

    const opcoes = criarOpcoesClienteDynamodb(config);
    expect(opcoes.httpAttemptTimeoutMs).toBe(5000);
    expect(opcoes.operationDeadlineMs).toBe(15000);
    expect(opcoes.maxAttempts).toBe(3);
  });

  it('deriva o deadline da tentativa × tentativas quando não há deadline explícito', () => {
    const valores: Record<string, string> = { AWS_SDK_MAX_ATTEMPTS: '10' };
    const config = {
      get: (k: string) => valores[k],
    } as unknown as ConfigService;
    expect(criarOpcoesClienteDynamodb(config).operationDeadlineMs).toBe(40000);
  });
});
