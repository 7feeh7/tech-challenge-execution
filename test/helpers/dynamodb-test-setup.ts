import { randomUUID } from 'node:crypto';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  OUTBOX_ATTR_INDICE_PENDENTE,
  OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
  OUTBOX_GSI_PUBLICACAO_PENDENTE,
  TAREFAS_ATTR_INDICE_FILA,
  TAREFAS_ATTR_INDICE_FILA_ORDEM,
  TAREFAS_GSI_FILA,
} from '@/shared/database/dynamodb-indices.constants';

export interface NomesTabelasDynamodb {
  tarefas: string;
  outbox: string;
  mensagensProcessadas: string;
}

const TABELAS: NomesTabelasDynamodb = {
  tarefas:
    process.env.DYNAMODB_TAREFAS_TABLE ??
    'tech-challenge-producao-execution-tarefas',
  outbox:
    process.env.DYNAMODB_OUTBOX_TABLE ??
    'tech-challenge-producao-execution-outbox',
  mensagensProcessadas:
    process.env.DYNAMODB_MENSAGENS_PROCESSADAS_TABLE ??
    'tech-challenge-producao-execution-mensagens-processadas',
};

export function criarClienteDynamodbTeste(): DynamoDBClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  return new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

export async function garantirTabelasDynamodb(
  client: DynamoDBClient,
  nomes: NomesTabelasDynamodb = TABELAS,
): Promise<void> {
  const existentes = await client.send(new ListTablesCommand({}));
  const presentes = new Set(existentes.TableNames ?? []);

  await criarTabelaTarefas(client, presentes, nomes.tarefas);
  await criarTabelaOutbox(client, presentes, nomes.outbox);
  await criarSeNaoExiste(
    client,
    presentes,
    nomes.mensagensProcessadas,
    'eventId',
  );
}

/** Tabelas exclusivas do arquivo de teste: evitam resíduo de outras suítes na fila e na outbox. */
export async function criarTabelasIsoladasDynamodb(
  client: DynamoDBClient,
  prefixo: string,
): Promise<NomesTabelasDynamodb> {
  const sufixo = randomUUID().slice(0, 8);
  const nomes = {
    tarefas: `${prefixo}-${sufixo}-tarefas`,
    outbox: `${prefixo}-${sufixo}-outbox`,
    mensagensProcessadas: `${prefixo}-${sufixo}-mensagens-processadas`,
  };
  await garantirTabelasDynamodb(client, nomes);
  return nomes;
}

export async function removerTabelasDynamodb(
  client: DynamoDBClient,
  nomes: NomesTabelasDynamodb,
): Promise<void> {
  for (const nome of Object.values(nomes)) {
    try {
      await client.send(new DeleteTableCommand({ TableName: nome }));
    } catch {
      /* tabela inexistente */
    }
  }
}

async function criarTabelaTarefas(
  client: DynamoDBClient,
  existentes: Set<string>,
  nome: string,
): Promise<void> {
  if (await manterSeTemIndice(client, existentes, nome, TAREFAS_GSI_FILA)) {
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName: nome,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: TAREFAS_ATTR_INDICE_FILA, AttributeType: 'S' },
        { AttributeName: TAREFAS_ATTR_INDICE_FILA_ORDEM, AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: TAREFAS_GSI_FILA,
          KeySchema: [
            { AttributeName: TAREFAS_ATTR_INDICE_FILA, KeyType: 'HASH' },
            { AttributeName: TAREFAS_ATTR_INDICE_FILA_ORDEM, KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: nome });
}

export async function criarTabelaOutbox(
  client: DynamoDBClient,
  existentes: Set<string>,
  nome: string = TABELAS.outbox,
): Promise<void> {
  if (
    await manterSeTemIndice(
      client,
      existentes,
      nome,
      OUTBOX_GSI_PUBLICACAO_PENDENTE,
    )
  ) {
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName: nome,
      AttributeDefinitions: [
        { AttributeName: 'eventId', AttributeType: 'S' },
        { AttributeName: OUTBOX_ATTR_INDICE_PENDENTE, AttributeType: 'S' },
        {
          AttributeName: OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
          AttributeType: 'S',
        },
      ],
      KeySchema: [{ AttributeName: 'eventId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: OUTBOX_GSI_PUBLICACAO_PENDENTE,
          KeySchema: [
            { AttributeName: OUTBOX_ATTR_INDICE_PENDENTE, KeyType: 'HASH' },
            {
              AttributeName: OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
              KeyType: 'RANGE',
            },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: nome });
}

/** Tabela local criada por versão anterior do esquema (sem o GSI) é descartada e recriada. */
async function manterSeTemIndice(
  client: DynamoDBClient,
  existentes: Set<string>,
  nome: string,
  indice: string,
): Promise<boolean> {
  if (!existentes.has(nome)) return false;
  const { Table } = await client.send(
    new DescribeTableCommand({ TableName: nome }),
  );
  const possuiIndice = (Table?.GlobalSecondaryIndexes ?? []).some(
    (gsi) => gsi.IndexName === indice,
  );
  if (possuiIndice) return true;
  await client.send(new DeleteTableCommand({ TableName: nome }));
  return false;
}

async function criarSeNaoExiste(
  client: DynamoDBClient,
  existentes: Set<string>,
  nome: string,
  hashKey: string,
): Promise<void> {
  if (existentes.has(nome)) return;
  await client.send(
    new CreateTableCommand({
      TableName: nome,
      AttributeDefinitions: [{ AttributeName: hashKey, AttributeType: 'S' }],
      KeySchema: [{ AttributeName: hashKey, KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: nome });
}

export async function limparTabelasDynamodb(
  client: DynamoDBClient,
): Promise<void> {
  await removerTabelasDynamodb(client, TABELAS);
}

export function obterNomesTabelasTeste(): NomesTabelasDynamodb {
  return TABELAS;
}
