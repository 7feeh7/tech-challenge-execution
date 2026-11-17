import { DomainError } from '@/shared/exceptions/domain.error';

export class LimiteTransacaoExcedidoError extends DomainError {
  readonly codigo = 'LIMITE_TRANSACAO_EXCEDIDO';

  constructor(quantidade: number, limite: number) {
    super(
      `Transação excede o limite de ${limite} escritas (recebidas: ${quantidade}).`,
    );
  }
}
