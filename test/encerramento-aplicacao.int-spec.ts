import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  OUTBOX_ATTR_INDICE_PENDENTE,
  OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
  OUTBOX_VALOR_INDICE_PENDENTE,
} from '@/shared/database/dynamodb-indices.constants';
import { configurarAplicacao } from '@/shared/http/aplicacao.config';
import { ProcessarMensagemEntradaService } from '@/shared/messaging/application/services/processar-mensagem-entrada.service';
import {
  DESTINO_FILA_OS,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '@/shared/messaging/envelope';
import { FilaSqsGateway } from '@/shared/messaging/infra/sqs/fila-sqs.gateway';
import {
  criarClienteDynamodbTeste,
  criarTabelasIsoladasDynamodb,
  type NomesTabelasDynamodb,
  removerTabelasDynamodb,
} from './helpers/dynamodb-test-setup';
import { criarComandoIniciarDiagnostico } from './helpers/envelope-teste';
import { assinarJwtRs256, gerarParDeChavesRsa } from './helpers/jwt-test';

const FILA_ENTRADA = 'https://sqs.local/execution-in';
const FILA_DLQ = 'https://sqs.local/execution-in-dlq';
const FILA_OS = 'https://sqs.local/os-in';

class RegistroEventos {
  readonly eventos: string[] = [];
  registrar(evento: string): void {
    this.eventos.push(evento);
  }
}

/** Mantém uma operação parada até `liberar`, sem depender de temporizador. */
interface Porta {
  chegada: Promise<void>;
  passar: () => Promise<void>;
  liberar: () => void;
}

function criarPorta(): Porta {
  let liberar!: () => void;
  let sinalizarChegada!: () => void;
  const aberta = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const chegada = new Promise<void>((resolve) => {
    sinalizarChegada = resolve;
  });
  return {
    chegada,
    liberar,
    passar: async () => {
      sinalizarChegada();
      await aberta;
    },
  };
}

type NomeOperacaoDynamo =
  | 'transacao'
  | 'leitura'
  | 'listagem'
  | 'contagem-backlog'
  | 'reivindicacao'
  | 'confirmar-envio'
  | 'liberar-apos-falha'
  | 'outra';

function nomearOperacaoDynamo(comando: unknown): NomeOperacaoDynamo {
  if (comando instanceof TransactWriteItemsCommand) return 'transacao';
  if (comando instanceof GetItemCommand) return 'leitura';
  if (comando instanceof QueryCommand) {
    return comando.input.Select === 'COUNT' ? 'contagem-backlog' : 'listagem';
  }
  if (comando instanceof UpdateItemCommand) {
    const expressao = comando.input.UpdateExpression ?? '';
    if (expressao.includes('enviadoEm')) return 'confirmar-envio';
    if (expressao.includes('tentativas')) return 'liberar-apos-falha';
    return 'reivindicacao';
  }
  return 'outra';
}

/**
 * Instrumenta `DynamoDbClientProvider.enviar` sem substituir a operação: registra a conclusão
 * das operações escolhidas e pode reter a primeira ocorrência de uma delas numa porta.
 * Falhas (por exemplo, cliente destruído) são sempre registradas.
 */
function instrumentarDynamo(
  dynamo: DynamoDbClientProvider,
  registro: RegistroEventos,
  registradas: NomeOperacaoDynamo[],
  portas: Partial<Record<NomeOperacaoDynamo, Porta>> = {},
): void {
  const enviarOriginal = dynamo.enviar.bind(dynamo);
  const retidas = new Set<NomeOperacaoDynamo>();
  jest.spyOn(dynamo, 'enviar').mockImplementation(async (comando, opcoes) => {
    const nome = nomearOperacaoDynamo(comando);
    const porta = portas[nome];
    if (porta && !retidas.has(nome)) {
      retidas.add(nome);
      await porta.passar();
    }
    try {
      const resultado = await enviarOriginal(comando, opcoes);
      if (registradas.includes(nome)) registro.registrar(`dynamo:${nome}`);
      return resultado;
    } catch (erro) {
      registro.registrar(`dynamo:${nome}:falhou`);
      throw erro;
    }
  });

  // `destroy` real do cliente: o spy só registra a ordem e chama a implementação original.
  const destroyOriginal = dynamo.client.destroy.bind(dynamo.client);
  jest.spyOn(dynamo.client, 'destroy').mockImplementation(() => {
    registro.registrar('dynamo:destroy');
    destroyOriginal();
  });
}

interface OpcoesSqsStub {
  mensagens?: string[];
  portaConfirmar?: Porta;
  portaEnviar?: Porta;
  falharEnvio?: Error;
}

/**
 * Stub no nível do `SQSClient` real: `FilaSqsGateway` executa `receber`, `confirmar` e
 * `enviar` de verdade, e o `destroy` real do cliente é chamado e registrado.
 */
function instalarSqsStub(
  sqsClient: SQSClient,
  registro: RegistroEventos,
  opcoes: OpcoesSqsStub = {},
) {
  const pendentes = [...(opcoes.mensagens ?? [])];
  const confirmados: string[] = [];
  const enviados: { fila: string; corpo: string; correlationId?: string }[] =
    [];
  const violacoes: string[] = [];
  const receberPendente = criarPorta();
  let sinalReceberAbortado: AbortSignal | undefined;
  let destruido = false;
  let sequencia = 0;
  const proximoRecibo = () => {
    sequencia += 1;
    return `rh-${sequencia}`;
  };

  jest.spyOn(sqsClient, 'send').mockImplementation((async (
    comando: unknown,
    opcoesEnvio?: { abortSignal?: AbortSignal },
  ) => {
    if (destruido) {
      violacoes.push('send chamado depois do destroy do SQSClient');
      throw new Error('SQSClient já destruído');
    }
    if (comando instanceof ReceiveMessageCommand) {
      if (pendentes.length > 0) {
        const lote = pendentes.splice(
          0,
          comando.input.MaxNumberOfMessages ?? 1,
        );
        registro.registrar('sqs:receber');
        return {
          Messages: lote.map((Body) => ({
            Body,
            MessageId: randomUUID(),
            ReceiptHandle: proximoRecibo(),
          })),
        };
      }
      // Long polling sem mensagens: só termina quando o consumidor aborta.
      return await new Promise((_resolver, rejeitar) => {
        const sinal = opcoesEnvio?.abortSignal;
        sinalReceberAbortado = sinal;
        void receberPendente.passar();
        sinal?.addEventListener(
          'abort',
          () => {
            registro.registrar('sqs:receber-abortado');
            rejeitar(
              Object.assign(new Error('Request aborted'), {
                name: 'AbortError',
              }),
            );
          },
          { once: true },
        );
      });
    }
    if (comando instanceof DeleteMessageCommand) {
      await opcoes.portaConfirmar?.passar();
      confirmados.push(String(comando.input.ReceiptHandle));
      registro.registrar('sqs:confirmar');
      return {};
    }
    if (comando instanceof SendMessageCommand) {
      await opcoes.portaEnviar?.passar();
      const fila = String(comando.input.QueueUrl);
      if (opcoes.falharEnvio) {
        registro.registrar('sqs:enviar-falhou');
        throw opcoes.falharEnvio;
      }
      enviados.push({
        fila,
        corpo: String(comando.input.MessageBody),
        correlationId:
          comando.input.MessageAttributes?.correlationId?.StringValue,
      });
      registro.registrar(fila === FILA_DLQ ? 'sqs:enviar-dlq' : 'sqs:enviar');
      return {};
    }
    throw new Error('Comando SQS inesperado no teste');
  }) as never);

  const destroyOriginal = sqsClient.destroy.bind(sqsClient);
  jest.spyOn(sqsClient, 'destroy').mockImplementation(() => {
    destruido = true;
    registro.registrar('sqs:destroy');
    destroyOriginal();
  });

  return {
    confirmados,
    enviados,
    violacoes,
    receberPendente: receberPendente.chegada,
    sinalReceber: () => sinalReceberAbortado,
  };
}

/** Prova que a promessa continua pendente depois de dar chance a tudo que pudesse resolvê-la. */
async function aindaPendente(promessa: Promise<unknown>): Promise<boolean> {
  const veredito = await Promise.race([
    promessa.then(() => 'resolvida'),
    new Promise<string>((resolver) =>
      setTimeout(() => resolver('pendente'), 150),
    ),
  ]);
  return veredito === 'pendente';
}

/**
 * `Connection: close`: a conexão keep-alive de um cliente HTTP comum manteria o servidor
 * aberto até o `keepAliveTimeout` do Fastify (72 s) depois da resposta, e este teste mede só o
 * término da requisição em curso. Esse keep-alive é coberto pelo modelo de prazos
 * (`FASTIFY_KEEP_ALIVE_TIMEOUT_MS` no cálculo do encerramento).
 */
function requisitar(
  url: string,
  cabecalhos: Record<string, string>,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  return new Promise((resolver, rejeitar) => {
    const requisicao = request(
      url,
      {
        method: 'GET',
        agent: false,
        headers: { ...cabecalhos, Connection: 'close' },
      },
      (resposta) => {
        const partes: Buffer[] = [];
        resposta.on('data', (parte: Buffer) => partes.push(parte));
        resposta.on('end', () =>
          resolver({
            status: resposta.statusCode ?? 0,
            corpo: JSON.parse(Buffer.concat(partes).toString('utf-8')),
          }),
        );
      },
    );
    requisicao.on('error', rejeitar);
    requisicao.end();
  });
}

const DESTROYS = ['dynamo:destroy', 'sqs:destroy'];

/** A ordem entre os dois destroys não importa; só que ambos venham depois de tudo e uma única vez. */
function exigirOrdemComDestroysAoFinal(
  eventos: string[],
  esperadosAntesDosDestroys: string[],
): void {
  expect(eventos.slice(0, -2)).toEqual(esperadosAntesDosDestroys);
  expect([...eventos.slice(-2)].sort()).toEqual(DESTROYS);
}

describe('Encerramento da aplicação (app.close real)', () => {
  const chaves = gerarParDeChavesRsa();
  const client = criarClienteDynamodbTeste();
  let tabelas: NomesTabelasDynamodb;
  let aplicacoes: {
    app: NestFastifyApplication;
    fechamentos: jest.SpyInstance;
  }[] = [];
  let portasParaLiberar: Porta[] = [];

  function configurarAmbiente(consumidor: boolean, publicador: boolean): void {
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
      SQS_EXECUTION_IN_URL: FILA_ENTRADA,
      SQS_EXECUTION_IN_DLQ_URL: FILA_DLQ,
      SQS_OS_IN_URL: FILA_OS,
      SQS_CONSUMER_HABILITADO: String(consumidor),
      SQS_CONSUMER_INTERVAL_MS: '20',
      OUTBOX_PUBLISHER_HABILITADO: String(publicador),
      OUTBOX_PUBLISHER_INTERVAL_MS: '20',
      TERMINATION_GRACE_PERIOD_SECONDS: '870',
      OUTBOX_GSI_MAX_PAGINAS: '8',
      SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
      OUTBOX_REIVINDICACAO_MS: '480000',
    });
  }

  async function compilar(
    consumidor: boolean,
    publicador: boolean,
  ): Promise<{
    modulo: TestingModule;
    dynamo: DynamoDbClientProvider;
    sqsClient: SQSClient;
  }> {
    configurarAmbiente(consumidor, publicador);
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    return {
      modulo,
      dynamo: modulo.get(DynamoDbClientProvider),
      sqsClient: (
        modulo.get(FilaSqsGateway) as unknown as { client: SQSClient }
      ).client,
    };
  }

  async function subirAplicacao(
    modulo: TestingModule,
    antesDoInit?: (app: NestFastifyApplication) => void,
  ): Promise<NestFastifyApplication> {
    const app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configurarAplicacao(app);
    antesDoInit?.(app);
    aplicacoes.push({ app, fechamentos: jest.spyOn(app, 'close') });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  async function inserirFatoPendenteNaOutbox(): Promise<string> {
    const eventId = randomUUID();
    const agora = new Date().toISOString();
    await client.send(
      new PutItemCommand({
        TableName: tabelas.outbox,
        Item: marshall({
          eventId,
          eventType: EVENTO_RESPOSTA_CANCELAMENTO,
          envelope: {
            eventId,
            eventType: EVENTO_RESPOSTA_CANCELAMENTO,
            version: 1,
            occurredAt: agora,
            source: 'execution',
            correlationId: 'corr-encerramento',
            causationId: null,
            ordemServicoId: randomUUID(),
            rodada: 1,
            payload: { tipoTarefa: 'REPARO', resultado: 'JA_ENCERRADA' },
          },
          correlationId: 'corr-encerramento',
          causationId: null,
          destino: DESTINO_FILA_OS,
          situacao: 'PENDENTE',
          criadoEm: agora,
          tentativas: 0,
          [OUTBOX_ATTR_INDICE_PENDENTE]: OUTBOX_VALOR_INDICE_PENDENTE,
          [OUTBOX_ATTR_INDICE_PENDENTE_ORDEM]: agora,
        }),
      }),
    );
    return eventId;
  }

  async function lerRegistro(
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

  beforeEach(async () => {
    tabelas = await criarTabelasIsoladasDynamodb(client, 'int-shutdown');
    aplicacoes = [];
    portasParaLiberar = [];
  });

  afterEach(async () => {
    for (const porta of portasParaLiberar) porta.liberar();
    for (const { app, fechamentos } of aplicacoes) {
      if (fechamentos.mock.calls.length === 0) {
        fechamentos.mockRestore();
        await app.close().catch(() => undefined);
      }
    }
    jest.restoreAllMocks();
    await removerTabelasDynamodb(client, tabelas);
  });

  afterAll(() => {
    client.destroy();
  });

  function porta(): Porta {
    const nova = criarPorta();
    portasParaLiberar.push(nova);
    return nova;
  }

  it('consumidor com lote em curso bloqueado no TransactWriteItems: persiste e confirma cada mensagem antes de qualquer destroy', async () => {
    const registro = new RegistroEventos();
    const comandos = [
      criarComandoIniciarDiagnostico(),
      criarComandoIniciarDiagnostico(),
    ];
    const portaTransacao = porta();
    const { modulo, dynamo, sqsClient } = await compilar(true, false);
    instrumentarDynamo(dynamo, registro, ['transacao'], {
      transacao: portaTransacao,
    });
    const sqs = instalarSqsStub(sqsClient, registro, {
      mensagens: comandos.map((c) => JSON.stringify(c)),
    });
    const app = await subirAplicacao(modulo);

    await portaTransacao.chegada;
    expect(registro.eventos).toEqual(['sqs:receber']);

    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['sqs:receber']);

    portaTransacao.liberar();
    await fechamento;

    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'sqs:receber',
      'dynamo:transacao',
      'sqs:confirmar',
      'dynamo:transacao',
      'sqs:confirmar',
    ]);
    expect(sqs.confirmados).toEqual(['rh-1', 'rh-2']);
    expect(sqs.violacoes).toEqual([]);
    for (const comando of comandos) {
      expect(
        await lerRegistro(tabelas.tarefas, {
          pk: `${comando.ordemServicoId}#1#DIAGNOSTICO`,
        }),
      ).toMatchObject({ situacao: 'PENDENTE' });
      expect(
        await lerRegistro(tabelas.mensagensProcessadas, {
          eventId: comando.eventId,
        }),
      ).toBeDefined();
    }
  });

  it('confirmação SQS em curso no encerramento termina antes do destroy dos clientes', async () => {
    const registro = new RegistroEventos();
    const comando = criarComandoIniciarDiagnostico();
    const portaConfirmar = porta();
    const { modulo, dynamo, sqsClient } = await compilar(true, false);
    instrumentarDynamo(dynamo, registro, ['transacao']);
    const sqs = instalarSqsStub(sqsClient, registro, {
      mensagens: [JSON.stringify(comando)],
      portaConfirmar,
    });
    const app = await subirAplicacao(modulo);

    await portaConfirmar.chegada;
    expect(registro.eventos).toEqual(['sqs:receber', 'dynamo:transacao']);

    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['sqs:receber', 'dynamo:transacao']);

    portaConfirmar.liberar();
    await fechamento;

    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'sqs:receber',
      'dynamo:transacao',
      'sqs:confirmar',
    ]);
    expect(sqs.confirmados).toEqual(['rh-1']);
    expect(sqs.violacoes).toEqual([]);
  });

  it('envio à DLQ em curso no encerramento termina, e a confirmação vem, antes do destroy do SQS', async () => {
    const registro = new RegistroEventos();
    const corpoInvalido = 'isto não é JSON';
    const portaEnviar = porta();
    const { modulo, dynamo, sqsClient } = await compilar(true, false);
    instrumentarDynamo(dynamo, registro, ['transacao']);
    const sqs = instalarSqsStub(sqsClient, registro, {
      mensagens: [corpoInvalido],
      portaEnviar,
    });
    const app = await subirAplicacao(modulo);

    await portaEnviar.chegada;
    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['sqs:receber']);

    portaEnviar.liberar();
    await fechamento;

    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'sqs:receber',
      'sqs:enviar-dlq',
      'sqs:confirmar',
    ]);
    expect(sqs.enviados).toEqual([
      {
        fila: FILA_DLQ,
        corpo: corpoInvalido,
        correlationId: expect.any(String),
      },
    ]);
    expect(sqs.confirmados).toEqual(['rh-1']);
    expect(sqs.violacoes).toEqual([]);
  });

  it('publicador com envio em curso: confirma o envio, termina o ciclo e só então destrói os clientes', async () => {
    const registro = new RegistroEventos();
    const eventId = await inserirFatoPendenteNaOutbox();
    const portaEnviar = porta();
    const { modulo, dynamo, sqsClient } = await compilar(false, true);
    instrumentarDynamo(dynamo, registro, [
      'reivindicacao',
      'confirmar-envio',
      'liberar-apos-falha',
      'contagem-backlog',
    ]);
    const sqs = instalarSqsStub(sqsClient, registro, { portaEnviar });
    const app = await subirAplicacao(modulo);

    await portaEnviar.chegada;
    const emAndamento = await lerRegistro(tabelas.outbox, { eventId });
    expect(emAndamento?.tokenReivindicacao).toEqual(expect.any(String));
    expect(registro.eventos).toEqual(['dynamo:reivindicacao']);

    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['dynamo:reivindicacao']);

    portaEnviar.liberar();
    await fechamento;

    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'dynamo:reivindicacao',
      'sqs:enviar',
      'dynamo:confirmar-envio',
      'dynamo:contagem-backlog',
    ]);
    expect(sqs.enviados).toHaveLength(1);
    expect(sqs.enviados[0]).toMatchObject({
      fila: FILA_OS,
      correlationId: 'corr-encerramento',
    });
    expect(JSON.parse(sqs.enviados[0]?.corpo ?? '{}')).toMatchObject({
      eventId,
    });
    expect(sqs.violacoes).toEqual([]);
    const final = await lerRegistro(tabelas.outbox, { eventId });
    expect(final).toMatchObject({
      situacao: 'ENVIADA',
      tokenReivindicacao: null,
      bloqueadoAte: null,
    });
    expect(final?.enviadoEm).toEqual(expect.any(String));
    expect(final?.[OUTBOX_ATTR_INDICE_PENDENTE]).toBeUndefined();
  });

  it('publicador com envio que falha durante o encerramento: libera a reivindicação antes do destroy do DynamoDB', async () => {
    const registro = new RegistroEventos();
    const eventId = await inserirFatoPendenteNaOutbox();
    const portaEnviar = porta();
    const { modulo, dynamo, sqsClient } = await compilar(false, true);
    instrumentarDynamo(dynamo, registro, [
      'reivindicacao',
      'confirmar-envio',
      'liberar-apos-falha',
      'contagem-backlog',
    ]);
    const sqs = instalarSqsStub(sqsClient, registro, {
      portaEnviar,
      falharEnvio: new Error('falha simulada do SQS'),
    });
    const app = await subirAplicacao(modulo);

    await portaEnviar.chegada;
    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['dynamo:reivindicacao']);

    portaEnviar.liberar();
    await fechamento;

    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'dynamo:reivindicacao',
      'sqs:enviar-falhou',
      'dynamo:liberar-apos-falha',
      'dynamo:contagem-backlog',
    ]);
    expect(sqs.violacoes).toEqual([]);
    const final = await lerRegistro(tabelas.outbox, { eventId });
    expect(final).toMatchObject({
      situacao: 'PENDENTE',
      tokenReivindicacao: null,
      tentativas: 1,
      [OUTBOX_ATTR_INDICE_PENDENTE]: OUTBOX_VALOR_INDICE_PENDENTE,
    });
    expect(final?.enviadoEm).toBeUndefined();
    // A reivindicação não fica presa pelo lease de 480000 ms: vale a espera da retentativa.
    const espera = new Date(String(final?.bloqueadoAte)).getTime() - Date.now();
    expect(espera).toBeLessThan(60_000);
  });

  it('requisição HTTP em curso, bloqueada numa operação DynamoDB, responde antes do fechamento HTTP e dos destroys', async () => {
    const registro = new RegistroEventos();
    const comando = criarComandoIniciarDiagnostico();
    const tarefaId = `${comando.ordemServicoId}#1#DIAGNOSTICO`;
    const portaLeitura = porta();
    const { modulo, dynamo, sqsClient } = await compilar(false, false);
    instalarSqsStub(sqsClient, registro);
    const app = await subirAplicacao(modulo, (aplicacao) => {
      aplicacao
        .getHttpAdapter()
        .getInstance()
        .addHook('onResponse', (_requisicao, _resposta, concluir) => {
          registro.registrar('http:resposta-enviada');
          concluir();
        });
      const adaptador = aplicacao.getHttpAdapter();
      const fecharOriginal = adaptador.close.bind(adaptador);
      jest.spyOn(adaptador, 'close').mockImplementation(async () => {
        registro.registrar('http:fechamento-iniciado');
        await fecharOriginal();
        registro.registrar('http:fechamento-concluido');
      });
    });
    await app
      .get(ProcessarMensagemEntradaService)
      .executar(JSON.stringify(comando));
    instrumentarDynamo(dynamo, registro, ['leitura'], {
      leitura: portaLeitura,
    });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;

    const token = assinarJwtRs256(chaves.privateKey, {
      sub: 'mec-1',
      email: 'mec-1@oficina.com',
      perfil: 'MECANICO',
    });
    const resposta = requisitar(
      `http://127.0.0.1:${port}/v1/tarefas/${encodeURIComponent(tarefaId)}`,
      { Authorization: `Bearer ${token}` },
    );

    await portaLeitura.chegada;
    const fechamento = app.close();
    expect(await aindaPendente(fechamento)).toBe(true);
    expect(registro.eventos).toEqual(['http:fechamento-iniciado']);

    portaLeitura.liberar();
    await fechamento;

    expect(await resposta).toMatchObject({
      status: 200,
      corpo: { id: tarefaId, situacao: 'PENDENTE' },
    });
    exigirOrdemComDestroysAoFinal(registro.eventos, [
      'http:fechamento-iniciado',
      'dynamo:leitura',
      'http:resposta-enviada',
      'http:fechamento-concluido',
    ]);
  });

  it('cancela o long polling pendente no encerramento antes de destruir os clientes', async () => {
    const registro = new RegistroEventos();
    const { modulo, dynamo, sqsClient } = await compilar(true, false);
    instrumentarDynamo(dynamo, registro, ['transacao']);
    const sqs = instalarSqsStub(sqsClient, registro);
    const app = await subirAplicacao(modulo);

    await sqs.receberPendente;
    expect(sqs.sinalReceber()?.aborted).toBe(false);

    await app.close();

    expect(sqs.sinalReceber()?.aborted).toBe(true);
    exigirOrdemComDestroysAoFinal(registro.eventos, ['sqs:receber-abortado']);
    expect(sqs.violacoes).toEqual([]);
  });

  it('encerramento natural com consumidor e publicador ociosos: destrói cada cliente uma única vez', async () => {
    const registro = new RegistroEventos();
    const { modulo, dynamo, sqsClient } = await compilar(true, true);
    instrumentarDynamo(dynamo, registro, []);
    const sqs = instalarSqsStub(sqsClient, registro);
    const app = await subirAplicacao(modulo);
    await sqs.receberPendente;

    await app.close();
    dynamo.onApplicationShutdown();
    app.get(FilaSqsGateway).onApplicationShutdown();

    exigirOrdemComDestroysAoFinal(registro.eventos, ['sqs:receber-abortado']);
    expect(sqs.violacoes).toEqual([]);
  });
});
