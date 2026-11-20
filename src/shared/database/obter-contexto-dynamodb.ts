import { ContextoTransacaoInvalidoError } from './contexto-transacao-invalido.error';
import { DynamoDbContextoTransacao } from './dynamodb-contexto-transacao';
import type { ContextoTransacao } from './unit-of-work.port';

export function obterContextoDynamodb(
  contexto: ContextoTransacao,
): DynamoDbContextoTransacao {
  if (!(contexto instanceof DynamoDbContextoTransacao)) {
    throw new ContextoTransacaoInvalidoError();
  }
  return contexto;
}
