import {
  type CancellationReason,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { ConflitoTransacionalError } from './conflito-transacional.error';

export class ConflitoMensagemProcessadaError extends ConflitoTransacionalError {
  constructor() {
    super('Conflito ao registrar mensagem processada.');
  }
}

export function ehConflitoMensagemProcessada(erro: unknown): boolean {
  return erro instanceof ConflitoMensagemProcessadaError;
}

export function mapearErroTransacaoDynamodb(erro: unknown): never {
  if (erro instanceof TransactionCanceledException) {
    const razoes = erro.CancellationReasons ?? [];
    if (possuiFalhaCondicional(razoes)) {
      if (indicaConflitoMensagemProcessada(razoes)) {
        throw new ConflitoMensagemProcessadaError();
      }
      throw new ConflitoTransacionalError(
        'Operação transacional recusada por condição.',
      );
    }
    throw new ConflitoTransacionalError(
      erro.message || 'Transação DynamoDB cancelada.',
    );
  }
  throw erro;
}

function possuiFalhaCondicional(razoes: CancellationReason[]): boolean {
  return razoes.some((r) => r.Code === 'ConditionalCheckFailed');
}

function indicaConflitoMensagemProcessada(
  razoes: CancellationReason[],
): boolean {
  return razoes.some(
    (r) =>
      r.Code === 'ConditionalCheckFailed' &&
      (r.Item?.eventId !== undefined || r.Item?.hashConteudo !== undefined),
  );
}
