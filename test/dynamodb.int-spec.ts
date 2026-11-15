import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

describe('DynamoDB Local (integração)', () => {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });

  it('responde a ListTables no endpoint configurado', async () => {
    const resultado = await client.send(new ListTablesCommand({}));
    expect(Array.isArray(resultado.TableNames)).toBe(true);
  });
});
