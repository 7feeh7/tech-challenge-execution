import { ItemPecaIdInvalidoError } from './errors/tarefa.errors';

const PADRAO_UUID_PECA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validarItemIdPeca(itemId: string): void {
  if (!PADRAO_UUID_PECA.test(itemId)) {
    throw new ItemPecaIdInvalidoError(itemId);
  }
}
