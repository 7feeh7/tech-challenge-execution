import { type DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConcluirTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-diagnostico.use-case';
import { ConcluirTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/concluir-tarefa-reparo.use-case';
import { FalharTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/falhar-tarefa-reparo.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { IniciarTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/iniciar-tarefa-reparo.use-case';
import { InterromperTarefaReparoUseCase } from '@/modules/tarefas/application/use-cases/interromper-tarefa-reparo.use-case';
import {
  ConclusaoIndeterminadaError,
  ConclusaoRecusadaPeloOsConflitoError,
  ConclusaoRecusadaPeloOsError,
  TarefaInterrupcaoSolicitadaError,
  TarefaSituacaoInvalidaError,
} from '@/modules/tarefas/domain/errors/tarefa.errors';
import { TIPO_REGISTRO_MARCADOR_BLOQUEIO } from '@/modules/tarefas/domain/marcador-bloqueio';
import { ResultadoCancelamento } from '@/modules/tarefas/domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '@/modules/tarefas/domain/situacao-tarefa.enum';
import { TipoDivergenciaPeca } from '@/modules/tarefas/domain/tipo-divergencia-peca.enum';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { DynamoDbModule } from '@/shared/database/dynamodb.module';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { FILA_MENSAGENS } from '@/shared/messaging/application/ports/tokens';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import {
  type EnvelopeMensagem,
  EVENTO_DIAGNOSTICO_INICIADO,
  EVENTO_REPARO_CONCLUIDO,
  EVENTO_REPARO_FALHOU,
  EVENTO_REPARO_INICIADO,
  EVENTO_REPARO_INTERROMPIDO,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '@/shared/messaging/envelope';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import { ObservabilityModule } from '@/shared/observability/observability.module';
import { comRotulo } from './helpers/barreira-transacao-dynamodb';
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
import {
  type Fato,
  fatosDoTipo,
  lerFatosDaOrdem,
  tiposDosFatos,
} from './helpers/fatos-outbox';
import { FilaMensagensMemoriaGateway } from './helpers/fila-mensagens-memoria.gateway';
import {
  executarEmOrdem,
  instalarBarreiraOrdenada,
  type ResultadosPorRotulo,
} from './helpers/instalar-barreira-transacao';
import {
  criarRespostaOsBloqueada,
  OsHttpDouble,
} from './helpers/os-http-double';
import {
  exigirCumprida,
  exigirRecusadaCom,
} from './helpers/resultado-operacao';

const PECA_OFICIAL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const SERVICO_OFICIAL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const MOTIVO_CANCELAMENTO = 'Desistência do cliente';
const ITENS_OFICIAIS_OS = [
  { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
];
const RESPOSTA_OS_SUCESSO = {
  status: 200,
  corpo: { rodada: 1, itensOficiais: ITENS_OFICIAIS_OS },
};
const CONSUMO_COMPLETO = {
  servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
  pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 2 }],
  responsavelOperacaoId: 'mec-1',
};

type Registro = Record<string, unknown>;

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
  let interromperReparo: InterromperTarefaReparoUseCase;

  async function lerItem(
    tabela: string,
    chave: Record<string, string>,
  ): Promise<Registro | undefined> {
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

  const fatosDaOrdem = (ordemServicoId: string) =>
    lerFatosDaOrdem(client, tabelas.outbox, ordemServicoId);

  /** A única resposta de cancelamento que tem o comando como causa. */
  function respostaDoComando(fatos: Fato[], comando: EnvelopeMensagem): Fato {
    const respostas = fatosDoTipo(fatos, EVENTO_RESPOSTA_CANCELAMENTO).filter(
      (f) => f.causationId === comando.eventId,
    );
    expect(respostas).toHaveLength(1);
    return respostas[0] as Fato;
  }

  const SO_RESPOSTA = [EVENTO_RESPOSTA_CANCELAMENTO];

  function cancelamento(
    ordemServicoId: string,
    tipo: TipoTarefa,
    motivo = MOTIVO_CANCELAMENTO,
  ) {
    const comando = criarComandoCancelarTarefa(
      { ordemServicoId, payload: { tipoTarefa: tipo, motivo } },
      tipo,
    );
    return {
      comando,
      executar: () => processarComando.executar(JSON.stringify(comando)),
    };
  }

  async function prepararReparoEmAndamento() {
    const comando = criarComandoIniciarReparo();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#REPARO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarReparo.execute(tarefaId, 'mec-1');
    return { ordemServicoId: comando.ordemServicoId, tarefaId };
  }

  async function prepararDiagnosticoEmAndamento() {
    const comando = criarComandoIniciarDiagnostico();
    const tarefaId = `${comando.ordemServicoId}#${comando.rodada}#DIAGNOSTICO`;
    await processarComando.executar(JSON.stringify(comando));
    await iniciarDiagnostico.execute(tarefaId, 'mec-1');
    return { ordemServicoId: comando.ordemServicoId, tarefaId };
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
    interromperReparo = obter(InterromperTarefaReparoUseCase);
  });

  afterAll(async () => {
    await modulo.close();
    await os.parar();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
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

  describe('criação de tarefa × cancelamento (diagnóstico inexistente)', () => {
    async function correr(ordem: readonly [string, string]) {
      const comandoCriacao = criarComandoIniciarDiagnostico();
      const { ordemServicoId } = comandoCriacao;
      const tarefaId = `${ordemServicoId}#1#DIAGNOSTICO`;
      expect(await lerTarefa(tarefaId)).toBeUndefined();
      const cancelar = cancelamento(ordemServicoId, TipoTarefa.DIAGNOSTICO);

      const resultados = await executarEmOrdem(dynamo, ordem, {
        criacao: () =>
          processarComando.executar(JSON.stringify(comandoCriacao)),
        cancelamento: cancelar.executar,
      });
      return {
        resultados,
        comandoCriacao,
        cancelar,
        tarefaId,
        fatos: await fatosDaOrdem(ordemServicoId),
      };
    }

    it('criação grava primeiro: o cancelamento relê a tarefa pendente e a cancela sem início', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'criacao',
        'cancelamento',
      ]);

      exigirCumprida(resultados.criacao);
      exigirCumprida(resultados.cancelamento);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        tipo: TipoTarefa.DIAGNOSTICO,
        situacao: SituacaoTarefa.CANCELADA,
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 2,
      });
      expect(item?.cancelamentoEventId).toBeUndefined();
      expect(tiposDosFatos(fatos)).toEqual(SO_RESPOSTA);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
        resultado: ResultadoCancelamento.CANCELADA_SEM_INICIO,
      });
    });

    it('cancelamento grava primeiro: marcador permanente bloqueia a criação, que termina sem criar tarefa', async () => {
      const { resultados, comandoCriacao, cancelar, tarefaId, fatos } =
        await correr(['cancelamento', 'criacao']);

      exigirCumprida(resultados.cancelamento);
      exigirCumprida(resultados.criacao);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        pk: tarefaId,
        tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
        cancelamentoEventId: cancelar.comando.eventId,
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
        rodada: 1,
      });
      expect(item?.situacao).toBeUndefined();
      expect(
        await lerItem(tabelas.mensagensProcessadas, {
          eventId: comandoCriacao.eventId,
        }),
      ).toBeDefined();
      expect(tiposDosFatos(fatos)).toEqual(SO_RESPOSTA);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
        resultado: ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
      });
    });
  });

  describe('início de reparo × cancelamento (tarefa pendente)', () => {
    async function correr(ordem: readonly [string, string]) {
      const comando = criarComandoIniciarReparo();
      const { ordemServicoId } = comando;
      const tarefaId = `${ordemServicoId}#${comando.rodada}#REPARO`;
      await processarComando.executar(JSON.stringify(comando));
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.PENDENTE,
        versao: 1,
      });
      const cancelar = cancelamento(ordemServicoId, TipoTarefa.REPARO);

      const resultados = await executarEmOrdem(dynamo, ordem, {
        inicio: () => iniciarReparo.execute(tarefaId, 'mec-1'),
        cancelamento: cancelar.executar,
      });
      return {
        resultados,
        cancelar,
        tarefaId,
        fatos: await fatosDaOrdem(ordemServicoId),
      };
    }

    it('início grava primeiro: o cancelamento relê o reparo em andamento e solicita a interrupção', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'inicio',
        'cancelamento',
      ]);

      expect(
        exigirCumprida<{ situacao: string; responsavelId: string }>(
          resultados.inicio,
        ),
      ).toMatchObject({
        situacao: SituacaoTarefa.EM_ANDAMENTO,
        responsavelId: 'mec-1',
      });
      exigirCumprida(resultados.cancelamento);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.INTERRUPCAO_SOLICITADA,
        responsavelId: 'mec-1',
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 3,
      });
      expect(item?.fatoTerminalEventId).toBeUndefined();
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
    });

    it('cancelamento grava primeiro: o início relê a tarefa cancelada e é recusado', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'cancelamento',
        'inicio',
      ]);

      exigirCumprida(resultados.cancelamento);
      exigirRecusadaCom(resultados.inicio, TarefaSituacaoInvalidaError);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.CANCELADA,
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 2,
      });
      expect(item?.responsavelId).toBeUndefined();
      expect(item?.iniciadoEm).toBeUndefined();
      expect(item?.canceladaEm).toBeDefined();
      expect(tiposDosFatos(fatos)).toEqual(SO_RESPOSTA);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.CANCELADA_SEM_INICIO,
      });
    });
  });

  describe('conclusão de reparo × cancelamento (reparo em andamento)', () => {
    async function correr(ordem: readonly [string, string]) {
      const { ordemServicoId, tarefaId } = await prepararReparoEmAndamento();
      const cancelar = cancelamento(ordemServicoId, TipoTarefa.REPARO);
      const resultados = await executarEmOrdem(dynamo, ordem, {
        conclusao: () => concluirReparo.execute(tarefaId, CONSUMO_COMPLETO),
        cancelamento: cancelar.executar,
      });
      return {
        resultados,
        cancelar,
        tarefaId,
        fatos: await fatosDaOrdem(ordemServicoId),
      };
    }

    it('conclusão grava primeiro: o cancelamento responde JA_CONCLUIDA com o consumo e o fato original', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'conclusao',
        'cancelamento',
      ]);

      expect(
        exigirCumprida<{ situacao: string }>(resultados.conclusao).situacao,
      ).toBe(SituacaoTarefa.CONCLUIDA);
      exigirCumprida(resultados.cancelamento);
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_CONCLUIDO,
        EVENTO_REPARO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      const fato = fatosDoTipo(fatos, EVENTO_REPARO_CONCLUIDO)[0] as Fato;
      expect(fato.envelope.payload).toEqual({
        tarefaId,
        concluidoEm: expect.any(String),
        responsavelId: 'mec-1',
        servicosRealizados: CONSUMO_COMPLETO.servicosRealizados,
        pecasUtilizadas: CONSUMO_COMPLETO.pecasUtilizadas,
        divergencias: [],
      });
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.CONCLUIDA,
        responsavelOperacaoId: 'mec-1',
        fatoTerminalEventId: fato.eventId,
        versao: 3,
      });
      const resposta = respostaDoComando(fatos, cancelar.comando);
      expect(resposta.envelope.payload).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.JA_CONCLUIDA,
        situacaoTarefa: SituacaoTarefa.CONCLUIDA,
        concluidaEm: fato.envelope.payload.concluidoEm,
        encerradaEm: fato.envelope.payload.concluidoEm,
        responsavelId: 'mec-1',
        servicosRealizados: CONSUMO_COMPLETO.servicosRealizados,
        pecasUtilizadas: CONSUMO_COMPLETO.pecasUtilizadas,
        divergencias: [],
        fatoTerminalEventId: fato.eventId,
      });
      expect(resposta.envelope.eventId).not.toBe(fato.eventId);
    });

    it('cancelamento grava primeiro: solicita a interrupção e a conclusão é recusada', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'cancelamento',
        'conclusao',
      ]);

      exigirCumprida(resultados.cancelamento);
      exigirRecusadaCom(resultados.conclusao, TarefaInterrupcaoSolicitadaError);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.INTERRUPCAO_SOLICITADA,
        responsavelId: 'mec-1',
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 3,
      });
      expect(item?.fatoTerminalEventId).toBeUndefined();
      expect(item?.concluidaEm).toBeUndefined();
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
    });
  });

  describe('falha de reparo × cancelamento (reparo em andamento)', () => {
    const MOTIVO_FALHA = 'corrida-e24';

    async function correr(ordem: readonly [string, string]) {
      const { ordemServicoId, tarefaId } = await prepararReparoEmAndamento();
      const cancelar = cancelamento(ordemServicoId, TipoTarefa.REPARO);
      const resultados = await executarEmOrdem(dynamo, ordem, {
        falha: () =>
          falharReparo.execute(tarefaId, {
            motivo: MOTIVO_FALHA,
            ...CONSUMO_COMPLETO,
          }),
        cancelamento: cancelar.executar,
      });
      return {
        resultados,
        cancelar,
        tarefaId,
        fatos: await fatosDaOrdem(ordemServicoId),
      };
    }

    it('falha grava primeiro: o cancelamento responde JA_ENCERRADA com a falha, o consumo e o fato original', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'falha',
        'cancelamento',
      ]);

      expect(
        exigirCumprida<{ situacao: string }>(resultados.falha).situacao,
      ).toBe(SituacaoTarefa.FALHOU);
      exigirCumprida(resultados.cancelamento);
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_FALHOU,
        EVENTO_REPARO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      const fato = fatosDoTipo(fatos, EVENTO_REPARO_FALHOU)[0] as Fato;
      expect(fato.envelope.payload).toEqual({
        tarefaId,
        falhouEm: expect.any(String),
        motivo: MOTIVO_FALHA,
        responsavelId: 'mec-1',
        servicosRealizados: CONSUMO_COMPLETO.servicosRealizados,
        pecasUtilizadas: CONSUMO_COMPLETO.pecasUtilizadas,
        divergencias: [],
      });
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.FALHOU,
        motivoFalha: MOTIVO_FALHA,
        responsavelOperacaoId: 'mec-1',
        fatoTerminalEventId: fato.eventId,
        versao: 3,
      });
      const resposta = respostaDoComando(fatos, cancelar.comando);
      expect(resposta.envelope.payload).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.JA_ENCERRADA,
        situacaoTarefa: SituacaoTarefa.FALHOU,
        encerradaEm: fato.envelope.payload.falhouEm,
        responsavelId: 'mec-1',
        motivo: MOTIVO_FALHA,
        servicosRealizados: CONSUMO_COMPLETO.servicosRealizados,
        pecasUtilizadas: CONSUMO_COMPLETO.pecasUtilizadas,
        divergencias: [],
        fatoTerminalEventId: fato.eventId,
      });
      expect(resposta.envelope.eventId).not.toBe(fato.eventId);
    });

    it('cancelamento grava primeiro: solicita a interrupção e a falha é recusada', async () => {
      const { resultados, cancelar, tarefaId, fatos } = await correr([
        'cancelamento',
        'falha',
      ]);

      exigirCumprida(resultados.cancelamento);
      exigirRecusadaCom(resultados.falha, TarefaInterrupcaoSolicitadaError);
      const item = await lerTarefa(tarefaId);
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.INTERRUPCAO_SOLICITADA,
        responsavelId: 'mec-1',
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 3,
      });
      expect(item?.fatoTerminalEventId).toBeUndefined();
      expect(item?.falhouEm).toBeUndefined();
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      expect(
        respostaDoComando(fatos, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
    });
  });

  describe('interrupção do reparo × novo comando de cancelamento (interrupção já solicitada)', () => {
    const CONSUMO_INFERIOR = {
      servicosRealizados: [{ itemId: SERVICO_OFICIAL, quantidade: 1 }],
      pecasUtilizadas: [{ itemId: PECA_OFICIAL, quantidade: 1 }],
      responsavelOperacaoId: 'mec-1',
    };

    async function correr(ordem: readonly [string, string]) {
      const { ordemServicoId, tarefaId } = await prepararReparoEmAndamento();
      const primeiroCancelamento = cancelamento(
        ordemServicoId,
        TipoTarefa.REPARO,
      );
      await primeiroCancelamento.executar();
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.INTERRUPCAO_SOLICITADA,
        versao: 3,
      });
      const reentrega = cancelamento(
        ordemServicoId,
        TipoTarefa.REPARO,
        'Segundo comando de cancelamento',
      );

      const resultados = await executarEmOrdem(dynamo, ordem, {
        interrupcao: () =>
          interromperReparo.execute(tarefaId, CONSUMO_INFERIOR),
        cancelamento: reentrega.executar,
      });
      return {
        resultados,
        primeiroCancelamento,
        reentrega,
        tarefaId,
        fatos: await fatosDaOrdem(ordemServicoId),
      };
    }

    function exigirFatoInterrompido(fatos: Fato[], tarefaId: string): Fato {
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_REPARO_INICIADO,
        EVENTO_REPARO_INTERROMPIDO,
        EVENTO_RESPOSTA_CANCELAMENTO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      const fato = fatosDoTipo(fatos, EVENTO_REPARO_INTERROMPIDO)[0] as Fato;
      expect(fato.envelope.payload).toEqual({
        tarefaId,
        interrompidoEm: expect.any(String),
        responsavelId: 'mec-1',
        servicosRealizados: CONSUMO_INFERIOR.servicosRealizados,
        pecasUtilizadas: CONSUMO_INFERIOR.pecasUtilizadas,
        divergencias: [
          expect.objectContaining({
            itemId: PECA_OFICIAL,
            tipo: TipoDivergenciaPeca.CONSUMO_INFERIOR,
            quantidadePrevista: 2,
            quantidadeUtilizada: 1,
          }),
        ],
      });
      return fato;
    }

    it('interrupção grava primeiro: o novo cancelamento responde JA_ENCERRADA com a interrupção original', async () => {
      const { resultados, primeiroCancelamento, reentrega, tarefaId, fatos } =
        await correr(['interrupcao', 'cancelamento']);

      expect(
        exigirCumprida<{ situacao: string }>(resultados.interrupcao).situacao,
      ).toBe(SituacaoTarefa.INTERROMPIDA);
      exigirCumprida(resultados.cancelamento);
      const fato = exigirFatoInterrompido(fatos, tarefaId);
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.INTERROMPIDA,
        responsavelOperacaoId: 'mec-1',
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        fatoTerminalEventId: fato.eventId,
        versao: 4,
      });
      expect(
        respostaDoComando(fatos, primeiroCancelamento.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
      const resposta = respostaDoComando(fatos, reentrega.comando);
      expect(resposta.envelope.payload).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.JA_ENCERRADA,
        situacaoTarefa: SituacaoTarefa.INTERROMPIDA,
        encerradaEm: fato.envelope.payload.interrompidoEm,
        responsavelId: 'mec-1',
        motivo: MOTIVO_CANCELAMENTO,
        servicosRealizados: CONSUMO_INFERIOR.servicosRealizados,
        pecasUtilizadas: CONSUMO_INFERIOR.pecasUtilizadas,
        divergencias: fato.envelope.payload.divergencias,
        fatoTerminalEventId: fato.eventId,
      });
      expect(resposta.envelope.eventId).not.toBe(fato.eventId);
    });

    it('novo cancelamento grava primeiro: repete INTERRUPCAO_SOLICITADA e a interrupção seguinte conclui com um único fato', async () => {
      const { resultados, primeiroCancelamento, reentrega, tarefaId, fatos } =
        await correr(['cancelamento', 'interrupcao']);

      exigirCumprida(resultados.cancelamento);
      expect(
        exigirCumprida<{ situacao: string }>(resultados.interrupcao).situacao,
      ).toBe(SituacaoTarefa.INTERROMPIDA);
      const fato = exigirFatoInterrompido(fatos, tarefaId);
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.INTERROMPIDA,
        responsavelOperacaoId: 'mec-1',
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        fatoTerminalEventId: fato.eventId,
        versao: 5,
      });
      expect(
        respostaDoComando(fatos, primeiroCancelamento.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
      expect(
        respostaDoComando(fatos, reentrega.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.REPARO,
        resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
      });
    });
  });

  describe('conclusão de diagnóstico × cancelamento', () => {
    describe('gravação do payload pendente × cancelamento', () => {
      async function correr(ordem: readonly [string, string]) {
        const { ordemServicoId, tarefaId } =
          await prepararDiagnosticoEmAndamento();
        // O OS só responde depois do cancelamento: a aplicação do resultado lê o estado já cancelado.
        const respostaOs = criarRespostaOsBloqueada(RESPOSTA_OS_SUCESSO);
        respostaOs.enfileirar(os);
        const cancelar = cancelamento(ordemServicoId, TipoTarefa.DIAGNOSTICO);
        const resultados = await executarEmOrdem(dynamo, ordem, {
          conclusao: () =>
            concluirDiagnostico.execute(tarefaId, {
              laudo: 'Corrida',
              itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
            }),
          cancelamento: async () => {
            try {
              await cancelar.executar();
            } finally {
              respostaOs.liberar();
            }
          },
        });
        return {
          resultados,
          cancelar,
          tarefaId,
          fatos: await fatosDaOrdem(ordemServicoId),
        };
      }

      function exigirCancelada(item: Registro | undefined) {
        expect(item).toMatchObject({
          situacao: SituacaoTarefa.CANCELADA,
          motivoCancelamento: MOTIVO_CANCELAMENTO,
        });
        expect(item?.conclusaoPendente).toBeUndefined();
        expect(item?.laudo).toBeUndefined();
        expect(item?.concluidaEm).toBeUndefined();
      }

      it('conclusão grava o payload primeiro: o cancelamento o descarta e a aplicação do resultado do OS é recusada', async () => {
        const { resultados, cancelar, tarefaId, fatos } = await correr([
          'conclusao',
          'cancelamento',
        ]);

        exigirCumprida(resultados.cancelamento);
        exigirRecusadaCom(resultados.conclusao, TarefaSituacaoInvalidaError);
        expect(os.requisicoes).toHaveLength(1);
        const item = await lerTarefa(tarefaId);
        exigirCancelada(item);
        expect(item?.versao).toBe(4);
        expect(tiposDosFatos(fatos)).toEqual([
          EVENTO_DIAGNOSTICO_INICIADO,
          EVENTO_RESPOSTA_CANCELAMENTO,
        ]);
        expect(
          respostaDoComando(fatos, cancelar.comando).envelope.payload,
        ).toEqual({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
        });
      });

      it('cancelamento grava primeiro: a conclusão relê a tarefa cancelada, é recusada e o OS não é chamado', async () => {
        const { resultados, cancelar, tarefaId, fatos } = await correr([
          'cancelamento',
          'conclusao',
        ]);

        exigirCumprida(resultados.cancelamento);
        exigirRecusadaCom(resultados.conclusao, TarefaSituacaoInvalidaError);
        expect(os.requisicoes).toHaveLength(0);
        const item = await lerTarefa(tarefaId);
        exigirCancelada(item);
        expect(item?.versao).toBe(3);
        expect(tiposDosFatos(fatos)).toEqual([
          EVENTO_DIAGNOSTICO_INICIADO,
          EVENTO_RESPOSTA_CANCELAMENTO,
        ]);
        expect(
          respostaDoComando(fatos, cancelar.comando).envelope.payload,
        ).toEqual({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
        });
      });
    });

    describe('aplicação do resultado do OS × cancelamento (CONCLUSAO_EM_ANDAMENTO)', () => {
      async function correr(ordem: readonly [string, string]) {
        const { ordemServicoId, tarefaId } =
          await prepararDiagnosticoEmAndamento();
        const respostaOs = criarRespostaOsBloqueada(RESPOSTA_OS_SUCESSO);
        respostaOs.enfileirar(os);
        const conclusao = comRotulo('conclusao', () =>
          concluirDiagnostico.execute(tarefaId, {
            laudo: 'Corrida',
            itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
          }),
        );
        conclusao.catch(() => undefined);
        await aguardarSituacao(tarefaId, SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);

        const cancelar = cancelamento(ordemServicoId, TipoTarefa.DIAGNOSTICO);
        const { barreira, restaurar } = instalarBarreiraOrdenada(dynamo, ordem);
        let resultados: ResultadosPorRotulo;
        try {
          const cancelamentoEmCurso = comRotulo(
            'cancelamento',
            cancelar.executar,
          );
          cancelamentoEmCurso.catch(() => undefined);
          const conducao = barreira.conduzir([conclusao, cancelamentoEmCurso]);
          respostaOs.liberar();
          const [resultadoConclusao, resultadoCancelamento] =
            await Promise.allSettled([conclusao, cancelamentoEmCurso]);
          await conducao;
          resultados = {
            conclusao: resultadoConclusao,
            cancelamento: resultadoCancelamento,
          };
        } finally {
          restaurar();
        }
        return {
          resultados,
          cancelar,
          tarefaId,
          fatos: await fatosDaOrdem(ordemServicoId),
        };
      }

      it('conclusão vence: o cancelamento relê a tarefa concluída e responde JA_CONCLUIDA só com o tipo e os horários', async () => {
        const { resultados, cancelar, tarefaId, fatos } = await correr([
          'conclusao',
          'cancelamento',
        ]);

        const saida = exigirCumprida<{
          tarefa: { situacao: string; concluidaEm: string };
          itensOficiais: unknown[];
        }>(resultados.conclusao);
        expect(saida.tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
        expect(saida.itensOficiais).toEqual(ITENS_OFICIAIS_OS);
        exigirCumprida(resultados.cancelamento);
        expect(os.requisicoes).toHaveLength(1);
        const item = await lerTarefa(tarefaId);
        expect(item).toMatchObject({
          situacao: SituacaoTarefa.CONCLUIDA,
          laudo: 'Corrida',
          versao: 4,
        });
        expect(item?.motivoCancelamento).toBeUndefined();
        expect(item?.canceladaEm).toBeUndefined();
        expect(item?.fatoTerminalEventId).toBeUndefined();
        expect(tiposDosFatos(fatos)).toEqual([
          EVENTO_DIAGNOSTICO_INICIADO,
          EVENTO_RESPOSTA_CANCELAMENTO,
        ]);
        expect(
          respostaDoComando(fatos, cancelar.comando).envelope.payload,
        ).toEqual({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.JA_CONCLUIDA,
          situacaoTarefa: SituacaoTarefa.CONCLUIDA,
          concluidaEm: saida.tarefa.concluidaEm,
          encerradaEm: saida.tarefa.concluidaEm,
        });
      });

      it('cancelamento vence: a aplicação do resultado do OS é recusada e a tarefa fica cancelada', async () => {
        const { resultados, cancelar, tarefaId, fatos } = await correr([
          'cancelamento',
          'conclusao',
        ]);

        exigirCumprida(resultados.cancelamento);
        exigirRecusadaCom(resultados.conclusao, TarefaSituacaoInvalidaError);
        expect(os.requisicoes).toHaveLength(1);
        const item = await lerTarefa(tarefaId);
        expect(item).toMatchObject({
          situacao: SituacaoTarefa.CANCELADA,
          motivoCancelamento: MOTIVO_CANCELAMENTO,
          versao: 4,
        });
        expect(item?.conclusaoPendente).toBeUndefined();
        expect(item?.laudo).toBeUndefined();
        expect(item?.concluidaEm).toBeUndefined();
        expect(tiposDosFatos(fatos)).toEqual([
          EVENTO_DIAGNOSTICO_INICIADO,
          EVENTO_RESPOSTA_CANCELAMENTO,
        ]);
        expect(
          respostaDoComando(fatos, cancelar.comando).envelope.payload,
        ).toEqual({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
        });
      });
    });
  });

  describe('cancelamento com a conclusão do diagnóstico aguardando o OS', () => {
    async function iniciarConclusaoBloqueada(resposta: {
      status: number;
      corpo?: unknown;
    }) {
      const { ordemServicoId, tarefaId } =
        await prepararDiagnosticoEmAndamento();
      const respostaOs = criarRespostaOsBloqueada(resposta);
      respostaOs.enfileirar(os);
      const conclusao = concluirDiagnostico.execute(tarefaId, {
        laudo: 'Tardio',
        itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
      });
      conclusao.catch(() => undefined);
      await aguardarSituacao(tarefaId, SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);
      return { ordemServicoId, tarefaId, respostaOs, conclusao };
    }

    function exigirCanceladaSemConclusao(item: Registro | undefined) {
      expect(item).toMatchObject({
        situacao: SituacaoTarefa.CANCELADA,
        motivoCancelamento: MOTIVO_CANCELAMENTO,
        versao: 4,
      });
      expect(item?.conclusaoPendente).toBeUndefined();
      expect(item?.laudo).toBeUndefined();
      expect(item?.concluidaEm).toBeUndefined();
    }

    it('cancelamento durante CONCLUSAO_EM_ANDAMENTO com OS bloqueado: cancela sem nova chamada ao OS', async () => {
      const { ordemServicoId, tarefaId, respostaOs, conclusao } =
        await iniciarConclusaoBloqueada(RESPOSTA_OS_SUCESSO);
      expect(await lerTarefa(tarefaId)).toMatchObject({
        situacao: SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO,
        conclusaoPendente: expect.objectContaining({ laudo: 'Tardio' }),
        versao: 3,
      });

      const cancelar = cancelamento(ordemServicoId, TipoTarefa.DIAGNOSTICO);
      await cancelar.executar();

      exigirCanceladaSemConclusao(await lerTarefa(tarefaId));
      expect(os.requisicoes).toHaveLength(1);
      const antes = await fatosDaOrdem(ordemServicoId);
      expect(
        respostaDoComando(antes, cancelar.comando).envelope.payload,
      ).toEqual({
        tipoTarefa: TipoTarefa.DIAGNOSTICO,
        resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
      });

      respostaOs.liberar();
      const resultado = await Promise.allSettled([conclusao]);
      exigirRecusadaCom(resultado[0], TarefaSituacaoInvalidaError);

      exigirCanceladaSemConclusao(await lerTarefa(tarefaId));
      const fatos = await fatosDaOrdem(ordemServicoId);
      expect(tiposDosFatos(fatos)).toEqual([
        EVENTO_DIAGNOSTICO_INICIADO,
        EVENTO_RESPOSTA_CANCELAMENTO,
      ]);
      expect(os.requisicoes).toHaveLength(1);
    });

    it.each([
      {
        nome: '200 de sucesso',
        resposta: RESPOSTA_OS_SUCESSO,
        erro: TarefaSituacaoInvalidaError,
      },
      {
        nome: '422 de recusa',
        resposta: { status: 422, corpo: { codigo: 'ITEM_INVALIDO' } },
        erro: ConclusaoRecusadaPeloOsError,
      },
      {
        nome: '409 de conflito',
        resposta: { status: 409, corpo: { codigo: 'OS_EM_CANCELAMENTO' } },
        erro: ConclusaoRecusadaPeloOsConflitoError,
      },
      {
        nome: '503 indeterminado',
        resposta: { status: 503 },
        erro: ConclusaoIndeterminadaError,
      },
    ])(
      'resposta HTTP tardia do OS ($nome) não reabre nem conclui a tarefa já cancelada',
      async ({ resposta, erro }) => {
        const { ordemServicoId, tarefaId, respostaOs, conclusao } =
          await iniciarConclusaoBloqueada(resposta);
        const cancelar = cancelamento(ordemServicoId, TipoTarefa.DIAGNOSTICO);
        await cancelar.executar();

        respostaOs.liberar();
        const [resultado] = await Promise.allSettled([conclusao]);

        exigirRecusadaCom(resultado, erro);
        exigirCanceladaSemConclusao(await lerTarefa(tarefaId));
        expect(os.requisicoes).toHaveLength(1);
        const fatos = await fatosDaOrdem(ordemServicoId);
        expect(tiposDosFatos(fatos)).toEqual([
          EVENTO_DIAGNOSTICO_INICIADO,
          EVENTO_RESPOSTA_CANCELAMENTO,
        ]);
        expect(
          respostaDoComando(fatos, cancelar.comando).envelope.payload,
        ).toEqual({
          tipoTarefa: TipoTarefa.DIAGNOSTICO,
          resultado: ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
        });
      },
    );
  });
});
