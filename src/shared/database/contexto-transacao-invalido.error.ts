import { DomainError } from '@/shared/exceptions/domain.error';

export class ContextoTransacaoInvalidoError extends DomainError {
  constructor() {
    super('Contexto de transação inválido ou de outro adaptador.');
  }
}
