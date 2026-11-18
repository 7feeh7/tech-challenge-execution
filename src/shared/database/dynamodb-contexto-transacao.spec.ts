import type { DynamoDbClientProvider } from './dynamodb-client.provider';
import { DynamoDbContextoTransacao } from './dynamodb-contexto-transacao';

function criarDynamoFake(
  enviar: jest.Mock,
): Pick<DynamoDbClientProvider, 'enviar'> {
  return { enviar };
}

describe('DynamoDbContextoTransacao', () => {
  const tabelas = {
    tarefas: 'tarefas',
    outbox: 'outbox',
    mensagensProcessadas: 'mensagens',
  };

  it('usa cache de leitura na mesma transação', async () => {
    const enviar = jest.fn().mockResolvedValue({
      Item: { campo: { S: 'valor' } },
    });
    const contexto = new DynamoDbContextoTransacao(
      criarDynamoFake(enviar) as DynamoDbClientProvider,
      tabelas,
    );
    await contexto.obterRegistro('mensagens', { eventId: 'e1' });
    await contexto.obterRegistro('mensagens', { eventId: 'e1' });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('deserializa tipos complexos do DynamoDB', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarDynamoFake(
        jest.fn().mockResolvedValue({
          Item: {
            n: { N: '42' },
            b: { BOOL: true },
            m: { M: { x: { S: 'y' } } },
            l: { L: [{ S: 'z' }] },
            z: { NULL: true },
          },
        }),
      ) as DynamoDbClientProvider,
      tabelas,
    );
    const registro = await contexto.obterRegistro('mensagens', {
      eventId: 'e2',
    });
    expect(registro?.n).toBe(42);
    expect(registro?.b).toBe(true);
    expect(registro?.m).toEqual({ x: 'y' });
    expect(registro?.l).toEqual(['z']);
    expect(registro?.z).toBeNull();
  });

  it('retorna null quando item não existe', async () => {
    const contexto = new DynamoDbContextoTransacao(
      criarDynamoFake(
        jest.fn().mockResolvedValue({}),
      ) as DynamoDbClientProvider,
      tabelas,
    );
    await expect(
      contexto.obterRegistro('mensagens', { eventId: 'ausente' }),
    ).resolves.toBeNull();
  });
});
