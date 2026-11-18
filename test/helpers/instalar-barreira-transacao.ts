import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  type BarreiraTransacaoDynamodb,
  criarBarreiraDupla,
} from './barreira-transacao-dynamodb';

export function instalarBarreiraTransacao(dynamo: DynamoDbClientProvider): {
  barreira: BarreiraTransacaoDynamodb;
  restaurar: () => void;
} {
  const barreira = criarBarreiraDupla();
  const enviarOriginal = dynamo.enviar.bind(dynamo);
  const spy = jest
    .spyOn(dynamo, 'enviar')
    .mockImplementation(async (comando, opcoes) => {
      if (comando instanceof TransactWriteItemsCommand) {
        await barreira.aguardarNaTransacao();
      }
      return enviarOriginal(comando, opcoes);
    });

  return {
    barreira,
    restaurar: () => {
      spy.mockRestore();
      barreira.liberar();
    },
  };
}

export async function executarComBarreiraTransacao(
  dynamo: DynamoDbClientProvider,
  operacoes: Array<() => Promise<unknown>>,
): Promise<void> {
  const { restaurar } = instalarBarreiraTransacao(dynamo);
  try {
    await Promise.allSettled(operacoes.map((op) => op()));
  } finally {
    restaurar();
  }
}
