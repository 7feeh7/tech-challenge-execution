import { DomainError } from '@/shared/exceptions/domain.error';

export class TransacaoAninhadaError extends DomainError {
  constructor() {
    super('Transação aninhada não permitida (D3.16).');
  }
}
