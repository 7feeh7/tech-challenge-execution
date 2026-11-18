import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Prazos operacionais — evidência no código', () => {
  const raiz = join(__dirname, '..', '..', '..');

  it('impõe deadline nas operações DynamoDB via DynamoDbClientProvider.enviar', () => {
    const provider = readFileSync(
      join(raiz, 'src/shared/database/dynamodb-client.provider.ts'),
      'utf-8',
    );
    const configAws = readFileSync(
      join(raiz, 'src/shared/aws/config-cliente-dynamodb-aws.ts'),
      'utf-8',
    );
    expect(configAws).toContain('DYNAMODB_OPERATION_DEADLINE_MS');
    expect(provider).toContain('criarSinalOperacaoAws');
    expect(provider).toContain('abortSignal');
  });

  it('impõe deadline e long polling no SQS', () => {
    const fila = readFileSync(
      join(raiz, 'src/shared/messaging/infra/sqs/fila-sqs.gateway.ts'),
      'utf-8',
    );
    expect(fila).toContain('SQS_LONG_POLL_SECONDS');
    const config = readFileSync(
      join(
        raiz,
        'src/shared/messaging/infra/aws/config-cliente-mensageria-aws.ts',
      ),
      'utf-8',
    );
    expect(config).toContain('AWS_SDK_MAX_ATTEMPTS');
    expect(fila).toContain('criarSinalOperacaoAws');
  });

  it('consumidor cancela receive no shutdown e confirma após processar', () => {
    const consumidor = readFileSync(
      join(
        raiz,
        'src/shared/messaging/infra/consumo/consumidor-fila-execution.service.ts',
      ),
      'utf-8',
    );
    expect(consumidor).toContain('beforeApplicationShutdown');
    expect(consumidor).toContain('sinalAbortamento.abort()');
    expect(consumidor).toContain('await this.processar.executar');
    expect(consumidor).toContain('await this.fila.confirmar');
  });

  it('outbox limita paginação GSI por variável de ambiente', () => {
    const repo = readFileSync(
      join(
        raiz,
        'src/shared/messaging/infra/persistence/dynamodb-outbox-repositorio.ts',
      ),
      'utf-8',
    );
    expect(repo).toContain('OUTBOX_GSI_MAX_PAGINAS');
    expect(repo).toContain('paginas < this.gsiMaxPaginas');
  });

  it('validação fail-closed ocorre antes do bootstrap Nest', () => {
    const main = readFileSync(join(raiz, 'src/main.ts'), 'utf-8');
    const idxValidar = main.indexOf('validarConfiguracaoExecution');
    const idxNest = main.indexOf('NestFactory.create');
    expect(idxValidar).toBeGreaterThan(-1);
    expect(idxNest).toBeGreaterThan(-1);
    expect(idxValidar).toBeLessThan(idxNest);
  });
});
