import { DomainError } from '@/shared/exceptions/domain.error';

export class ConflitoTransacionalError extends DomainError {
  constructor(mensagem: string) {
    super(mensagem);
  }
}
