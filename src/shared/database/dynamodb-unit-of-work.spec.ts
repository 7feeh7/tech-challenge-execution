import { ConfigService } from '@nestjs/config';
import { DynamoDbClientProvider } from './dynamodb-client.provider';
import { DynamoDbTabelasService } from './dynamodb-tabelas.config';
import { DynamoDbUnitOfWork } from './dynamodb-unit-of-work';
import { LimiteTransacaoExcedidoError } from './limite-transacao-excedido.error';
import { obterContextoDynamodb } from './obter-contexto-dynamodb';
import { TransacaoAninhadaError } from './transacao-aninhada.error';

describe('DynamoDbUnitOfWork', () => {
  const config = {
    get: jest.fn((k: string) =>
      k === 'AWS_REGION' ? 'us-east-1' : 'http://localhost:8000',
    ),
    getOrThrow: jest.fn((k: string) => `tabela-${k}`),
  } as unknown as ConfigService;

  it('rejeita transação aninhada', async () => {
    const provider = new DynamoDbClientProvider(config);
    const tabelas = new DynamoDbTabelasService(config);
    const uow = new DynamoDbUnitOfWork(provider, tabelas);
    await expect(
      uow.executar(async () => {
        await uow.executar(async () => undefined);
      }),
    ).rejects.toBeInstanceOf(TransacaoAninhadaError);
  });

  it('aceita transações concorrentes de fluxos independentes no mesmo singleton', async () => {
    const provider = {
      client: { send: jest.fn() },
    } as unknown as DynamoDbClientProvider;
    const uow = new DynamoDbUnitOfWork(
      provider,
      new DynamoDbTabelasService(config),
    );
    const pausa = () => new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      Promise.all([
        uow.executar(async () => pausa()),
        uow.executar(async () => pausa()),
      ]),
    ).resolves.toHaveLength(2);

    await expect(uow.executar(async () => undefined)).resolves.toBeUndefined();
  });

  it('não envia transação quando não há escritas', async () => {
    const send = jest.fn();
    const provider = { client: { send } } as unknown as DynamoDbClientProvider;
    const tabelas = new DynamoDbTabelasService(config);
    const uow = new DynamoDbUnitOfWork(provider, tabelas);
    await uow.executar(async () => undefined);
    expect(send).not.toHaveBeenCalled();
  });

  it('confirma transação com itens pendentes', async () => {
    const send = jest.fn().mockResolvedValue({});
    const provider = {
      client: { send },
    } as unknown as DynamoDbClientProvider;
    const tabelas = new DynamoDbTabelasService(config);
    const uow = new DynamoDbUnitOfWork(provider, tabelas);
    await uow.executar(async (contexto) => {
      const ctx = obterContextoDynamodb(contexto);
      ctx.adicionarEscrita({
        Put: { TableName: 'tabela', Item: { pk: { S: '1' } } },
      });
    });
    expect(send).toHaveBeenCalled();
  });

  it('rejeita transação acima de 100 itens sem gravar', async () => {
    const send = jest.fn().mockResolvedValue({});
    const provider = { client: { send } } as unknown as DynamoDbClientProvider;
    const tabelas = new DynamoDbTabelasService(config);
    const uow = new DynamoDbUnitOfWork(provider, tabelas);
    await expect(
      uow.executar(async (contexto) => {
        const ctx = obterContextoDynamodb(contexto);
        for (let i = 0; i < 101; i += 1) {
          ctx.adicionarEscrita({
            Put: { TableName: 'tabela', Item: { pk: { S: String(i) } } },
          });
        }
      }),
    ).rejects.toBeInstanceOf(LimiteTransacaoExcedidoError);
    expect(send).not.toHaveBeenCalled();
  });
});
