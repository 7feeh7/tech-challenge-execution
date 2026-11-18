import { randomUUID } from 'node:crypto';
import {
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TarefaGateway } from '@/modules/tarefas/application/ports/tarefa.gateway';
import { TAREFA_GATEWAY } from '@/modules/tarefas/application/ports/tokens';
import { ConcluirTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-reparo.use-case';
import { FalharTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/falhar-tarefa-reparo.use-case';
import { IniciarTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-reparo.use-case';
import { ListarTarefasUseCase } from '@/modules/tarefas/application/use-cases/listar-tarefas.use-case';
import type { Tarefa } from '@/modules/tarefas/domain/entities/tarefa.entity';
import {
  ItemPecaIdInvalidoError,
  JustificativaDivergenciaObrigatoriaError,
  TarefaSituacaoInvalidaError,
} from '@/modules/tarefas/domain/errors/tarefa.errors';
import { TipoDivergenciaPeca } from '@/modules/tarefas/domain/tipo-divergencia-peca.enum';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import { criarBarreiraDupla } from './helpers/barreira-transacao-dynamodb';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import { criarComandoIniciarReparo } from './helpers/envelope-teste';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';

describe('Tarefas de reparo (integração DynamoDB Local)', () => {
  const client: DynamoDBClient = criarClienteDynamodbTeste();
  let tabelas: NomesTabelasDynamodb;
  let modulo: TestingModule;
  let processarComando: ProcessarMensagemEntradaService;
  let listar: ListarTarefasUseCase;
  let iniciar: IniciarTarefaReparoUseCase;
  let concluir: ConcluirTarefaReparoUseCase;
  let falhar: FalharTarefaReparoUseCase;
  let unitOfWork: UnitOfWork;
  let gateway: TarefaGateway;
  let dynamoProvider: DynamoDbClientProvider;

  async function lerItem(
    tabela: string,
    chave: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    const resposta = await client.send(
      new GetItemCommand({
        TableName: tabela,
        Key: marshall(chave),
        ConsistentRead: true,
      }),
    );
    return resposta.Item ? unmarshall(resposta.Item) : undefined;
  }

  const lerTarefa = (id: string) => lerItem(tabelas.tarefas, { pk: id });

  async function consumirComando(
    patch: Parameters<typeof criarComandoIniciarReparo>[0] = {},
  ) {
    const comando = criarComandoIniciarReparo(patch);
    await processarComando.executar(JSON.stringify(comando));
    return {
      comando,
      tarefaId: `${comando.ordemServicoId}#${comando.rodada}#REPARO`,
    };
  }

  beforeAll(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-reparo');
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
            }),
          ],
        }),
        ObservabilityModule,
        DynamoDbModule,
        MensageriaModule,
      ],
    })
      .overrideProvider(FILA_MENSAGENS)
      .useValue(new FilaMensagensMemoriaGateway())
      .compile();

    const obter = <T>(tipo: new (...args: never[]) => T): T =>
      modulo.get(tipo, { strict: false });
    processarComando = obter(ProcessarMensagemEntradaService);
    listar = obter(ListarTarefasUseCase);
    iniciar = obter(IniciarTarefaReparoUseCase);
    concluir = obter(ConcluirTarefaReparoUseCase);
    falhar = obter(FalharTarefaReparoUseCase);
    unitOfWork = modulo.get(UNIT_OF_WORK);
    gateway = modulo.get(TAREFA_GATEWAY);
    dynamoProvider = modulo.get(DynamoDbClientProvider);
  });

  afterAll(async () => {
    await modulo.close();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  it('cria tarefa REPARO idempotente a partir de execution.iniciar-reparo.v1', async () => {
    const { comando, tarefaId } = await consumirComando();

    const item = await lerTarefa(tarefaId);
    expect(item).toMatchObject({
      tipo: 'REPARO',
      situacao: 'PENDENTE',
      correlationId: comando.correlationId,
      indiceFila: 'REPARO#PENDENTE',
    });
    expect(
      await lerItem(tabelas.mensagensProcessadas, { eventId: comando.eventId }),
    ).toBeDefined();

    await processarComando.executar(JSON.stringify(comando));
    expect((await lerTarefa(tarefaId))?.versao).toBe(1);
  });

  it('lista fila REPARO em ordem de chegada', async () => {
    const a = await consumirComando();
    await new Promise((r) => setTimeout(r, 5));
    const b = await consumirComando();
    const fila = await listar.execute({ tipo: TipoTarefa.REPARO, limite: 10 });
    const ids = fila.itens.map((t) => t.id);
    expect(ids.indexOf(a.tarefaId)).toBeLessThan(ids.indexOf(b.tarefaId));
  });

  it('dois mecânicos concorrentes: um inicia, um evento ReparoIniciado', async () => {
    const { comando, tarefaId } = await consumirComando();
    const resultados = await Promise.allSettled([
      iniciar.execute(tarefaId, 'mec-1'),
      iniciar.execute(tarefaId, 'mec-2'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(TarefaSituacaoInvalidaError);
    expect(
      await procurarEventosOutbox(
        'execution.reparo-iniciado.v1',
        comando.ordemServicoId,
      ),
    ).toHaveLength(1);
  });

  it('conclui com divergência e publica ReparoConcluido', async () => {
    const { comando, tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');

    const saida = await concluir.execute(tarefaId, {
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [
        { itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', quantidade: 1 },
      ],
      responsavelOperacaoId: 'mec-1',
    });

    expect(saida.situacao).toBe('CONCLUIDA');
    expect(saida.divergencias).toHaveLength(1);
    expect(saida.divergencias[0]?.tipo).toBe(
      TipoDivergenciaPeca.CONSUMO_INFERIOR,
    );
    const eventos = await procurarEventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    expect(eventos).toHaveLength(1);
    expect((eventos[0].envelope as { payload: unknown }).payload).toMatchObject(
      {
        tarefaId,
        divergencias: expect.arrayContaining([
          expect.objectContaining({
            itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          }),
        ]),
      },
    );
  });

  it('conclusões concorrentes produzem um único ReparoConcluido', async () => {
    const { comando, tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    const corpo = {
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [] as { itemId: string; quantidade: number }[],
      responsavelOperacaoId: 'mec-1',
    };

    await Promise.all([
      concluir.execute(tarefaId, corpo),
      concluir.execute(tarefaId, corpo),
    ]);

    expect(
      await procurarEventosOutbox(
        'execution.reparo-concluido.v1',
        comando.ordemServicoId,
      ),
    ).toHaveLength(1);
  });

  it('registra peça fora da lista com justificativa e responsavelId no fato', async () => {
    const { comando, tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    const pecaFora = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    await concluir.execute(tarefaId, {
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [{ itemId: pecaFora, quantidade: 1 }],
      justificativaDivergencia: 'Necessária em campo',
      responsavelOperacaoId: 'mec-1',
    });

    const tarefa = await lerTarefa(tarefaId);
    expect(tarefa?.responsavelOperacaoId).toBe('mec-1');
    const eventos = await procurarEventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    const payload = (
      eventos[0].envelope as { payload: Record<string, unknown> }
    ).payload;
    expect(payload.responsavelId).toBe('mec-1');
    expect(payload.divergencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
          justificativa: 'Necessária em campo',
        }),
      ]),
    );
  });

  it('recusa peça fora da lista sem justificativa', async () => {
    const { tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    await expect(
      concluir.execute(tarefaId, {
        servicosRealizados: [
          { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
        ],
        pecasUtilizadas: [
          { itemId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantidade: 1 },
        ],
        responsavelOperacaoId: 'mec-1',
      }),
    ).rejects.toBeInstanceOf(JustificativaDivergenciaObrigatoriaError);
  });

  it('recusa identificador de peça inválido', async () => {
    const { tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    await expect(
      concluir.execute(tarefaId, {
        servicosRealizados: [
          { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
        ],
        pecasUtilizadas: [{ itemId: 'peca-extra', quantidade: 1 }],
        responsavelOperacaoId: 'mec-1',
      }),
    ).rejects.toBeInstanceOf(ItemPecaIdInvalidoError);
  });

  it('conclusão e falha com barreira: um único fato terminal coerente', async () => {
    const { comando, tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    const entrada = {
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [
        { itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', quantidade: 2 },
      ],
      responsavelOperacaoId: 'mec-1',
    };
    const barreira = criarBarreiraDupla();
    const enviarOriginal = dynamoProvider.enviar.bind(dynamoProvider);
    const spy = jest
      .spyOn(dynamoProvider, 'enviar')
      .mockImplementation(async (comando, opcoes) => {
        if (comando instanceof TransactWriteItemsCommand) {
          await barreira.aguardarNaTransacao();
        }
        return enviarOriginal(comando, opcoes);
      });
    try {
      await Promise.allSettled([
        concluir.execute(tarefaId, entrada),
        falhar.execute(tarefaId, {
          motivo: 'Falha no teste concorrente',
          ...entrada,
        }),
      ]);
    } finally {
      spy.mockRestore();
      barreira.liberar();
    }

    const concluidos = await procurarEventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    const falhas = await procurarEventosOutbox(
      'execution.reparo-falhou.v1',
      comando.ordemServicoId,
    );
    expect(concluidos.length + falhas.length).toBe(1);

    const tarefaFinal = await lerTarefa(tarefaId);
    const terminal = tarefaFinal?.situacao;
    expect(['CONCLUIDA', 'FALHOU']).toContain(terminal);
    if (terminal === 'CONCLUIDA') {
      expect(concluidos).toHaveLength(1);
      expect(falhas).toHaveLength(0);
      expect(tarefaFinal?.fatoTerminalEventId).toBeDefined();
    } else {
      expect(falhas).toHaveLength(1);
      expect(concluidos).toHaveLength(0);
      expect(tarefaFinal?.fatoTerminalEventId).toBeDefined();
    }
  });

  it('registra falha com ReparoFalhou', async () => {
    const { comando, tarefaId } = await consumirComando();
    await iniciar.execute(tarefaId, 'mec-1');
    await falhar.execute(tarefaId, {
      motivo: 'Peça incompatível',
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [
        { itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', quantidade: 2 },
      ],
      responsavelOperacaoId: 'mec-1',
    });
    expect(
      await procurarEventosOutbox(
        'execution.reparo-falhou.v1',
        comando.ordemServicoId,
      ),
    ).toHaveLength(1);
    expect(await lerTarefa(tarefaId)).toMatchObject({ situacao: 'FALHOU' });
  });

  it('rejeita escrita com versão desatualizada', async () => {
    const { tarefaId } = await consumirComando();
    const desatualizada = await unitOfWork.executar((contexto) =>
      gateway.buscarPorId(contexto, tarefaId),
    );
    await iniciar.execute(tarefaId, 'mec-1');
    desatualizada?.iniciar('mec-2', new Date());
    await expect(
      unitOfWork.executar((contexto) =>
        gateway.salvar(contexto, desatualizada as Tarefa),
      ),
    ).rejects.toBeInstanceOf(ConflitoTransacionalError);
  });

  it('comando em rodada distinta cria outra chave', async () => {
    const ordemServicoId = randomUUID();
    await consumirComando({ ordemServicoId, rodada: 1 });
    await consumirComando({ ordemServicoId, rodada: 2 });
    expect(await lerTarefa(`${ordemServicoId}#1#REPARO`)).toBeDefined();
    expect(await lerTarefa(`${ordemServicoId}#2#REPARO`)).toBeDefined();
  });

  it('marcador de bloqueio impede criação', async () => {
    const ordemServicoId = randomUUID();
    const tarefaId = `${ordemServicoId}#1#REPARO`;
    await client.send(
      new PutItemCommand({
        TableName: tabelas.tarefas,
        Item: marshall({
          pk: tarefaId,
          tipo: 'BLOQUEIO',
          situacao: 'BLOQUEADA',
        }),
      }),
    );
    await consumirComando({ ordemServicoId });
    expect(await lerTarefa(tarefaId)).toMatchObject({ tipo: 'BLOQUEIO' });
  });

  async function procurarEventosOutbox(
    eventType: string,
    ordemServicoId: string,
  ): Promise<Record<string, unknown>[]> {
    const itens: Record<string, unknown>[] = [];
    let chave: Record<string, never> | undefined;
    do {
      const resposta = await client.send(
        new ScanCommand({
          TableName: tabelas.outbox,
          ExclusiveStartKey: chave,
        }),
      );
      for (const item of resposta.Items ?? []) {
        const registro = unmarshall(item);
        const envelope = registro.envelope as { ordemServicoId?: string };
        if (
          registro.eventType === eventType &&
          envelope.ordemServicoId === ordemServicoId
        ) {
          itens.push(registro);
        }
      }
      chave = resposta.LastEvaluatedKey as Record<string, never> | undefined;
    } while (chave);
    return itens;
  }
});
