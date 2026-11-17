import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbContextoTransacao } from '@/shared/database/dynamodb-contexto-transacao';
import { DynamoDbMarcadorEfeitoGateway } from './dynamodb-marcador-efeito.gateway';

describe('DynamoDbMarcadorEfeitoGateway', () => {
  it('adiciona Put na tabela de tarefas', async () => {
    const contexto = new DynamoDbContextoTransacao(
      { send: jest.fn() } as unknown as DynamoDBClient,
      {
        tarefas: 'tarefas',
        outbox: 'outbox',
        mensagensProcessadas: 'mp',
      },
    );
    const gateway = new DynamoDbMarcadorEfeitoGateway();
    await gateway.gravarMarcador(contexto, 'pk-teste', 'evento');
    expect(contexto.obterEscritasPendentes()).toHaveLength(1);
  });
});
