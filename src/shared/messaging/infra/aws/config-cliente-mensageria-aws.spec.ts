import { ConfigService } from '@nestjs/config';
import { criarOpcoesClienteSqs } from './config-cliente-mensageria-aws';

describe('criarOpcoesClienteSqs', () => {
  it('monta prazos e região a partir da configuração', () => {
    const config = {
      get: jest.fn((k: string) => {
        const valores: Record<string, string> = {
          AWS_REGION: 'sa-east-1',
          SQS_CONNECTION_TIMEOUT_MS: '4000',
          SQS_HTTP_ATTEMPT_TIMEOUT_MS: '8000',
          AWS_SDK_MAX_ATTEMPTS: '2',
        };
        return valores[k];
      }),
    } as unknown as ConfigService;
    const opcoes = criarOpcoesClienteSqs(config);
    expect(opcoes.region).toBe('sa-east-1');
    expect(opcoes.operationDeadlineMs).toBeGreaterThan(0);
  });
});
