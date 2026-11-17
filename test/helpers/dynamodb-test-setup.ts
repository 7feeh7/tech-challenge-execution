import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

const TABELAS = {
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
): Promise<void> {
  const existentes = await client.send(new ListTablesCommand({}));
  const nomes = new Set(existentes.TableNames ?? []);

  await criarSeNaoExiste(client, nomes, TABELAS.tarefas, 'pk');
  await criarSeNaoExiste(client, nomes, TABELAS.outbox, 'eventId');
  await criarSeNaoExiste(
    client,
    nomes,
    TABELAS.mensagensProcessadas,
    'eventId',
  );
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
  for (const nome of Object.values(TABELAS)) {
    try {
      await client.send(new DeleteTableCommand({ TableName: nome }));
    } catch {
      /* tabela inexistente */
    }
  }
}

export function obterNomesTabelasTeste(): typeof TABELAS {
  return TABELAS;
}
