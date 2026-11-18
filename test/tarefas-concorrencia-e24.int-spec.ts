import { randomUUID } from 'node:crypto';
import {
  type DynamoDBClient,
  GetItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConcluirTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-diagnostico.use-case';
import { ConcluirTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-reparo.use-case';
import { FalharTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/falhar-tarefa-reparo.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { IniciarTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-reparo.use-case';
import { TIPO_REGISTRO_MARCADOR_BLOQUEIO } from '@/modules/tarefas/domain/marcador-bloqueio';
import { ResultadoCancelamento } from '@/modules/tarefas/domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '@/modules/tarefas/domain/situacao-tarefa.enum';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import { EVENTO_RESPOSTA_CANCELAMENTO } from '@/shared/messaging/envelope';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import {
  criarComandoCancelarTarefa,
  criarComandoIniciarDiagnostico,
  criarComandoIniciarReparo,
} from './helpers/envelope-teste';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';
import { executarComBarreiraTransacao } from './helpers/instalar-barreira-transacao';
import {
  criarRespostaOsBloqueada,
  OsHttpDouble,
} from './helpers/os-http-double';

const PECA_OFICIAL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SERVICO_OFICIAL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('Concorrência E24 (integração DynamoDB Local)', () => {
  const client: DynamoDBClient = criarClienteDynamodbTeste();
  const os = new OsHttpDouble();
  let tabelas: NomesTabelasDynamodb;
  let modulo: TestingModule;
  let dynamo: DynamoDbClientProvider;
  let processarComando: ProcessarMensagemEntradaService;
  let iniciarDiagnostico: IniciarTarefaDiagnosticoUseCase;
  let iniciarReparo: IniciarTarefaReparoUseCase;
  let concluirDiagnostico: ConcluirTarefaDiagnosticoUseCase;
  let concluirReparo: ConcluirTarefaReparoUseCase;
  let falharReparo: FalharTarefaReparoUseCase;

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

  async function eventosOutbox(
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

  beforeAll(async () => {
    const osUrl = await os.iniciar();
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-e24-corr');
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
              OS_SERVICE_BASE_URL: osUrl,
              OS_SERVICE_TOKEN: 'execution-os-token',
              OS_REQUEST_TIMEOUT_MS: '60000',
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
    dynamo = modulo.get(DynamoDbClientProvider);
    processarComando = obter(ProcessarMensagemEntradaService);
    iniciarDiagnostico = obter(IniciarTarefaDiagnosticoUseCase);
    iniciarReparo = obter(IniciarTarefaReparoUseCase);
    concluirDiagnostico = obter(ConcluirTarefaDiagnosticoUseCase);
    concluirReparo = obter(ConcluirTarefaReparoUseCase);
    falharReparo = obter(FalharTarefaReparoUseCase);
  });

  afterAll(async () => {
    await modulo.close();
    await os.parar();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
    dynamo.client.destroy();
  });

  beforeEach(() => os.reiniciar());

  async function aguardarSituacao(
    tarefaId: string,
    situacao: string,
    tentativas = 80,
  ): Promise<void> {
    for (let i = 0; i < tentativas; i += 1) {
      const item = await lerTarefa(tarefaId);
      if (item?.situacao === situacao) return;
    }
    throw new Error(
      `Situação ${situacao} não alcançada para ${tarefaId} em ${tentativas} leituras`,
    );
  }

  it('criação de tarefa versus cancelamento com barreira em TransactWrite', async () => {
    const ordemServicoId = randomUUID();
    const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;
    const estadoAntesCriacao = await lerTarefa(tarefaId);
    expect(estadoAntesCriacao).toBeUndefined();

    await executarComBarreiraTransacao(dynamo, [
      () =>
        processarComando.executar(
          JSON.stringify(criarComandoIniciarDiagnostico({ ordemServicoId })),
        ),
      () =>
        processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId },
              TipoTarefa.DIAGNOSTICO,
            ),
          ),
        ),
    ]);

    const item = await lerTarefa(tarefaId);
    const respostas = await eventosOutbox(
      EVENTO_RESPOSTA_CANCELAMENTO,
      ordemServicoId,
    );
    expect(respostas.length).toBeGreaterThanOrEqual(1);
    if (item?.tipo === TIPO_REGISTRO_MARCADOR_BLOQUEIO) {
      const envelope0 = respostas[0]?.envelope as
        | { payload: unknown }
        | undefined;
      const payload = envelope0?.payload;
      expect(payload).toMatchObject({
        resultado: ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
      });
    } else {
      expect(item).toMatchObject({
        tipo: TipoTarefa.DIAGNOSTICO,
        situacao: SituacaoTarefa.CANCELADA,
      });
    }
  });

  it('início de reparo versus cancelamento: estado terminal único', async () => {
    const comando = criarComandoIniciarReparo();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
    await processarComando.executar(JSON.stringify(comando));
    expect(await lerTarefa(tarefaId)).toMatchObject({ situacao: 'PENDENTE' });

    await executarComBarreiraTransacao(dynamo, [
      () => iniciarReparo.execute(tarefaId, 'mec-1'),
      () =>
        processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId: comando.ordemServicoId },
              TipoTarefa.REPARO,
            ),
          ),
        ),
    ]);

    const final = await lerTarefa(tarefaId);
    expect(final).toBeDefined();
    expect(['EM_ANDAMENTO', 'INTERRUPCAO_SOLICITADA', 'CANCELADA']).toContain(
      final?.situacao,
    );
    const concluidos = await eventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    expect(concluidos).toHaveLength(0);
  });

  it('conclusão de reparo versus cancelamento: um fato terminal ou interrupção', async () => {
    const comando = criarComandoIniciarReparo();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarReparo.execute(tarefaId, 'mec-1');
    const entrada = {
      servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
      pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 2 }],
      responsavelOperacaoId: 'mec-1',
    };

    await executarComBarreiraTransacao(dynamo, [
      () => concluirReparo.execute(tarefaId, entrada),
      () =>
        processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId: comando.ordemServicoId },
              TipoTarefa.REPARO,
            ),
          ),
        ),
    ]);

    const final = await lerTarefa(tarefaId);
    const concluidos = await eventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    const falhas = await eventosOutbox(
      'execution.reparo-falhou.v1',
      comando.ordemServicoId,
    );
    if (final?.situacao === 'CONCLUIDA') {
      expect(concluidos).toHaveLength(1);
      expect(falhas).toHaveLength(0);
    } else {
      expect(final?.situacao).toMatch(
        /INTERRUPCAO_SOLICITADA|EM_ANDAMENTO|CANCELADA/,
      );
      expect(concluidos).toHaveLength(0);
    }
  });

  it('falha de reparo versus cancelamento: um fato terminal ou interrupção', async () => {
    const comando = criarComandoIniciarReparo();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarReparo.execute(tarefaId, 'mec-1');

    await executarComBarreiraTransacao(dynamo, [
      () =>
        falharReparo.execute(tarefaId, {
          motivo: 'corrida-e24',
          servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
          pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 2 }],
          responsavelOperacaoId: 'mec-1',
        }),
      () =>
        processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId: comando.ordemServicoId },
              TipoTarefa.REPARO,
            ),
          ),
        ),
    ]);

    const final = await lerTarefa(tarefaId);
    const falhas = await eventosOutbox(
      'execution.reparo-falhou.v1',
      comando.ordemServicoId,
    );
    const concluidos = await eventosOutbox(
      'execution.reparo-concluido.v1',
      comando.ordemServicoId,
    );
    expect(concluidos.length + falhas.length).toBeLessThanOrEqual(1);
    if (final?.situacao === 'FALHOU') {
      expect(falhas).toHaveLength(1);
    }
  });

  it('conclusão de diagnóstico versus cancelamento com barreira em TransactWrite', async () => {
    const comando = criarComandoIniciarDiagnostico();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarDiagnostico.execute(tarefaId, 'mec-1');
    os.enfileirarResposta({
      status: 200,
      corpo: {
        rodada: 1,
        itensOficiais: [
          { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
        ],
      },
    });

    await executarComBarreiraTransacao(dynamo, [
      () =>
        concluirDiagnostico.execute(tarefaId, {
          laudo: 'Corrida',
          itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
        }),
      () =>
        processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId: comando.ordemServicoId },
              TipoTarefa.DIAGNOSTICO,
            ),
          ),
        ),
    ]);

    const final = await lerTarefa(tarefaId);
    expect([SituacaoTarefa.CANCELADA, SituacaoTarefa.CONCLUIDA]).toContain(
      final?.situacao,
    );
    expect(
      await eventosOutbox(EVENTO_RESPOSTA_CANCELAMENTO, comando.ordemServicoId),
    ).toHaveLength(1);
    if (final?.situacao === SituacaoTarefa.CONCLUIDA) {
      expect(final.laudo).toBe('Corrida');
    }
  });

  it('cancelamento durante CONCLUSAO_EM_ANDAMENTO com OS bloqueado', async () => {
    const comando = criarComandoIniciarDiagnostico();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarDiagnostico.execute(tarefaId, 'mec-1');

    const respostaOs = criarRespostaOsBloqueada({
      status: 200,
      corpo: {
        rodada: 1,
        itensOficiais: [
          { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
        ],
      },
    });
    respostaOs.enfileirar(os);

    const conclusaoPendente = concluirDiagnostico.execute(tarefaId, {
      laudo: 'Ok',
      itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
    });

    conclusaoPendente.catch(() => undefined);
    await aguardarSituacao(tarefaId, SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);

    await processarComando.executar(
      JSON.stringify(
        criarComandoCancelarTarefa(
          { ordemServicoId: comando.ordemServicoId },
          TipoTarefa.DIAGNOSTICO,
        ),
      ),
    );
    expect(await lerTarefa(tarefaId)).toMatchObject({
      situacao: SituacaoTarefa.CANCELADA,
    });

    respostaOs.liberar();
    await expect(conclusaoPendente).rejects.toBeDefined();

    expect(await lerTarefa(tarefaId)).toMatchObject({
      situacao: SituacaoTarefa.CANCELADA,
    });
    expect((await lerTarefa(tarefaId))?.situacao).toBe(
      SituacaoTarefa.CANCELADA,
    );
  });

  it('resposta HTTP tardia do OS não conclui tarefa já cancelada', async () => {
    const comando = criarComandoIniciarDiagnostico();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarDiagnostico.execute(tarefaId, 'mec-1');

    const respostaOs = criarRespostaOsBloqueada({
      status: 200,
      corpo: {
        rodada: 1,
        itensOficiais: [
          { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
        ],
      },
    });
    respostaOs.enfileirar(os);

    const promessa = concluirDiagnostico.execute(tarefaId, {
      laudo: 'Tardio',
      itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
    });

    promessa.catch(() => undefined);
    await aguardarSituacao(tarefaId, SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);

    await processarComando.executar(
      JSON.stringify(
        criarComandoCancelarTarefa(
          { ordemServicoId: comando.ordemServicoId },
          TipoTarefa.DIAGNOSTICO,
        ),
      ),
    );

    respostaOs.liberar();
    await expect(promessa).rejects.toBeDefined();

    const item = await lerTarefa(tarefaId);
    expect(item).toMatchObject({ situacao: SituacaoTarefa.CANCELADA });
    expect(item?.versao).toBeGreaterThanOrEqual(2);
    expect(item?.situacao).not.toBe(SituacaoTarefa.CONCLUIDA);
  });
});
