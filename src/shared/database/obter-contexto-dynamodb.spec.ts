import { ContextoTransacaoInvalidoError } from './contexto-transacao-invalido.error';
import { obterContextoDynamodb } from './obter-contexto-dynamodb';
import { ContextoTransacaoFake } from './unit-of-work-fake';

describe('obterContextoDynamodb', () => {
  it('rejeita contexto de outro adaptador', () => {
    expect(() => obterContextoDynamodb(new ContextoTransacaoFake())).toThrow(
      ContextoTransacaoInvalidoError,
    );
  });
});
