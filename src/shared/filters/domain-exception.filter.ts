import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  type ExceptionFilter,
  type HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  DomainConflictError,
  DomainError,
  DomainNotFoundError,
  DomainUnauthorizedError,
  DomainUnavailableError,
  DomainUnprocessableError,
  DomainValidationError,
} from '../exceptions/domain.error';

/**
 * Traduz erros de domínio em respostas HTTP. Mantém o núcleo da aplicação
 * livre de qualquer dependência do Nest.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(error: DomainError, host: ArgumentsHost): void {
    const excecao = DomainExceptionFilter.paraExcecaoHttp(error);
    const { httpAdapter } = this.httpAdapterHost;

    httpAdapter.reply(
      host.switchToHttp().getResponse(),
      excecao.getResponse(),
      excecao.getStatus(),
    );
  }

  private static paraExcecaoHttp(error: DomainError): HttpException {
    if (error instanceof DomainValidationError) {
      return new BadRequestException(error.message);
    }
    if (error instanceof DomainNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof DomainConflictError) {
      return new ConflictException(error.message);
    }
    if (error instanceof DomainUnauthorizedError) {
      return new UnauthorizedException(error.message);
    }
    if (error instanceof DomainUnprocessableError) {
      return new UnprocessableEntityException(error.message);
    }
    if (error instanceof DomainUnavailableError) {
      return new ServiceUnavailableException(error.message);
    }
    return new InternalServerErrorException(error.message);
  }
}
