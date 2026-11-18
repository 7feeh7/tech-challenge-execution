import { resolverDeadlineOperacaoAws } from './resolver-deadline-operacao-aws';

describe('resolverDeadlineOperacaoAws', () => {
  it('usa o deadline explícito, independentemente das tentativas', () => {
    expect(
      resolverDeadlineOperacaoAws({
        deadlineExplicito: '15000',
        httpAttemptTimeoutMs: 4000,
        maxAttempts: 10,
      }),
    ).toBe(15000);
  });

  it('deriva timeout da tentativa × tentativas quando o deadline está ausente', () => {
    expect(
      resolverDeadlineOperacaoAws({
        httpAttemptTimeoutMs: 4000,
        maxAttempts: 10,
      }),
    ).toBe(40000);
  });

  it('volta ao valor derivado quando o deadline informado não é finito', () => {
    expect(
      resolverDeadlineOperacaoAws({
        deadlineExplicito: 'abc',
        httpAttemptTimeoutMs: 4000,
        maxAttempts: 3,
      }),
    ).toBe(12000);
  });
});
