import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { configurarAplicacao } from '@/shared/http/aplicacao.config';
import type { FilaMensagensGateway } from '@/shared/messaging/application/ports/fila-mensagens.gateway';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ConsumidorFilaExecutionService } from '@/shared/messaging/infra/consumo/consumidor-fila-execution.service';
import { FilaSqsGateway } from '@/shared/messaging/infra/sqs/fila-sqs.gateway';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import { criarComandoIniciarDiagnostico } from './helpers/envelope-teste';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';
import { gerarParDeChavesRsa } from './helpers/jwt-test';

class FilaComLongPollMemoria extends FilaMensagensMemoriaGateway {
  recebimentoPendente?: { sinal?: AbortSignal };

  override async receber(
    filaUrl: string,
    quantidadeMaxima = 10,
    opcoes?: { sinalAbortamento?: AbortSignal },
  ) {
    const imediato = await super.receber(filaUrl, quantidadeMaxima, opcoes);
    if (imediato.length > 0 || !opcoes?.sinalAbortamento) {
      return imediato;
    }
    if (opcoes.sinalAbortamento.aborted) return [];
    return new Promise<Awaited<ReturnType<FilaMensagensGateway['receber']>>>(
      (resolver) => {
        const concluir = () => resolver([]);
        opcoes.sinalAbortamento?.addEventListener('abort', concluir, {
          once: true,
        });
        this.recebimentoPendente = { sinal: opcoes.sinalAbortamento };
      },
    );
  }
}

describe('Encerramento da aplicação (app.close)', () => {
  const chaves = gerarParDeChavesRsa();
  const client = criarClienteDynamodbTeste();
  let tabelas: NomesTabelasDynamodb;

  async function subirAplicacao(fila: FilaComLongPollMemoria) {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FILA_MENSAGENS)
      .useValue(fila)
      .compile();

    const app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configurarAplicacao(app);
    app.enableShutdownHooks();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  beforeAll(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-shutdown');
    Object.assign(process.env, {
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT:
        process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
      DYNAMODB_TAREFAS_TABLE: tabelas.tarefas,
      DYNAMODB_OUTBOX_TABLE: tabelas.outbox,
      DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: tabelas.mensagensProcessadas,
      JWT_PUBLIC_KEY: chaves.publicKey,
      OS_SERVICE_BASE_URL: 'http://127.0.0.1:9',
      OS_SERVICE_TOKEN: 'execution-os-token',
      SQS_EXECUTION_IN_URL: 'https://sqs.local/execution-in',
      SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.local/execution-in-dlq',
      SQS_OS_IN_URL: 'https://sqs.local/os-in',
      SQS_CONSUMER_HABILITADO: 'true',
      SQS_CONSUMER_INTERVAL_MS: '50',
      OUTBOX_PUBLISHER_HABILITADO: 'false',
      TERMINATION_GRACE_PERIOD_SECONDS: '850',
      OUTBOX_GSI_MAX_PAGINAS: '8',
      SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
      OUTBOX_REIVINDICACAO_MS: '480000',
    });
  });

  afterAll(async () => {
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  it('drena consumidor com lote em curso antes de destruir clientes', async () => {
    const fila = new FilaComLongPollMemoria();
    const app = await subirAplicacao(fila);
    const ordem: string[] = [];
    const dynamo = app.get(DynamoDbClientProvider);
    const sqsGateway = app.get(FilaSqsGateway);
    const sqsClient = (
      sqsGateway as unknown as { client: { destroy: () => void } }
    ).client;

    jest.spyOn(dynamo.client, 'destroy').mockImplementation(() => {
      ordem.push('dynamo-destroy');
    });
    jest.spyOn(sqsClient, 'destroy').mockImplementation(() => {
      ordem.push('sqs-destroy');
    });

    let liberarTransacao!: () => void;
    const portaTransacao = new Promise<void>((resolve) => {
      liberarTransacao = resolve;
    });
    const enviarOriginal = dynamo.enviar.bind(dynamo);
    let transacaoBloqueada = false;
    const spy = jest
      .spyOn(dynamo, 'enviar')
      .mockImplementation(async (comando, opcoes) => {
        if (comando instanceof TransactWriteItemsCommand) {
          transacaoBloqueada = true;
          await portaTransacao;
        }
        return enviarOriginal(comando, opcoes);
      });

    fila.enfileirarRecebimento(
      'https://sqs.local/execution-in',
      JSON.stringify(criarComandoIniciarDiagnostico()),
    );
    for (let i = 0; i < 80 && !transacaoBloqueada; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(transacaoBloqueada).toBe(true);

    const fechamento = app.close();
    expect(ordem).not.toContain('dynamo-destroy');
    expect(ordem).not.toContain('sqs-destroy');

    liberarTransacao();
    await fechamento;

    expect(ordem).toEqual(
      expect.arrayContaining(['dynamo-destroy', 'sqs-destroy']),
    );
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('cancela long polling pendente no encerramento', async () => {
    const fila = new FilaComLongPollMemoria();
    const app = await subirAplicacao(fila);
    const consumidor = app.get(ConsumidorFilaExecutionService);
    const ciclo = consumidor.poller();
    await new Promise((r) => setTimeout(r, 40));
    expect(fila.recebimentoPendente).toBeDefined();
    await app.close();
    await ciclo;
    expect(fila.recebimentoPendente?.sinal?.aborted).toBe(true);
  });
});
