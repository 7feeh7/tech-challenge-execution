import {
  AWS_SDK_MAX_ATTEMPTS_PADRAO,
  calcularPrazosOperacionaisExecution,
  MARGEM_OPERACIONAL_MS,
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
    expect(resultado.visibilityTimeoutSecondsMinimo).toBe(696);
    expect(resultado.outboxReivindicacaoMsMinimo).toBeLessThan(480_000);
    expect(resultado.shutdownPiorCasoMs).toBe(
      Math.max(
        resultado.cicloConsumidorPiorCasoMs,
        resultado.cicloOutboxPiorCasoMs,
      ) +
        PARAMETROS_PADRAO.osRequestTimeoutMs +
        MARGEM_OPERACIONAL_MS,
    );
    expect(resultado.terminationGracePeriodSecondsMinimo).toBeLessThanOrEqual(
      720,
    );
  });
});
