import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import {
  criarClienteDynamodbTeste,
  garantirTabelasDynamodb,
} from './helpers/dynamodb-test-setup';

describe('DynamoDB Local (integração)', () => {
  const client = criarClienteDynamodbTeste();

  it('responde a ListTables no endpoint configurado', async () => {
    const resultado = await client.send(new ListTablesCommand({}));
    expect(Array.isArray(resultado.TableNames)).toBe(true);
  });

  it('cria as três tabelas do Execution', async () => {
    await garantirTabelasDynamodb(client);
    const resultado = await client.send(new ListTablesCommand({}));
    const nomes = resultado.TableNames ?? [];
    expect(
      nomes.some(
        (n) => n.includes('execution-tarefas') || n.includes('tarefas'),
      ),
    ).toBe(true);
    expect(
      nomes.some((n) => n.includes('execution-outbox') || n.includes('outbox')),
    ).toBe(true);
    expect(nomes.some((n) => n.includes('mensagens-processadas'))).toBe(true);
  });
});
