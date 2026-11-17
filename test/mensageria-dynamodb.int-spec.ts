import { randomUUID } from 'node:crypto';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import {
  type ContextoTransacao,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import type { MarcadorEfeitoGateway } from '@/shared/messaging/application/ports/marcador-efeito.gateway';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import type { ProcessadorMensagem } from '@/shared/messaging/application/ports/processador-mensagem.port';
import {
  FILA_MENSAGENS,
  MARCADOR_EFEITO_GATEWAY,
  MENSAGEM_PROCESSADA_GATEWAY,
  OUTBOX_GATEWAY,
} from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import { RoteadorProcessadoresMensagemService } from '@/shared/messaging/application/services/roteador-processadores-mensagem.service';
import { ConteudoMensagemDivergenteError } from '@/shared/messaging/domain/mensageria.errors';
import {
  COMANDO_INICIAR_DIAGNOSTICO,
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';
import { ConsumidorFilaExecutionService } from '@/shared/messaging/infra/consumo/consumidor-fila-execution.service';
import { PublicadorOutboxService } from '@/shared/messaging/infra/outbox/publicador-outbox.service';
import { DynamoDbOutboxRepositorio } from '@/shared/messaging/infra/persistence/dynamodb-outbox-repositorio';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import {
  criarClienteDynamodbTeste,
  garantirTabelasDynamodb,
  obterNomesTabelasTeste,
} from './helpers/dynamodb-test-setup';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';

class ProcessadorMarcadorIntegracao implements ProcessadorMensagem {
  readonly eventType = COMANDO_INICIAR_DIAGNOSTICO;

  constructor(
    private readonly marcador: MarcadorEfeitoGateway,
    private readonly outbox: OutboxGateway,
  ) {}

  async processar(
    contexto: import('@/shared/database/unit-of-work.port').ContextoTransacao,
    envelope: EnvelopeMensagem,
  ): Promise<void> {
    const pk = `${envelope.ordemServicoId}#${envelope.rodada}#DIAGNOSTICO`;
    await this.marcador.gravarMarcador(contexto, pk, envelope.eventId);
    const eventoId = `saida-${envelope.eventId}`;
    await this.outbox.registrar(contexto, {
      eventId: eventoId,
      eventType: 'execution.diagnostico-iniciado.v1',
      envelope: {
        ...envelope,
        eventId: eventoId,
        eventType: 'execution.diagnostico-iniciado.v1',
        source: 'execution',
        causationId: envelope.eventId,
      },
      correlationId: envelope.correlationId,
      causationId: envelope.eventId,
      destino: DESTINO_FILA_OS,
    });
  }
}

function overrideRoteadorIntegracao(
  builder: ReturnType<typeof Test.createTestingModule>,
) {
  return builder
    .overrideProvider(RoteadorProcessadoresMensagemService)
    .useFactory({
      factory: (marcador: MarcadorEfeitoGateway, outbox: OutboxGateway) =>
        new RoteadorProcessadoresMensagemService([
          new ProcessadorMarcadorIntegracao(marcador, outbox),
        ]),
      inject: [MARCADOR_EFEITO_GATEWAY, OUTBOX_GATEWAY],
    });
}

describe('Mensageria e DynamoDB (integração)', () => {
  const client = criarClienteDynamodbTeste();
  const tabelas = obterNomesTabelasTeste();
  let modulo: TestingModule;
  let unitOfWork: UnitOfWork;
  let processar: ProcessarMensagemEntradaService;
  let outbox: OutboxGateway;
  let mensagensProcessadas: MensagemProcessadaGateway;
  let filaMemoria: FilaMensagensMemoriaGateway;
  let publicador: PublicadorOutboxService;

  beforeAll(async () => {
    await garantirTabelasDynamodb(client);
  });

  beforeEach(async () => {
    filaMemoria = new FilaMensagensMemoriaGateway();
    const filaExecution = 'https://sqs.local/execution-in';
    const filaOs = 'https://sqs.local/os-in';
    modulo = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              AWS_REGION: 'us-east-1',
              DYNAMODB_ENDPOINT:
                process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
              DYNAMODB_TAREFAS_TABLE: tabelas.tarefas,
              DYNAMODB_OUTBOX_TABLE: tabelas.outbox,
              DYNAMODB_MENSAGENS_PROCESSADAS_TABLE:
                tabelas.mensagensProcessadas,
              SQS_EXECUTION_IN_URL: filaExecution,
              SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.local/execution-dlq',
              SQS_OS_IN_URL: filaOs,
            }),
          ],
        }),
        ObservabilityModule,
        DynamoDbModule,
        MensageriaModule,
      ],
    })
      .overrideProvider(FILA_MENSAGENS)
      .useValue(filaMemoria);
    modulo = await overrideRoteadorIntegracao(modulo).compile();

    unitOfWork = modulo.get(UNIT_OF_WORK);
    processar = modulo.get(ProcessarMensagemEntradaService);
    outbox = modulo.get(OUTBOX_GATEWAY);
    mensagensProcessadas = modulo.get(MENSAGEM_PROCESSADA_GATEWAY);
    publicador = modulo.get(PublicadorOutboxService);
  });

  afterEach(async () => {
    await modulo.close();
  });

  function criarEnvelope(
    eventId: string,
    patch: Partial<EnvelopeMensagem> = {},
  ): EnvelopeMensagem {
    return {
      eventId,
      eventType: COMANDO_INICIAR_DIAGNOSTICO,
      version: 1,
      occurredAt: '2026-11-15T10:00:00.000Z',
      source: 'os-service',
      correlationId: randomUUID(),
      causationId: null,
      ordemServicoId: randomUUID(),
      rodada: 1,
      payload: { teste: true },
      ...patch,
    };
  }

  it('atomicidade: efeito, mensagem processada e outbox na mesma transação', async () => {
    const envelope = criarEnvelope(randomUUID());
    await processar.executar(JSON.stringify(envelope));

    const marcador = await client.send(
      new GetItemCommand({
        TableName: tabelas.tarefas,
        Key: marshall({
          pk: `${envelope.ordemServicoId}#${envelope.rodada}#DIAGNOSTICO`,
        }),
      }),
    );
    expect(marcador.Item).toBeDefined();

    const msg = await client.send(
      new GetItemCommand({
        TableName: tabelas.mensagensProcessadas,
        Key: marshall({ eventId: envelope.eventId }),
      }),
    );
    expect(msg.Item).toBeDefined();

    const out = await client.send(
      new GetItemCommand({
        TableName: tabelas.outbox,
        Key: marshall({ eventId: `saida-${envelope.eventId}` }),
      }),
    );
    expect(out.Item).toBeDefined();
  });

  it('reentrega não duplica efeitos para o mesmo eventId', async () => {
    const envelope = criarEnvelope(randomUUID());
    await processar.executar(JSON.stringify(envelope));
    await processar.executar(JSON.stringify(envelope));

    const marcador = await client.send(
      new GetItemCommand({
        TableName: tabelas.tarefas,
        Key: marshall({
          pk: `${envelope.ordemServicoId}#${envelope.rodada}#DIAGNOSTICO`,
        }),
      }),
    );
    expect(marcador.Item).toBeDefined();
  });

  it('mesmo eventId com conteúdo divergente recusa', async () => {
    const eventId = randomUUID();
    const envelope1 = criarEnvelope(eventId);
    await processar.executar(JSON.stringify(envelope1));
    const envelope2 = { ...envelope1, payload: { teste: 'outro' } };
    await expect(
      processar.executar(JSON.stringify(envelope2)),
    ).rejects.toBeInstanceOf(ConteudoMensagemDivergenteError);
  });

  describe('rollback depois de falha condicional real em transação de três itens', () => {
    type ItemFalho = 'efeito' | 'mensagem processada' | 'outbox';

    async function existe(tabela: string, chave: Record<string, string>) {
      const resposta = await client.send(
        new GetItemCommand({
          TableName: tabela,
          Key: marshall(chave),
          ConsistentRead: true,
        }),
      );
      return resposta.Item ? unmarshall(resposta.Item) : undefined;
    }

    it.each<ItemFalho>(['efeito', 'mensagem processada', 'outbox'])(
      'a falha condicional no item de %s desfaz os outros dois',
      async (itemFalho) => {
        const marcador = modulo.get<MarcadorEfeitoGateway>(
          MARCADOR_EFEITO_GATEWAY,
        );
        const eventId = randomUUID();
        const chaveEfeito = `rollback-${randomUUID()}#1#DIAGNOSTICO`;
        const outboxId = `out-rollback-${randomUUID()}`;
        const registrarOutbox = (contexto: ContextoTransacao) =>
          outbox.registrar(contexto, {
            eventId: outboxId,
            eventType: 'execution.diagnostico-iniciado.v1',
            envelope: criarEnvelope(eventId),
            correlationId: randomUUID(),
            causationId: null,
            destino: DESTINO_FILA_OS,
          });

        // Grava antes apenas o item que vai falhar, para a recusa ser condicional de verdade.
        await unitOfWork.executar(async (contexto) => {
          if (itemFalho === 'efeito') {
            await marcador.gravarMarcador(contexto, chaveEfeito, 'original');
          } else if (itemFalho === 'mensagem processada') {
            await mensagensProcessadas.registrar(
              contexto,
              eventId,
              'hash-original',
            );
          } else {
            await registrarOutbox(contexto);
          }
        });

        await expect(
          unitOfWork.executar(async (contexto) => {
            await marcador.gravarMarcador(contexto, chaveEfeito, 'novo');
            await mensagensProcessadas.registrar(
              contexto,
              eventId,
              'hash-novo',
            );
            await registrarOutbox(contexto);
          }),
        ).rejects.toBeInstanceOf(ConflitoTransacionalError);

        const efeito = await existe(tabelas.tarefas, { pk: chaveEfeito });
        const mensagem = await existe(tabelas.mensagensProcessadas, {
          eventId,
        });
        const saida = await existe(tabelas.outbox, { eventId: outboxId });

        expect(Boolean(efeito)).toBe(itemFalho === 'efeito');
        expect(Boolean(mensagem)).toBe(itemFalho === 'mensagem processada');
        expect(Boolean(saida)).toBe(itemFalho === 'outbox');
        if (efeito) expect(efeito.eventIdOrigem).toBe('original');
        if (mensagem) expect(mensagem.hashConteudo).toBe('hash-original');
      },
    );
  });

  it('reivindicação concorrente da outbox: uma publica, outra faz fencing', async () => {
    const eventId = randomUUID();
    const envelope = criarEnvelope(randomUUID());
    const outboxId = `out-${eventId}`;

    await unitOfWork.executar(async (ctx) => {
      await outbox.registrar(ctx, {
        eventId: outboxId,
        eventType: 'execution.diagnostico-iniciado.v1',
        envelope,
        correlationId: envelope.correlationId,
        causationId: envelope.eventId,
        destino: DESTINO_FILA_OS,
      });
    });

    const [a, b] = await Promise.all([
      publicador.reivindicarLote(),
      publicador.reivindicarLote(),
    ]);
    const totalReivindicado = a.length + b.length;
    expect(totalReivindicado).toBeGreaterThanOrEqual(1);
    if (a.length > 0 && b.length > 0) {
      expect(
        new Set([...a.map((x) => x.eventId), ...b.map((x) => x.eventId)]).size,
      ).toBe(1);
    }
  });

  it('publicação bem-sucedida com falha na confirmação mantém registro recuperável', async () => {
    const envelope = criarEnvelope(randomUUID());
    const outboxId = `out-fence-${randomUUID()}`;
    await unitOfWork.executar(async (ctx) => {
      await outbox.registrar(ctx, {
        eventId: outboxId,
        eventType: 'execution.diagnostico-iniciado.v1',
        envelope,
        correlationId: envelope.correlationId,
        causationId: envelope.eventId,
        destino: DESTINO_FILA_OS,
      });
    });

    const outboxRepo = modulo.get(DynamoDbOutboxRepositorio);
    const token = randomUUID();
    const mensagem = await outboxRepo.reivindicar(
      outboxId,
      token,
      new Date(Date.now() + 300_000).toISOString(),
    );
    expect(mensagem).toBeDefined();
    const enviosAntes = filaMemoria.enviados.length;
    await publicador.publicarMensagemReivindicada(mensagem!);

    const item = await client.send(
      new GetItemCommand({
        TableName: tabelas.outbox,
        Key: marshall({ eventId: outboxId }),
      }),
    );
    const estado = unmarshall(item.Item ?? {});
    expect(estado.enviadoEm).toBeDefined();
    const enviosAposPrimeira = filaMemoria.enviados.length;
    expect(enviosAposPrimeira - enviosAntes).toBe(1);

    const tokenAntigo = mensagem!.tokenReivindicacao ?? 'token-antigo';
    await publicador.publicarMensagemReivindicada({
      ...mensagem!,
      tokenReivindicacao: tokenAntigo,
    });
    expect(filaMemoria.enviados.length).toBe(enviosAposPrimeira + 1);
    const estadoFinal = unmarshall(
      (
        await client.send(
          new GetItemCommand({
            TableName: tabelas.outbox,
            Key: marshall({ eventId: outboxId }),
          }),
        )
      ).Item ?? {},
    );
    expect(estadoFinal.enviadoEm).toBeDefined();
  });

  it('falha de publicação mantém outbox pendente com backoff', async () => {
    const envelope = criarEnvelope(randomUUID());
    const outboxId = `out-fail-${randomUUID()}`;
    await unitOfWork.executar(async (ctx) => {
      await outbox.registrar(ctx, {
        eventId: outboxId,
        eventType: 'execution.diagnostico-iniciado.v1',
        envelope,
        correlationId: envelope.correlationId,
        causationId: envelope.eventId,
        destino: DESTINO_FILA_OS,
      });
    });

    const outboxRepo = modulo.get(DynamoDbOutboxRepositorio);
    const registro = await outboxRepo.reivindicar(
      outboxId,
      randomUUID(),
      new Date(Date.now() + 300_000).toISOString(),
    );
    expect(registro).toBeDefined();
    filaMemoria.enviar = async () => {
      throw new Error('falha simulada SQS');
    };

    await publicador.publicarMensagemReivindicada(registro!);
    const item = await client.send(
      new GetItemCommand({
        TableName: tabelas.outbox,
        Key: marshall({ eventId: outboxId }),
      }),
    );
    const estado = unmarshall(item.Item ?? {});
    expect(estado.enviadoEm).toBeUndefined();
    expect(Number(estado.tentativas)).toBeGreaterThanOrEqual(1);
    expect(estado.bloqueadoAte).toBeDefined();
  });

  it('consumidor confirma somente após processamento transacional', async () => {
    const consumidor = modulo.get(ConsumidorFilaExecutionService);
    const envelope = criarEnvelope(randomUUID());
    const filaUrl = 'https://sqs.local/execution-in';
    const receipt = filaMemoria.enfileirarRecebimento(
      filaUrl,
      JSON.stringify(envelope),
    );

    await consumidor.processarUma(JSON.stringify(envelope), receipt);
    expect(filaMemoria.filas.get(filaUrl)?.length ?? 0).toBe(0);
  });

  it('duas instâncias concorrentes no mesmo eventId: um efeito único', async () => {
    const filaExecution = 'https://sqs.local/execution-in';
    const filaOs = 'https://sqs.local/os-in';
    const criarModulo = async () => {
      const builder = Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                AWS_REGION: 'us-east-1',
                DYNAMODB_ENDPOINT:
                  process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
                DYNAMODB_TAREFAS_TABLE: tabelas.tarefas,
                DYNAMODB_OUTBOX_TABLE: tabelas.outbox,
                DYNAMODB_MENSAGENS_PROCESSADAS_TABLE:
                  tabelas.mensagensProcessadas,
                SQS_EXECUTION_IN_URL: filaExecution,
                SQS_OS_IN_URL: filaOs,
              }),
            ],
          }),
          ObservabilityModule,
          DynamoDbModule,
          MensageriaModule,
        ],
      })
        .overrideProvider(FILA_MENSAGENS)
        .useValue(new FilaMensagensMemoriaGateway());
      return overrideRoteadorIntegracao(builder).compile();
    };

    const [mod1, mod2] = await Promise.all([criarModulo(), criarModulo()]);
    const eventId = randomUUID();
    const envelope = criarEnvelope(eventId);
    const corpo = JSON.stringify(envelope);
    await Promise.all([
      mod1.get(ProcessarMensagemEntradaService).executar(corpo),
      mod2.get(ProcessarMensagemEntradaService).executar(corpo),
    ]);
    await mod1.close();
    await mod2.close();

    const marcador = await client.send(
      new GetItemCommand({
        TableName: tabelas.tarefas,
        Key: marshall({
          pk: `${envelope.ordemServicoId}#${envelope.rodada}#DIAGNOSTICO`,
        }),
      }),
    );
    expect(marcador.Item).toBeDefined();
  });
});
