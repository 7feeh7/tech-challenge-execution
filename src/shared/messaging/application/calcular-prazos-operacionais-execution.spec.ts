import { calcularPrazosOperacionaisExecution } from './calcular-prazos-operacionais-execution';

describe('calcularPrazosOperacionaisExecution', () => {
  it('calcula limites coerentes com os padrões de produção', () => {
    const resultado = calcularPrazosOperacionaisExecution({
      dynamodbOperationDeadlineMs: 12_000,
      sqsOperationDeadlineMs: 45_000,
      sqsLongPollSeconds: 10,
      osRequestTimeoutMs: 3_000,
      loteConsumidor: 3,
      loteOutbox: 5,
      outboxReivindicacaoMs: 480_000,
    });

    expect(resultado.tempoMensagemErroPermanenteMs).toBeGreaterThan(
      resultado.tempoMensagemSucessoMs,
    );
    expect(resultado.cicloConsumidorPiorCasoMs).toBeGreaterThan(500_000);
    expect(resultado.visibilityTimeoutSecondsMinimo).toBeGreaterThanOrEqual(
      696,
    );
    expect(resultado.outboxReivindicacaoMsMinimo).toBeLessThan(480_000);
  });
});
