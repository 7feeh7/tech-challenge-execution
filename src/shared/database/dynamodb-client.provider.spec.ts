import { ConfigService } from '@nestjs/config';
import { DynamoDbClientProvider } from './dynamodb-client.provider';

describe('DynamoDbClientProvider', () => {
  it('usa endpoint local quando configurado', () => {
    const config = {
      get: jest.fn((k: string) =>
        k === 'DYNAMODB_ENDPOINT' ? 'http://localhost:8000' : 'us-east-1',
      ),
    } as unknown as ConfigService;
    const provider = new DynamoDbClientProvider(config);
    expect(provider.client).toBeDefined();
  });

  it('cria client sem endpoint em produção', () => {
    const config = {
      get: jest.fn((k: string) =>
        k === 'AWS_REGION' ? 'sa-east-1' : undefined,
      ),
    } as unknown as ConfigService;
    const provider = new DynamoDbClientProvider(config);
    expect(provider.client).toBeDefined();
  });
});
