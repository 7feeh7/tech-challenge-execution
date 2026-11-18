import { randomUUID } from 'node:crypto';
import {
  DeleteItemCommand,
  DeleteTableCommand,
  GetItemCommand,
  ListTablesCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ConfigService } from '@nestjs/config';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  OUTBOX_ATTR_INDICE_PENDENTE,
  OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
  OUTBOX_GSI_PUBLICACAO_PENDENTE,
  OUTBOX_VALOR_INDICE_PENDENTE,
} from '@/shared/database/dynamodb-indices.constants';
import { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';
import { DynamoDbUnitOfWork } from '@/shared/database/dynamodb-unit-of-work';
import { DESTINO_FILA_OS } from '@/shared/messaging/envelope';
import { DynamoDbOutboxGateway } from '@/shared/messaging/infra/persistence/dynamodb-outbox.gateway';
import { DynamoDbOutboxRepositorio } from '@/shared/messaging/infra/persistence/dynamodb-outbox-repositorio';
import {
  criarClienteDynamodbTeste,
  criarTabelaOutbox,
} from './helpers/dynamodb-test-setup';

const LOTE = 5;

describe('Outbox com GSI esparso das pendentes (integração com DynamoDB Local)', () => {
  const client = criarClienteDynamodbTeste();
  const tabelaOutbox = `int-outbox-gsi-${randomUUID().slice(0, 8)}`;
  let provider: DynamoDbClientProvider;
  let repositorio: DynamoDbOutboxRepositorio;
  let unitOfWork: DynamoDbUnitOfWork;
  const gateway = new DynamoDbOutboxGateway();

  const futuro = (ms = 60_000) => new Date(Date.now() + ms).toISOString();
  const passado = (ms = 60_000) => new Date(Date.now() - ms).toISOString();

  async function registrarPendente(eventId = randomUUID()): Promise<string> {
    await unitOfWork.executar((contexto) =>
      gateway.registrar(contexto, {
        eventId,
        eventType: 'execution.diagnostico-iniciado.v1',
        envelope: {
          eventId,
          eventType: 'execution.diagnostico-iniciado.v1',
          version: 1,
          occurredAt: new Date().toISOString(),
          source: 'execution',
          correlationId: eventId,
          causationId: null,
          ordemServicoId: randomUUID(),
          rodada: 1,
          payload: {},
        },
        correlationId: eventId,
        causationId: null,
        destino: DESTINO_FILA_OS,
      }),
    );
    return eventId;
  }

  async function publicar(eventId: string): Promise<void> {
    const registro = await repositorio.reivindicar(
      eventId,
      `token-${eventId}`,
      futuro(),
    );
    expect(registro).not.toBeNull();
    await expect(
      repositorio.confirmarEnvio(eventId, `token-${eventId}`),
    ).resolves.toBe(true);
  }

  /** Pendente em retentativa: segue no índice, mas não é elegível até `bloqueadoAte`. */
  async function inserirPendenteEmBackoff(
    ordem: string,
    bloqueadoAte: string,
  ): Promise<string> {
    const eventId = randomUUID();
    await client.send(
      new PutItemCommand({
        TableName: tabelaOutbox,
        Item: marshall({
          eventId,
          eventType: 'execution.diagnostico-iniciado.v1',
          envelope: {},
          correlationId: eventId,
          destino: DESTINO_FILA_OS,
          situacao: 'PENDENTE',
          criadoEm: ordem,
          tentativas: 3,
          bloqueadoAte,
          [OUTBOX_ATTR_INDICE_PENDENTE]: OUTBOX_VALOR_INDICE_PENDENTE,
          [OUTBOX_ATTR_INDICE_PENDENTE_ORDEM]: ordem,
        }),
      }),
    );
    return eventId;
  }

  const lerItem = async (eventId: string) => {
    const resposta = await client.send(
      new GetItemCommand({
        TableName: tabelaOutbox,
        Key: marshall({ eventId }),
        ConsistentRead: true,
      }),
    );
    return resposta.Item ? unmarshall(resposta.Item) : undefined;
  };

  const consultarIndice = async (): Promise<string[]> => {
    const resposta = await client.send(
      new QueryCommand({
        TableName: tabelaOutbox,
        IndexName: OUTBOX_GSI_PUBLICACAO_PENDENTE,
        KeyConditionExpression: `${OUTBOX_ATTR_INDICE_PENDENTE} = :i`,
        ExpressionAttributeValues: marshall({
          ':i': OUTBOX_VALOR_INDICE_PENDENTE,
        }),
      }),
    );
    return (resposta.Items ?? []).map((i) => String(unmarshall(i).eventId));
  };

  beforeAll(async () => {
    const existentes = await client.send(new ListTablesCommand({}));
    await criarTabelaOutbox(
      client,
      new Set(existentes.TableNames ?? []),
      tabelaOutbox,
    );
    const config = new ConfigService({
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT:
        process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
      DYNAMODB_TAREFAS_TABLE: `${tabelaOutbox}-tarefas`,
      DYNAMODB_OUTBOX_TABLE: tabelaOutbox,
      DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: `${tabelaOutbox}-processadas`,
    });
    provider = new DynamoDbClientProvider(config);
    const tabelas = new DynamoDbTabelasService(config);
    repositorio = new DynamoDbOutboxRepositorio(provider, tabelas, config);
    unitOfWork = new DynamoDbUnitOfWork(provider, tabelas);
  });

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: tabelaOutbox }));
    client.destroy();
    provider.client.destroy();
  });

  it('seleciona a pendente mesmo com muito mais registros ENVIADA do que o lote', async () => {
    for (let i = 0; i < LOTE * 6; i += 1) {
      await publicar(await registrarPendente());
    }
    const pendente = await registrarPendente();

    const candidatas = await repositorio.listarCandidatasPendentes(LOTE);

    expect(candidatas).toEqual([pendente]);
    await publicar(pendente);
  });

  it('o registro enviado sai do índice e perde os atributos do GSI', async () => {
    const eventId = await registrarPendente();
    expect(await consultarIndice()).toContain(eventId);
    const antes = await lerItem(eventId);
    expect(antes?.[OUTBOX_ATTR_INDICE_PENDENTE]).toBe(
      OUTBOX_VALOR_INDICE_PENDENTE,
    );

    await publicar(eventId);

    const depois = await lerItem(eventId);
    expect(depois).toMatchObject({ situacao: 'ENVIADA' });
    expect(depois?.[OUTBOX_ATTR_INDICE_PENDENTE]).toBeUndefined();
    expect(depois?.[OUTBOX_ATTR_INDICE_PENDENTE_ORDEM]).toBeUndefined();
    expect(await consultarIndice()).not.toContain(eventId);
  });

  it('encontra a elegível depois de várias páginas de pendentes bloqueadas por retentativa', async () => {
    const bloqueadas: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      bloqueadas.push(
        await inserirPendenteEmBackoff(
          `2000-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
          futuro(),
        ),
      );
    }
    const elegivel = await registrarPendente();

    const candidatas = await repositorio.listarCandidatasPendentes(1);

    expect(candidatas).toEqual([elegivel]);

    await publicar(elegivel);
    for (const eventId of bloqueadas) {
      await client.send(
        new DeleteItemCommand({
          TableName: tabelaOutbox,
          Key: marshall({ eventId }),
        }),
      );
    }
  });

  it('devolve as candidatas em ordem de criação até o limite do lote', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await registrarPendente());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const candidatas = await repositorio.listarCandidatasPendentes(2);

    expect(candidatas).toEqual(ids.slice(0, 2));
    for (const eventId of ids) await publicar(eventId);
  });

  it('falha de publicação mantém no índice com backoff e só volta a ser candidata depois dele', async () => {
    const eventId = await registrarPendente();
    await repositorio.reivindicar(eventId, 't1', futuro());

    await repositorio.liberarAposFalha(eventId, 't1', futuro(30_000), 1);

    expect(await consultarIndice()).toContain(eventId);
    expect(await repositorio.listarCandidatasPendentes(LOTE)).not.toContain(
      eventId,
    );

    await client.send(
      new PutItemCommand({
        TableName: tabelaOutbox,
        Item: marshall({
          ...((await lerItem(eventId)) ?? {}),
          bloqueadoAte: passado(),
        }),
      }),
    );
    expect(await repositorio.listarCandidatasPendentes(LOTE)).toContain(
      eventId,
    );
    await repositorio.reivindicar(eventId, 't2', futuro());
    await repositorio.confirmarEnvio(eventId, 't2');
  });

  it('recupera a posse vencida e o dono antigo perde a confirmação por fencing', async () => {
    const eventId = await registrarPendente();
    await repositorio.reivindicar(eventId, 'dono-antigo', passado());

    expect(await repositorio.listarCandidatasPendentes(LOTE)).toContain(
      eventId,
    );
    const nova = await repositorio.reivindicar(eventId, 'dono-novo', futuro());
    expect(nova?.tokenReivindicacao).toBe('dono-novo');

    await expect(
      repositorio.confirmarEnvio(eventId, 'dono-antigo'),
    ).resolves.toBe(false);
    await expect(
      repositorio.confirmarEnvio(eventId, 'dono-novo'),
    ).resolves.toBe(true);
  });

  it('reivindicações concorrentes da mesma pendente: só uma vence', async () => {
    const eventId = await registrarPendente();

    const resultados = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        repositorio.reivindicar(eventId, `réplica-${i}`, futuro()),
      ),
    );

    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
    const vencedora = resultados.find((r) => r !== null);
    await expect(
      repositorio.confirmarEnvio(eventId, vencedora?.tokenReivindicacao ?? ''),
    ).resolves.toBe(true);
  });

  it('conta como pendentes só as elegíveis pelo índice', async () => {
    const base = await repositorio.contarPendentes();
    const elegivel = await registrarPendente();
    await inserirPendenteEmBackoff(new Date().toISOString(), futuro());
    const enviada = await registrarPendente();
    await publicar(enviada);

    expect(await repositorio.contarPendentes()).toBe(base + 1);
    await publicar(elegivel);
  });
});
