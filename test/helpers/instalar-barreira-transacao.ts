import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { BarreiraOrdenada, comRotulo } from './barreira-transacao-dynamodb';

export function instalarBarreiraOrdenada(
  dynamo: DynamoDbClientProvider,
  ordem: readonly [primeiro: string, segundo: string],
): { barreira: BarreiraOrdenada; restaurar: () => void } {
  const barreira = new BarreiraOrdenada(ordem[0], ordem[1]);
  const enviarOriginal = dynamo.enviar.bind(dynamo);
  const spy = jest
    .spyOn(dynamo, 'enviar')
    .mockImplementation(async (comando, opcoes) => {
      if (comando instanceof TransactWriteItemsCommand) {
        return barreira.passar(() => enviarOriginal(comando, opcoes));
      }
      return enviarOriginal(comando, opcoes);
    });

  return {
    barreira,
    restaurar: () => {
      spy.mockRestore();
      barreira.liberarTudo();
    },
  };
}

export type ResultadosPorRotulo = Record<string, PromiseSettledResult<unknown>>;

/**
 * Executa as operações concorrentes (identificadas por rótulo) com as duas leituras antes
 * de qualquer escrita e a escrita na ordem `ordem`: a primeira conclui o envio antes de a
 * segunda ser liberada.
 */
export async function executarEmOrdem(
  dynamo: DynamoDbClientProvider,
  ordem: readonly [primeiro: string, segundo: string],
  operacoes: Record<string, () => Promise<unknown>>,
): Promise<ResultadosPorRotulo> {
  const { barreira, restaurar } = instalarBarreiraOrdenada(dynamo, ordem);
  try {
    const rotulos = Object.keys(operacoes);
    const promessas = rotulos.map((rotulo) =>
      comRotulo(rotulo, () => (operacoes[rotulo] as () => Promise<unknown>)()),
    );
    const conducao = barreira.conduzir(promessas);
    const resultados = await Promise.allSettled(promessas);
    await conducao;
    return Object.fromEntries(
      rotulos.map((rotulo, i) => [rotulo, resultados[i]]),
    ) as ResultadosPorRotulo;
  } finally {
    restaurar();
  }
}
