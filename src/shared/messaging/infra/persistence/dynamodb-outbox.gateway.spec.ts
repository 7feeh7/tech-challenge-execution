import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbContextoTransacao } from '@/shared/database/dynamodb-contexto-transacao';
import { DESTINO_FILA_OS } from '../../envelope';
import { DynamoDbOutboxGateway } from './dynamodb-outbox.gateway';

describe('DynamoDbOutboxGateway', () => {
  it('registra item de outbox na transação', async () => {
    const client = { send: jest.fn() } as unknown as DynamoDBClient;
    const contexto = new DynamoDbContextoTransacao(client, {
      tarefas: 't',
      outbox: 'outbox',
      mensagensProcessadas: 'mp',
    });
    const gateway = new DynamoDbOutboxGateway();
    await gateway.registrar(contexto, {
      eventId: 'evt',
      eventType: 'x.v1',
      envelope: {
        eventId: 'evt',
        eventType: 'x.v1',
        version: 1,
        occurredAt: 't',
        source: 'execution',
        correlationId: 'c',
        causationId: null,
        ordemServicoId: 'os',
        rodada: 1,
        payload: {},
      },
      correlationId: 'c',
      causationId: null,
      destino: DESTINO_FILA_OS,
    });
    expect(contexto.obterEscritasPendentes()).toHaveLength(1);
  });
});
