import { randomUUID } from 'node:crypto';
import {
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TarefaGateway } from '@/modules/tarefas/application/ports/tarefa.gateway';
import { TAREFA_GATEWAY } from '@/modules/tarefas/application/ports/tokens';
import { BuscarTarefaUseCase } from '@/modules/tarefas/application/use-cases/buscar-tarefa.use-case';
import { ConcluirTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-diagnostico.use-case';
import { DevolverTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/devolver-tarefa-diagnostico.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { ListarTarefasUseCase } from '@/modules/tarefas/application/use-cases/listar-tarefas.use-case';
import type { Tarefa } from '@/modules/tarefas/domain/entities/tarefa.entity';
import {
  ConclusaoIndeterminadaError,
  ConclusaoRecusadaPeloOsConflitoError,
  ConclusaoRecusadaPeloOsError,
  DevolucaoForaDaRodadaInicialError,
  TarefaSituacaoInvalidaError,
} from '@/modules/tarefas/domain/errors/tarefa.errors';
import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@/shared/database/unit-of-work.port';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import { criarComandoIniciarDiagnostico } from './helpers/envelope-teste';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';
import { OsHttpDouble } from './helpers/os-http-double';

describe('Tarefas de diagnóstico (integração com DynamoDB Local e dublê HTTP do OS)', () => {
  const client: DynamoDBClient = criarClienteDynamodbTeste();
  const os = new OsHttpDouble();
  let tabelas: NomesTabelasDynamodb;
  let modulo: TestingModule;
  let processarComando: ProcessarMensagemEntradaService;
  let listar: ListarTarefasUseCase;
  let buscar: BuscarTarefaUseCase;
  let iniciar: IniciarTarefaDiagnosticoUseCase;
  let devolver: DevolverTarefaDiagnosticoUseCase;
  let concluir: ConcluirTarefaDiagnosticoUseCase;

  const conclusao = {
    laudo: 'Pastilhas desgastadas',
    itens: [{ tipo: 'PECA' as const, itemId: 'peca-1', quantidade: 2 }],
  };

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
    patch: Parameters<typeof criarComandoIniciarDiagnostico>[0] = {},
  ) {
    const comando = criarComandoIniciarDiagnostico(patch);
    await processarComando.executar(JSON.stringify(comando));
    return {
      comando,
      tarefaId: `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`,
    };
  }

  async function criarTarefaEmAndamento(rodada = 1, responsavel = 'mec-1') {
    const { tarefaId } = await consumirComando({ rodada });
    await iniciar.execute(tarefaId, responsavel);
    return tarefaId;
  }

  beforeAll(async () => {
    const osUrl = await os.iniciar();
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-tarefas');
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
              OS_REQUEST_TIMEOUT_MS: '400',
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
    buscar = obter(BuscarTarefaUseCase);
    iniciar = obter(IniciarTarefaDiagnosticoUseCase);
    devolver = obter(DevolverTarefaDiagnosticoUseCase);
    concluir = obter(ConcluirTarefaDiagnosticoUseCase);
  });

  afterAll(async () => {
    await modulo.close();
    await os.parar();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  beforeEach(() => os.reiniciar());

  describe('consumo de execution.iniciar-diagnostico.v1', () => {
    it('cria a tarefa pendente com chave osId#rodada#DIAGNOSTICO e registra a mensagem processada', async () => {
      const { comando, tarefaId } = await consumirComando();

      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        pk: tarefaId,
        tipo: 'DIAGNOSTICO',
        situacao: 'PENDENTE',
        ordemServicoId: comando.ordemServicoId,
        rodada: 1,
        correlationId: comando.correlationId,
        indiceFila: 'DIAGNOSTICO#PENDENTE',
        versao: 1,
      });
      expect(
        await lerItem(tabelas.mensagensProcessadas, {
          eventId: comando.eventId,
        }),
      ).toBeDefined();
    });

    it('reentrega do mesmo eventId e novo eventId para a mesma chave não alteram a tarefa', async () => {
      const { comando, tarefaId } = await consumirComando();
      await iniciar.execute(tarefaId, 'mec-1');

      await processarComando.executar(JSON.stringify(comando));
      await consumirComando({
        ordemServicoId: comando.ordemServicoId,
        rodada: 1,
      });

      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        responsavelId: 'mec-1',
      });
    });

    it('cria uma tarefa por rodada', async () => {
      const ordemServicoId = randomUUID();
      await consumirComando({ ordemServicoId, rodada: 1 });
      await consumirComando({ ordemServicoId, rodada: 2 });

      expect(await lerTarefa(`${ordemServicoId}#1#DIAGNOSTICO`)).toBeDefined();
      expect(await lerTarefa(`${ordemServicoId}#2#DIAGNOSTICO`)).toBeDefined();
    });

    it('não cria tarefa quando já existe marcador de bloqueio na chave (D4.4)', async () => {
      const ordemServicoId = randomUUID();
      const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;
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

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'BLOQUEADA',
      });
      await expect(buscar.execute(tarefaId)).rejects.toThrow('não encontrada');
    });

    it('processa uma única criação com duas entregas concorrentes de eventIds diferentes', async () => {
      const ordemServicoId = randomUUID();

      await Promise.all([
        consumirComando({ ordemServicoId }),
        consumirComando({ ordemServicoId }),
      ]);

      expect(await lerTarefa(`${ordemServicoId}#1#DIAGNOSTICO`)).toMatchObject({
        situacao: 'PENDENTE',
        versao: 1,
      });
    });
  });

  describe('fila e início', () => {
    it('lista a fila pelo índice em ordem de chegada, com paginação por cursor', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push((await consumirComando()).tarefaId);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const todas = await listar.execute({ limite: 100 });
      const idsFila = todas.itens.map((t) => t.id);
      expect(idsFila.filter((id) => ids.includes(id))).toEqual(ids);

      const paginaUm = await listar.execute({ limite: 1 });
      expect(paginaUm.itens).toHaveLength(1);
      expect(paginaUm.proximoCursor).not.toBeNull();
      const paginaDois = await listar.execute({
        limite: 1,
        cursor: paginaUm.proximoCursor ?? undefined,
      });
      expect(paginaDois.itens[0].id).not.toBe(paginaUm.itens[0].id);
    });

    it('inicia com escrita condicional, grava o responsável e publica DiagnosticoIniciado na outbox', async () => {
      const { comando, tarefaId } = await consumirComando();

      const saida = await iniciar.execute(tarefaId, 'mec-1');

      expect(saida).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        responsavelId: 'mec-1',
      });
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({ situacao: 'EM_ANDAMENTO', versao: 2 });
      expect(item?.indiceFila).toBeUndefined();

      const fila = await listar.execute({ limite: 100 });
      expect(fila.itens.map((t) => t.id)).not.toContain(tarefaId);

      const outboxItens = await procurarEventosOutbox(
        'execution.diagnostico-iniciado.v1',
        comando.ordemServicoId,
      );
      expect(outboxItens).toHaveLength(1);
      expect(outboxItens[0]).toMatchObject({
        destino: 'os-in',
        situacao: 'PENDENTE',
        correlationId: comando.correlationId,
      });
      expect(
        (outboxItens[0].envelope as { payload: unknown }).payload,
      ).toMatchObject({ tarefaId });
    });

    it('com dois mecânicos concorrentes, só um inicia e só um evento é publicado', async () => {
      const { comando, tarefaId } = await consumirComando();

      const resultados = await Promise.allSettled([
        iniciar.execute(tarefaId, 'mec-1'),
        iniciar.execute(tarefaId, 'mec-2'),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        1,
      );
      const rejeitado = resultados.find((r) => r.status === 'rejected');
      expect((rejeitado as PromiseRejectedResult).reason).toBeInstanceOf(
        TarefaSituacaoInvalidaError,
      );
      expect(
        await procurarEventosOutbox(
          'execution.diagnostico-iniciado.v1',
          comando.ordemServicoId,
        ),
      ).toHaveLength(1);
    });

    it('repetir o início pelo mesmo mecânico não publica outro evento', async () => {
      const { comando, tarefaId } = await consumirComando();

      await iniciar.execute(tarefaId, 'mec-1');
      await iniciar.execute(tarefaId, 'mec-1');

      expect(
        await procurarEventosOutbox(
          'execution.diagnostico-iniciado.v1',
          comando.ordemServicoId,
        ),
      ).toHaveLength(1);
    });
  });

  describe('devolução à fila', () => {
    it('devolve na rodada 1 voltando à fila na posição original e publica TarefaDevolvidaAFila', async () => {
      const { comando, tarefaId } = await consumirComando();
      await iniciar.execute(tarefaId, 'mec-1');

      const saida = await devolver.execute(tarefaId);

      expect(saida).toMatchObject({
        situacao: 'PENDENTE',
        responsavelId: null,
      });
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: 'PENDENTE',
        indiceFila: 'DIAGNOSTICO#PENDENTE',
      });
      expect(item?.responsavelId).toBeUndefined();
      expect(
        await procurarEventosOutbox(
          'execution.tarefa-devolvida-a-fila.v1',
          comando.ordemServicoId,
        ),
      ).toHaveLength(1);
      const fila = await listar.execute({ limite: 100 });
      expect(fila.itens.map((t) => t.id)).toContain(tarefaId);
    });

    it('recusa devolução na rodada 2', async () => {
      const tarefaId = await criarTarefaEmAndamento(2);

      await expect(devolver.execute(tarefaId)).rejects.toBeInstanceOf(
        DevolucaoForaDaRodadaInicialError,
      );
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'EM_ANDAMENTO',
      });
    });

    it('recusa devolução depois que a conclusão foi iniciada e depois de concluída', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      os.enfileirarResposta({ status: 200, atrasoMs: 1000 });
      await concluir.execute(tarefaId, conclusao).catch(() => undefined);

      await expect(devolver.execute(tarefaId)).rejects.toBeInstanceOf(
        TarefaSituacaoInvalidaError,
      );

      await concluir.execute(tarefaId, conclusao);
      await expect(devolver.execute(tarefaId)).rejects.toBeInstanceOf(
        TarefaSituacaoInvalidaError,
      );
    });

    it('com devolução e início concorrentes mantém uma situação consistente', async () => {
      const { tarefaId } = await consumirComando();
      await iniciar.execute(tarefaId, 'mec-1');

      const resultados = await Promise.allSettled([
        devolver.execute(tarefaId),
        iniciar.execute(tarefaId, 'mec-2'),
      ]);

      const item = await lerTarefa(tarefaId);
      const sucessos = resultados.filter((r) => r.status === 'fulfilled');
      expect(sucessos.length).toBeGreaterThanOrEqual(1);
      expect(['PENDENTE', 'EM_ANDAMENTO']).toContain(item?.situacao);
      if (item?.situacao === 'EM_ANDAMENTO') {
        expect(item.responsavelId).toBe('mec-2');
      }
    });
  });

  describe('conclusão síncrona no OS', () => {
    it('grava CONCLUSAO_EM_ANDAMENTO com payload antes do HTTP e CONCLUIDA só após o 200', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      let situacaoDuranteHttp: unknown;
      let payloadDuranteHttp: unknown;
      os.enfileirarResposta({
        status: 200,
        atrasoMs: 200,
        corpo: {
          rodada: 1,
          itensOficiais: [
            { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
          ],
        },
      });
      const verificacao = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const item = await lerTarefa(tarefaId);
        situacaoDuranteHttp = item?.situacao;
        payloadDuranteHttp = item?.conclusaoPendente;
      })();

      const saida = await concluir.execute(tarefaId, conclusao);
      await verificacao;

      expect(situacaoDuranteHttp).toBe('CONCLUSAO_EM_ANDAMENTO');
      expect(payloadDuranteHttp).toEqual(conclusao);
      expect(saida.tarefa.situacao).toBe('CONCLUIDA');
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CONCLUIDA',
        laudo: conclusao.laudo,
        propostaItens: conclusao.itens,
      });
      expect((await lerTarefa(tarefaId))?.conclusaoPendente).toBeUndefined();
    });

    it('envia ao OS token, chave diagnostico:<tarefaId>, rastreio e corpo da conclusão', async () => {
      const tarefaId = await criarTarefaEmAndamento();

      await concluir.execute(tarefaId, conclusao);

      expect(os.requisicoes).toHaveLength(1);
      const [requisicao] = os.requisicoes;
      expect(requisicao.metodo).toBe('POST');
      expect(requisicao.caminho).toBe(
        `/internal/ordens-servico/${tarefaId.split('#')[0]}/diagnostico`,
      );
      expect(requisicao.headers).toMatchObject({
        authorization: 'Bearer execution-os-token',
        'idempotency-key': `diagnostico:${tarefaId}`,
      });
      expect(requisicao.headers['x-correlation-id']).toBeDefined();
      expect(requisicao.headers['x-request-id']).toBeDefined();
      expect(requisicao.corpo).toEqual({
        rodada: 1,
        tarefaId,
        laudo: conclusao.laudo,
        itens: conclusao.itens,
      });
    });

    it.each([
      [409, 'ESTADO_INCOMPATIVEL', ConclusaoRecusadaPeloOsConflitoError],
      [409, 'OS_EM_CANCELAMENTO', ConclusaoRecusadaPeloOsConflitoError],
      [422, 'ITEM_INVALIDO', ConclusaoRecusadaPeloOsError],
    ])(
      '%i %s do OS volta a EM_ANDAMENTO, descarta o payload e chega ao mecânico',
      async (status, codigo, tipoErro) => {
        const tarefaId = await criarTarefaEmAndamento();
        os.enfileirarResposta({
          status,
          corpo: { codigo, mensagem: 'recusado' },
        });

        await expect(
          concluir.execute(tarefaId, conclusao),
        ).rejects.toBeInstanceOf(tipoErro);

        const item = await lerTarefa(tarefaId);
        expect(item).toMatchObject({ situacao: 'EM_ANDAMENTO' });
        expect(item?.conclusaoPendente).toBeUndefined();
        expect(item?.concluidaEm).toBeUndefined();
        expect(item?.laudo).toBeUndefined();
      },
    );

    it('depois de uma recusa aceita conteúdo corrigido e conclui', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      os.enfileirarResposta({
        status: 422,
        corpo: { codigo: 'ITEM_INVALIDO', mensagem: 'x' },
      });
      await concluir.execute(tarefaId, conclusao).catch(() => undefined);

      const corrigida = { laudo: 'Laudo corrigido', itens: [] };
      await concluir.execute(tarefaId, corrigida);

      expect(os.requisicoes[1].corpo).toMatchObject({
        laudo: 'Laudo corrigido',
      });
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CONCLUIDA',
        laudo: 'Laudo corrigido',
      });
    });

    it('no timeout mantém CONCLUSAO_EM_ANDAMENTO com o payload e nunca grava CONCLUIDA sem 200', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      os.enfileirarResposta({ status: 200, atrasoMs: 1500 });

      await expect(
        concluir.execute(tarefaId, conclusao),
      ).rejects.toBeInstanceOf(ConclusaoIndeterminadaError);

      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: 'CONCLUSAO_EM_ANDAMENTO',
        conclusaoPendente: conclusao,
      });
      expect(item?.concluidaEm).toBeUndefined();
    });

    it('mantém a conclusão pendente também com 5xx do OS', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      os.enfileirarResposta({ status: 503, corpo: { codigo: 'INDISPONIVEL' } });

      await expect(
        concluir.execute(tarefaId, conclusao),
      ).rejects.toBeInstanceOf(ConclusaoIndeterminadaError);

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CONCLUSAO_EM_ANDAMENTO',
      });
    });

    it('nova tentativa após timeout reenvia o mesmo payload com a mesma chave e ignora conteúdo novo', async () => {
      const tarefaId = await criarTarefaEmAndamento();
      os.enfileirarResposta({ status: 200, atrasoMs: 1500 });
      await concluir.execute(tarefaId, conclusao).catch(() => undefined);

      await concluir.execute(tarefaId, { laudo: 'Conteúdo novo', itens: [] });

      expect(os.requisicoes).toHaveLength(2);
      expect(os.requisicoes[1].corpo).toEqual(os.requisicoes[0].corpo);
      expect(os.requisicoes[1].corpo.laudo).toBe(conclusao.laudo);
      expect(os.requisicoes[1].headers['idempotency-key']).toBe(
        `diagnostico:${tarefaId}`,
      );
      expect(os.requisicoes[0].headers['idempotency-key']).toBe(
        `diagnostico:${tarefaId}`,
      );
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CONCLUIDA',
        laudo: conclusao.laudo,
      });
    });

    it('recusa concluir tarefa pendente ou já concluída sem chamar o OS', async () => {
      const { tarefaId } = await consumirComando();
      await expect(
        concluir.execute(tarefaId, conclusao),
      ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);

      const emAndamento = await criarTarefaEmAndamento();
      await concluir.execute(emAndamento, conclusao);
      os.reiniciar();
      await expect(
        concluir.execute(emAndamento, conclusao),
      ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);
      expect(os.requisicoes).toHaveLength(0);
    });

    it('duas conclusões concorrentes terminam CONCLUIDA com a mesma chave idempotente', async () => {
      const tarefaId = await criarTarefaEmAndamento();

      const resultados = await Promise.allSettled([
        concluir.execute(tarefaId, conclusao),
        concluir.execute(tarefaId, conclusao),
      ]);

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'CONCLUIDA',
      });
      expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true);
      for (const requisicao of os.requisicoes) {
        expect(requisicao.headers['idempotency-key']).toBe(
          `diagnostico:${tarefaId}`,
        );
      }
      for (const resultado of resultados) {
        if (resultado.status === 'rejected') {
          expect(resultado.reason).toBeInstanceOf(TarefaSituacaoInvalidaError);
        }
      }
    });
  });

  describe('conflito de escrita condicional', () => {
    it('recusa a escrita feita sobre uma versão desatualizada e não altera a tarefa', async () => {
      const { tarefaId } = await consumirComando();
      const gateway = modulo.get<TarefaGateway>(TAREFA_GATEWAY, {
        strict: false,
      });
      const unitOfWork = modulo.get<UnitOfWork>(UNIT_OF_WORK, {
        strict: false,
      });
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

      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: 'EM_ANDAMENTO',
        responsavelId: 'mec-1',
        versao: 2,
      });
    });
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
        const envelope = registro.envelope as {
          ordemServicoId?: string;
        };
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
