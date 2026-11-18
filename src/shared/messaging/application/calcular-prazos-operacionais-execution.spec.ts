import {
  AWS_SDK_MAX_ATTEMPTS_PADRAO,
  calcularPrazosOperacionaisExecution,
} from './calcular-prazos-operacionais-execution';

const PARAMETROS_PADRAO = {
  dynamodbOperationDeadlineMs: 12_000,
  sqsOperationDeadlineMs: 45_000,
  sqsLongPollSeconds: 10,
  osRequestTimeoutMs: 3_000,
  loteConsumidor: 3,
  loteOutbox: 5,
  outboxReivindicacaoMs: 480_000,
  awsSdkMaxAttempts: AWS_SDK_MAX_ATTEMPTS_PADRAO,
};

describe('calcularPrazosOperacionaisExecution', () => {
  it('calcula limites coerentes com os padrões de produção', () => {
    const resultado = calcularPrazosOperacionaisExecution(PARAMETROS_PADRAO);

    expect(resultado.tempoMensagemErroPermanenteMs).toBeGreaterThan(
      resultado.tempoMensagemSucessoMs,
    );
    expect(resultado.cicloConsumidorPiorCasoMs).toBe(666_000);
    expect(resultado.cicloOutboxPiorCasoMs).toBe(441_000);
    expect(resultado.requisicaoDiagnosticoPiorCasoMs).toBe(75_000);
    expect(resultado.visibilityTimeoutSecondsMinimo).toBe(696);
    expect(resultado.shutdownPiorCasoMs).toBe(699_000);
    expect(resultado.terminationGracePeriodSecondsMinimo).toBe(699);
    expect(resultado.outboxReivindicacaoMsMinimo).toBe(471_000);
    expect(720_000).toBeGreaterThanOrEqual(
      resultado.terminationGracePeriodSecondsMinimo * 1000,
    );
    expect(720).toBeGreaterThanOrEqual(
      resultado.visibilityTimeoutSecondsMinimo,
    );
    expect(480_000).toBeGreaterThanOrEqual(
      resultado.outboxReivindicacaoMsMinimo,
    );
  });
});
