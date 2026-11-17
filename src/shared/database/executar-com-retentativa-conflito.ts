import { ConflitoTransacionalError } from './conflito-transacional.error';

/**
 * Repete a operação inteira (nova leitura incluída) quando a escrita condicional
 * perde a corrida com outra instância (D5.2).
 */
export async function executarComRetentativaConflito<T>(
  operacao: () => Promise<T>,
  tentativas = 3,
): Promise<T> {
  let ultimoConflito: ConflitoTransacionalError | undefined;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await operacao();
    } catch (erro) {
      if (!(erro instanceof ConflitoTransacionalError)) throw erro;
      ultimoConflito = erro;
    }
  }
  throw ultimoConflito;
}
