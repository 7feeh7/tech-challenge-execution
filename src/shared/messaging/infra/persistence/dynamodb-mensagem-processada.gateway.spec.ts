import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbContextoTransacao } from '@/shared/database/dynamodb-contexto-transacao';
import { DynamoDbMensagemProcessadaGateway } from './dynamodb-mensagem-processada.gateway';

describe('DynamoDbMensagemProcessadaGateway', () => {
  const tabelas = {
    tarefas: 'tarefas',
    outbox: 'outbox',
    mensagensProcessadas: 'mensagens',
  };

  it('registra Put condicional na transação', async () => {
    const client = {
      send: jest.fn().mockResolvedValue({}),
    } as unknown as DynamoDBClient;
    const contexto = new DynamoDbContextoTransacao(client, tabelas);
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await gateway.registrar(contexto, 'e1', 'hash');
    expect(contexto.obterEscritasPendentes()).toHaveLength(1);
  });

  it('retorna null quando hash não é texto', async () => {
    const client = {
      send: jest.fn().mockResolvedValue({
        Item: { hashConteudo: { N: '1' } },
      }),
    } as unknown as DynamoDBClient;
    const contexto = new DynamoDbContextoTransacao(client, tabelas);
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.buscarHash(contexto, 'e3')).resolves.toBeNull();
  });

  it('retorna hash existente', async () => {
    const client = {
      send: jest.fn().mockResolvedValue({
        Item: { hashConteudo: { S: 'abc' } },
      }),
    } as unknown as DynamoDBClient;
    const contexto = new DynamoDbContextoTransacao(client, tabelas);
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.buscarHash(contexto, 'e2')).resolves.toBe('abc');
  });

  it('detecta mensagem já processada', async () => {
    const client = {
      send: jest.fn().mockResolvedValue({
        Item: { eventId: { S: 'e1' }, hashConteudo: { S: 'hash' } },
      }),
    } as unknown as DynamoDBClient;
    const contexto = new DynamoDbContextoTransacao(client, tabelas);
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.jaProcessada(contexto, 'e1')).resolves.toBe(true);
  });
});
