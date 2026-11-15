import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import {
  DomainConflictError,
  DomainError,
  DomainNotFoundError,
  DomainUnauthorizedError,
  DomainValidationError,
} from '../exceptions/domain.error';
import { DomainExceptionFilter } from './domain-exception.filter';

class ErroValidacaoTeste extends DomainValidationError {
  constructor() {
    super('validação inválida');
  }
}

class ErroNaoEncontradoTeste extends DomainNotFoundError {
  constructor() {
    super('recurso ausente');
  }
}

class ErroConflitoTeste extends DomainConflictError {
  constructor() {
    super('conflito');
  }
}

class ErroNaoAutorizadoTeste extends DomainUnauthorizedError {
  constructor() {
    super('não autorizado');
  }
}

class ErroGenericoTeste extends DomainError {
  constructor() {
    super('erro interno');
  }
}

describe('DomainExceptionFilter', () => {
  const reply = jest.fn();
  const response = Symbol('response');
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  const filter = new DomainExceptionFilter({
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost);

  const statusRespondido = () => reply.mock.calls[0][2] as number;

  beforeEach(() => jest.clearAllMocks());

  it('traduz erro de validação para 400', () => {
    filter.catch(new ErroValidacaoTeste(), host);
    expect(statusRespondido()).toBe(400);
  });

  it('traduz erro de recurso inexistente para 404', () => {
    filter.catch(new ErroNaoEncontradoTeste(), host);
    expect(statusRespondido()).toBe(404);
  });

  it('traduz erro de conflito para 409', () => {
    filter.catch(new ErroConflitoTeste(), host);
    expect(statusRespondido()).toBe(409);
  });

  it('traduz erro de credenciais para 401', () => {
    filter.catch(new ErroNaoAutorizadoTeste(), host);
    expect(statusRespondido()).toBe(401);
  });

  it('traduz erro genérico de domínio para 500', () => {
    filter.catch(new ErroGenericoTeste(), host);
    expect(statusRespondido()).toBe(500);
  });
});
