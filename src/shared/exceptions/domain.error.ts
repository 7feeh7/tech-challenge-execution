/**
 * Base das exceções de domínio. O domínio lança estes erros sem conhecer HTTP;
 * o DomainExceptionFilter traduz cada categoria para o status correspondente.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invariante de domínio violada. */
export abstract class DomainValidationError extends DomainError {}

/** Recurso inexistente. */
export abstract class DomainNotFoundError extends DomainError {}

/** Conflito com o estado atual. */
export abstract class DomainConflictError extends DomainError {}

/** Credenciais ausentes ou inválidas. */
export abstract class DomainUnauthorizedError extends DomainError {}

/** Requisição bem formada, mas recusada por regra de negócio de outro serviço. */
export abstract class DomainUnprocessableError extends DomainError {}

/** Dependência externa sem resposta definitiva; a operação pode ser repetida. */
export abstract class DomainUnavailableError extends DomainError {}
