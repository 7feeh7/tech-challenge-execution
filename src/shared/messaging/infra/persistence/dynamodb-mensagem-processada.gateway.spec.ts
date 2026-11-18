import type { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { DynamoDbContextoTransacao } from '@/shared/database/dynamodb-contexto-transacao';
import { DynamoDbMensagemProcessadaGateway } from './dynamodb-mensagem-processada.gateway';

describe('DynamoDbMensagemProcessadaGateway', () => {
  const tabelas = {
    tarefas: 'tarefas',
    outbox: 'outbox',
    mensagensProcessadas: 'mensagens',
  };

  function criarProvider(enviar: jest.Mock): DynamoDbClientProvider {
    return { enviar } as unknown as DynamoDbClientProvider;
  }

  it('registra Put condicional na transação', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarProvider(jest.fn().mockResolvedValue({})),
      tabelas,
    );
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await gateway.registrar(contexto, 'e1', 'hash');
    expect(contexto.obterEscritasPendentes()).toHaveLength(1);
  });

  it('retorna null quando hash não é texto', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarProvider(
        jest.fn().mockResolvedValue({
          Item: { hashConteudo: { N: '1' } },
        }),
      ),
      tabelas,
    );
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.buscarHash(contexto, 'e3')).resolves.toBeNull();
  });

  it('retorna hash existente', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarProvider(
        jest.fn().mockResolvedValue({
          Item: { hashConteudo: { S: 'abc' } },
        }),
      ),
      tabelas,
    );
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.buscarHash(contexto, 'e2')).resolves.toBe('abc');
  });

  it('detecta mensagem já processada', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarProvider(
        jest.fn().mockResolvedValue({
          Item: { eventId: { S: 'e1' }, hashConteudo: { S: 'hash' } },
        }),
      ),
      tabelas,
    );
    const gateway = new DynamoDbMensagemProcessadaGateway();
    await expect(gateway.jaProcessada(contexto, 'e1')).resolves.toBe(true);
  });
});