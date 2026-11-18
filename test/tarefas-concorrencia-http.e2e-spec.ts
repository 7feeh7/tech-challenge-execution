import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ResultadoCancelamento } from '@/modules/tarefas/domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '@/modules/tarefas/domain/situacao-tarefa.enum';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { configurarAplicacao } from '@/shared/http/aplicacao.config';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import {
  EVENTO_REPARO_INICIADO,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '@/shared/messaging/envelope';
import { AppModule } from '../src/app.module';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import {
  criarComandoCancelarTarefa,
  criarComandoIniciarReparo,
} from './helpers/envelope-teste';
import {
  fatosDoTipo,
  lerFatosDaOrdem,
  tiposDosFatos,
} from './helpers/fatos-outbox';
import { executarEmOrdem } from './helpers/instalar-barreira-transacao';
import { assinarJwtRs256, gerarParDeChavesRsa } from './helpers/jwt-test';
import { exigirCumprida } from './helpers/resultado-operacao';

interface RespostaHttp {
  statusCode: number;
  json: () => Record<string, unknown>;
}

describe('Início pela rota HTTP × cancelamento (e2e com barreira ordenada)', () => {
  const chaves = gerarParDeChavesRsa();
  const client = criarClienteDynamodbTeste();
  const MOTIVO = 'Desistência do cliente';
  let tabelas: NomesTabelasDynamodb;
  let app: NestFastifyApplication;
  let dynamo: DynamoDbClientProvider;
  let processarComando: ProcessarMensagemEntradaService;

  const bearer = (sub = 'mec-1') => ({
    Authorization: `Bearer ${assinarJwtRs256(chaves.privateKey, {
      sub,
      email: `${sub}@oficina.com`,
      perfil: 'MECANICO',
    })}`,
  });

  async function lerTarefa(id: string): Promise<Record<string, unknown>> {
    const resposta = await client.send(
      new GetItemCommand({
        TableName: tabelas.tarefas,
        Key: marshall({ pk: id }),
        ConsistentRead: true,
      }),
    );
    return resposta.Item ? unmarshall(resposta.Item) : {};
  }

  async function correr(ordem: readonly [string, string]) {
    const comando = criarComandoIniciarReparo();
    const { ordemServicoId } = comando;
    const tarefaId = `${ordemServicoId}#${comando.rodada}#REPARO`;
    await processarComando.executar(JSON.stringify(comando));
    expect(await lerTarefa(tarefaId)).toMatchObject({
      situacao: SituacaoTarefa.PENDENTE,
      versao: 1,
    });
    const cancelar = criarComandoCancelarTarefa(
      {
        ordemServicoId,
        payload: { tipoTarefa: TipoTarefa.REPARO, motivo: MOTIVO },
      },
      TipoTarefa.REPARO,
    );

    const resultados = await executarEmOrdem(dynamo, ordem, {
      inicio: async () =>
        await app.inject({
          method: 'POST',
          url: `/v1/tarefas/${encodeURIComponent(tarefaId)}/inicio`,
          headers: bearer(),
        }),
      cancelamento: () => processarComando.executar(JSON.stringify(cancelar)),
    });
    const fatos = await lerFatosDaOrdem(client, tabelas.outbox, ordemServicoId);
    const respostas = fatosDoTipo(fatos, EVENTO_RESPOSTA_CANCELAMENTO);
    expect(respostas).toHaveLength(1);
    expect(respostas[0]?.causationId).toBe(cancelar.eventId);
    return {
      resultados,
      tarefaId,
      fatos,
      payloadResposta: respostas[0]?.envelope.payload,
      http: exigirCumprida<RespostaHttp>(resultados.inicio),
    };
  }

  beforeAll(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'e2e-concorrencia');
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
    });

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configurarAplicacao(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    dynamo = app.get(DynamoDbClientProvider);
    processarComando = app.get(ProcessarMensagemEntradaService);
  });

  afterAll(async () => {
    await app.close();
    await removerTabelasDynamodb(client, tabelas);
    client.destroy();
  });

  it('rota grava primeiro: 200 com a tarefa em andamento e o cancelamento solicita a interrupção', async () => {
    const { resultados, tarefaId, fatos, payloadResposta, http } = await correr(
      ['inicio', 'cancelamento'],
    );

    expect(http.statusCode).toBe(200);
    expect(http.json()).toMatchObject({
      id: tarefaId,
      situacao: SituacaoTarefa.EM_ANDAMENTO,
      responsavelId: 'mec-1',
    });
    exigirCumprida(resultados.cancelamento);
    const item = await lerTarefa(tarefaId);
    expect(item).toMatchObject({
      situacao: SituacaoTarefa.INTERRUPCAO_SOLICITADA,
      responsavelId: 'mec-1',
      motivoCancelamento: MOTIVO,
      versao: 3,
    });
    expect(item.fatoTerminalEventId).toBeUndefined();
    expect(tiposDosFatos(fatos)).toEqual([
      EVENTO_REPARO_INICIADO,
      EVENTO_RESPOSTA_CANCELAMENTO,
    ]);
    expect(payloadResposta).toEqual({
      tipoTarefa: TipoTarefa.REPARO,
      resultado: ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
    });
  });

  it('cancelamento grava primeiro: a rota responde 409 com a situação atual e a tarefa fica cancelada', async () => {
    const { resultados, tarefaId, fatos, payloadResposta, http } = await correr(
      ['cancelamento', 'inicio'],
    );

    expect(http.statusCode).toBe(409);
    expect(http.json()).toMatchObject({
      statusCode: 409,
      message:
        'Não é possível iniciar uma tarefa em CANCELADA; situação esperada: PENDENTE.',
    });
    exigirCumprida(resultados.cancelamento);
    const item = await lerTarefa(tarefaId);
    expect(item).toMatchObject({
      situacao: SituacaoTarefa.CANCELADA,
      motivoCancelamento: MOTIVO,
      versao: 2,
    });
    expect(item.responsavelId).toBeUndefined();
    expect(item.iniciadoEm).toBeUndefined();
    expect(tiposDosFatos(fatos)).toEqual([EVENTO_RESPOSTA_CANCELAMENTO]);
    expect(payloadResposta).toEqual({
      tipoTarefa: TipoTarefa.REPARO,
      resultado: ResultadoCancelamento.CANCELADA_SEM_INICIO,
    });
  });
});
