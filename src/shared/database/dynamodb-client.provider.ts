import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { criarOpcoesClienteDynamodb } from '@/shared/aws/config-cliente-dynamodb-aws';
import { criarSinalOperacaoAws } from '@/shared/messaging/infra/aws/sinal-operacao-aws';

@Injectable()
export class DynamoDbClientProvider implements OnApplicationShutdown {
  readonly client: DynamoDBClient;
  readonly operationDeadlineMs: number;
  private encerrado = false;

  constructor(config: ConfigService) {
    const opcoes = criarOpcoesClienteDynamodb(config);
    this.operationDeadlineMs = opcoes.operationDeadlineMs;
    const endpoint = config.get<string>('DYNAMODB_ENDPOINT');

    const clientConfig: DynamoDBClientConfig = {
      region: opcoes.region,
      maxAttempts: opcoes.maxAttempts,
      requestHandler: opcoes.requestHandler,
      ...(endpoint
        ? {
            endpoint,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    };

    this.client = new DynamoDBClient(clientConfig);
  }

  async enviar<Output = unknown>(
    comando: Parameters<DynamoDBClient['send']>[0],
    opcoes?: { abortSignal?: AbortSignal },
  ): Promise<Output> {
    const sinal = criarSinalOperacaoAws(
      this.operationDeadlineMs,
      opcoes?.abortSignal,
    );
    try {
      const resultado = await this.client.send(comando, {
        abortSignal: sinal.signal,
      });
      return resultado as Output;
    } finally {
      sinal.dispose();
    }
  }

  onApplicationShutdown(): void {
    if (this.encerrado) return;
    this.encerrado = true;
    this.client.destroy();
  }
}
