import { randomUUID } from 'node:crypto';
import {
  type DynamoDBClient,
  GetItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConcluirTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-reparo.use-case';
import { FalharTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/falhar-tarefa-reparo.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { IniciarTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-reparo.use-case';
import { InterromperTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/interromper-tarefa-reparo.use-case';
import { TarefaInterrupcaoSolicitadaError } from '@/modules/tarefas/domain/errors/tarefa.errors';
import { TIPO_REGISTRO_MARCADOR_BLOQUEIO } from '@/modules/tarefas/domain/marcador-bloqueio';
import { ResultadoCancelamento } from '@/modules/tarefas/domain/resultado-cancelamento.enum';
import { TipoDivergenciaPeca } from '@/modules/tarefas/domain/tipo-divergencia-peca.enum';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import {
  EVENTO_REPARO_INTERROMPIDO,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '@/shared/messaging/envelope';
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

const PECA_OFICIAL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SERVICO_OFICIAL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('Tarefas — cancelamento (integração DynamoDB Local, E24)', () => {
  const client: DynamoDBClient = criarClienteDynamodbTeste();
  let tabelas: NomesTabelasDynamodb;
  let modulo: TestingModule;
  let processarComando: ProcessarMensagemEntradaService;
  let iniciarDiagnostico: IniciarTarefaDiagnosticoUseCase;
  let iniciarReparo: IniciarTarefaReparoUseCase;
  let concluirReparo: ConcluirTarefaReparoUseCase;
  let falharReparo: FalharTarefaReparoUseCase;
  let interromperReparo: InterromperTarefaReparoUseCase;

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

  async function consumirDiagnostico(
    patch: Parameters<typeof criarComandoIniciarDiagnostico>[0] = {},
  ) {
    const comando = criarComandoIniciarDiagnostico(patch);
    await processarComando.executar(JSON.stringify(comando));
    return {
      comando,
      tarefaId: `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`,
    };
  }

  async function consumirReparo(
    patch: Parameters<typeof criarComandoIniciarReparo>[0] = {},
  ) {
    const comando = criarComandoIniciarReparo(patch);
    await processarComando.executar(JSON.stringify(comando));
    return {
      comando,
      tarefaId: `${comando.ordemServicoId}#${comando.rodada}#REPARO`,
    };
  }

  async function consumirCancelamento(
    patch: Parameters<typeof criarComandoCancelarTarefa>[0] = {},
    tipoTarefa: TipoTarefa = TipoTarefa.DIAGNOSTICO,
  ) {
    const comando = criarComandoCancelarTarefa(patch, tipoTarefa);
    await processarComando.executar(JSON.stringify(comando));
    return {
      comando,
      tarefaId: `${comando.ordemServicoId}#${comando.rodada}#${tipoTarefa}`,
    };
  }

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
    return itens.sort((a, b) =>
      String(
        (a.envelope as { occurredAt?: string }).occurredAt ?? '',
      ).localeCompare(String((b.envelope as { occurredAt?: string }).occurredAt ?? '')),
    );
  }

  function payloadsRespostaCancelamento(
    eventos: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return eventos.map(
      (e) => (e.envelope as { payload: Record<string, unknown> }).payload,
    );
  }

  beforeAll(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-cancelamento');
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
    iniciarDiagnostico = obter(IniciarTarefaDiagnosticoUseCase);
    iniciarReparo = obter(IniciarTarefaReparoUseCase);
    concluirReparo = obter(ConcluirTarefaReparoUseCase);
    falharReparo = obter(FalharTarefaReparoUseCase);
    interromperReparo = obter(InterromperTarefaReparoUseCase);
  });

  afterAll(async () => {
    await modulo.close();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  describe('cancelamento antes da criação (marcador D4.4)', () => {
    it('grava MARCADOR_BLOQUEIO e impede iniciar-diagnostico', async () => {
      const ordemServicoId = randomUUID();
      const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;

      const { comando } = await consumirCancelamento(
        { ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );

      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
        cancelamentoEventId: comando.eventId,
      });

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          ordemServicoId,
        ),
      );
      expect(payloads).toContainEqual(
        expect.objectContaining({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
        }),
      );

      await consumirDiagnostico({ ordemServicoId });
      expect(await lerTarefa(tarefaId)).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
      });
    });

    it('grava MARCADOR_BLOQUEIO e impede iniciar-reparo', async () => {
      const ordemServicoId = randomUUID();
      const tarefaId = `${ordemServicoId}#1#REPARO`;

      await consumirCancelamento({ ordemServicoId }, TipoTarefa.REPARO);

      expect(await lerTarefa(tarefaId)).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
        tipoTarefa: TipoTarefa.REPARO,
      });

      await consumirReparo({ ordemServicoId });
      expect(await lerTarefa(tarefaId)).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
      });
    });

    it('cancelamento duplicado no marcador devolve CANCELADA_SEM_EXISTIR sem novo marcador', async () => {
      const ordemServicoId = randomUUID();
      const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;

      await consumirCancelamento({ ordemServicoId }, TipoTarefa.DIAGNOSTICO);
      await consumirCancelamento({ ordemServicoId }, TipoTarefa.DIAGNOSTICO);

      expect(await lerTarefa(tarefaId)).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
      });

      const respostas = await procurarEventosOutbox(
        EVENTO_RESPOSTA_CANCELAMENTO,
        ordemServicoId,
      );
      expect(respostas).toHaveLength(2);
      const resultados = payloadsRespostaCancelamento(respostas).map(
        (p) => p.resultado,
      );
      expect(resultados).toEqual([
        ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
        ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
      ]);
    });

    it('marcador da rodada 1 não bloqueia criação na rodada 2', async () => {
      const ordemServicoId = randomUUID();

      await consumirCancelamento(
        { ordemServicoId, rodada: 1 },
        TipoTarefa.DIAGNOSTICO,
      );

      expect(await lerTarefa(`${ordemServicoId}#1#DIAGNOSTICO`)).toMatchObject({
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
      });

      await consumirDiagnostico({ ordemServicoId, rodada: 2 });

      expect(await lerTarefa(`${ordemServicoId}#2#DIAGNOSTICO`)).toMatchObject({
        tipo: TipoTarefa.DIAGNOSTICO,
        situacao: 'PENDENTE',
      });
    });
  });

  describe('diagnóstico cancelado', () => {
    it('tarefa PENDENTE responde CANCELADA_SEM_INICIO', async () => {
      const { comando, tarefaId } = await consumirDiagnostico();

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CANCELADA',
      });

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.CANCELADA_SEM_INICIO,
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
      });
    });

    it('tarefa EM_ANDAMENTO responde CANCELADA_EM_ANDAMENTO', async () => {
      const { comando, tarefaId } = await consumirDiagnostico();
      await iniciarDiagnostico.execute(tarefaId, 'mec-1');

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CANCELADA',
      });

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
      });
    });
  });

  describe('reparo em cancelamento / interrupção', () => {
    const corpoExecucao = {
      servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
      pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 1 }],
      responsavelOperacaoId: 'mec-1',
    };

    it('reparo EM_ANDAMENTO responde INTERRUPCAO_SOLICITADA e recusa concluir/falhar', async () => {
      const { comando, tarefaId } = await consumirReparo();
      await iniciarReparo.execute(tarefaId, 'mec-1');

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'INTERRUPCAO_SOLICITADA',
      });

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
        tipoTarefa: TipoTarefa.REPARO,
      });

      await expect(
        concluirReparo.execute(tarefaId, corpoExecucao),
      ).rejects.toBeInstanceOf(TarefaInterrupcaoSolicitadaError);
      await expect(
        falharReparo.execute(tarefaId, {
          motivo: 'X',
          ...corpoExecucao,
        }),
      ).rejects.toBeInstanceOf(TarefaInterrupcaoSolicitadaError);
    });

    it('interrupção com consumo zero publica divergência CONSUMO_ZERO e alinha fatoTerminalEventId', async () => {
      const { comando, tarefaId } = await consumirReparo();
      await iniciarReparo.execute(tarefaId, 'mec-1');
      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );

      await interromperReparo.execute(tarefaId, {
        servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
        pecasUtilizadas: [],
        responsavelOperacaoId: 'mec-1',
      });

      const item = await lerTarefa(tarefaId);
      expect(item?.situacao).toBe('INTERROMPIDA');
      expect(item?.divergencias).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tipo: TipoDivergenciaPeca.CONSUMO_ZERO,
            itemId: PECA_OFICIAL,
          }),
        ]),
      );

      const interrompidos = await procurarEventosOutbox(
        EVENTO_REPARO_INTERROMPIDO,
        comando.ordemServicoId,
      );
      expect(interrompidos).toHaveLength(1);
      const eventIdFato = interrompidos[0].eventId as string;
      expect(item?.fatoTerminalEventId).toBe(eventIdFato);
      expect(
        (interrompidos[0].envelope as { payload: { divergencias: unknown[] } })
          .payload.divergencias,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tipo: TipoDivergenciaPeca.CONSUMO_ZERO }),
        ]),
      );
    });
  });

  describe('JA_CONCLUIDA e JA_ENCERRADA', () => {
    const corpoExecucao = {
      servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
      pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 2 }],
      responsavelOperacaoId: 'mec-1',
    };

    it('JA_CONCLUIDA em reparo inclui peças, divergências e fatoTerminalEventId', async () => {
      const { comando, tarefaId } = await consumirReparo();
      await iniciarReparo.execute(tarefaId, 'mec-1');
      await concluirReparo.execute(tarefaId, corpoExecucao);

      const item = await lerTarefa(tarefaId);
      expect(item?.fatoTerminalEventId).toBeDefined();

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.JA_CONCLUIDA,
        situacaoTarefa: 'CONCLUIDA',
        fatoTerminalEventId: item?.fatoTerminalEventId,
        divergencias: expect.any(Array),
        pecasUtilizadas: expect.any(Array),
        servicosRealizados: expect.any(Array),
        responsavelId: 'mec-1',
      });
    });

    it('JA_ENCERRADA para tarefa já CANCELADA', async () => {
      const { comando, tarefaId } = await consumirDiagnostico();
      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CANCELADA',
      });

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads).toHaveLength(2);
      expect(payloads[1]).toMatchObject({
        resultado: ResultadoCancelamento.JA_ENCERRADA,
        situacaoTarefa: 'CANCELADA',
      });
    });

    it('JA_ENCERRADA para reparo FALHOU', async () => {
      const { comando, tarefaId } = await consumirReparo();
      await iniciarReparo.execute(tarefaId, 'mec-1');
      await falharReparo.execute(tarefaId, {
        motivo: 'Peça incompatível',
        ...corpoExecucao,
      });

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );

      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.JA_ENCERRADA,
        situacaoTarefa: 'FALHOU',
        motivo: 'Peça incompatível',
        fatoTerminalEventId: (await lerTarefa(tarefaId))?.fatoTerminalEventId,
      });
    });

    it('JA_ENCERRADA para reparo INTERROMPIDA', async () => {
      const { comando, tarefaId } = await consumirReparo();
      await iniciarReparo.execute(tarefaId, 'mec-1');
      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );
      await interromperReparo.execute(tarefaId, {
        servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
        pecasUtilizadas: [],
        responsavelOperacaoId: 'mec-1',
      });

      await consumirCancelamento(
        { ordemServicoId: comando.ordemServicoId },
        TipoTarefa.REPARO,
      );

      const item = await lerTarefa(tarefaId);
      const payloads = payloadsRespostaCancelamento(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          comando.ordemServicoId,
        ),
      );
      expect(payloads.at(-1)).toMatchObject({
        resultado: ResultadoCancelamento.JA_ENCERRADA,
        situacaoTarefa: 'INTERROMPIDA',
        fatoTerminalEventId: item?.fatoTerminalEventId,
      });
    });
  });

  describe('idempotência e concorrência', () => {
    it('reentrega do mesmo eventId não duplica resposta na outbox', async () => {
      const ordemServicoId = randomUUID();
      const comando = criarComandoCancelarTarefa(
        { ordemServicoId },
        TipoTarefa.DIAGNOSTICO,
      );

      await processarComando.executar(JSON.stringify(comando));
      await processarComando.executar(JSON.stringify(comando));

      expect(
        await procurarEventosOutbox(
          EVENTO_RESPOSTA_CANCELAMENTO,
          ordemServicoId,
        ),
      ).toHaveLength(1);
      expect(
        await lerItem(tabelas.mensagensProcessadas, {
          eventId: comando.eventId,
        }),
      ).toBeDefined();
    });

    it('corrida entre cancelamento prévio e iniciar-diagnostico com barreira', async () => {
      const ordemServicoId = randomUUID();
      const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;

      let liberarIniciar: () => void = () => undefined;
      const barrier = new Promise<void>((resolve) => {
        liberarIniciar = resolve;
      });

      const cancelar = (async () => {
        liberarIniciar();
        await processarComando.executar(
          JSON.stringify(
            criarComandoCancelarTarefa(
              { ordemServicoId },
              TipoTarefa.DIAGNOSTICO,
            ),
          ),
        );
      })();

      const iniciar = (async () => {
        await barrier;
        await processarComando.executar(
          JSON.stringify(criarComandoIniciarDiagnostico({ ordemServicoId })),
        );
      })();

      await Promise.all([cancelar, iniciar]);

      const item = await lerTarefa(tarefaId);
      const respostas = await procurarEventosOutbox(
        EVENTO_RESPOSTA_CANCELAMENTO,
        ordemServicoId,
      );
      expect(respostas.length).toBeGreaterThanOrEqual(1);

      if (item?.tipo === TIPO_REGISTRO_MARCADOR_BLOQUEIO) {
        expect(item.tipo).toBe(TIPO_REGISTRO_MARCADOR_BLOQUEIO);
        expect(
          payloadsRespostaCancelamento(respostas).some(
            (p) => p.resultado === ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
          ),
        ).toBe(true);
      } else {
        expect(item).toMatchObject({
          tipo: TipoTarefa.DIAGNOSTICO,
          situacao: 'CANCELADA',
        });
        expect(
          payloadsRespostaCancelamento(respostas).some(
            (p) => p.resultado === ResultadoCancelamento.CANCELADA_SEM_INICIO,
          ),
        ).toBe(true);
      }
    });
  });
});
