import {
  AWS_SDK_MAX_ATTEMPTS_PADRAO,
  calcularPrazosOperacionaisExecution,
  type ParametrosPrazosExecution,
} from './calcular-prazos-operacionais-execution';

const PARAMETROS_PADRAO: ParametrosPrazosExecution = {
  dynamodbOperationDeadlineMs: 12_000,
  sqsOperationDeadlineMs: 45_000,
  sqsLongPollSeconds: 10,
  osRequestTimeoutMs: 3_000,
  loteConsumidor: 3,
  loteOutbox: 5,
  outboxGsiMaxPaginas: 8,
  outboxReivindicacaoMs: 480_000,
  awsSdkMaxAttempts: AWS_SDK_MAX_ATTEMPTS_PADRAO,
};

describe('calcularPrazosOperacionaisExecution', () => {
  it('calcula cada termo do consumidor a partir das operações reais por execução', () => {
    const resultado = calcularPrazosOperacionaisExecution(PARAMETROS_PADRAO);

    // jaProcessada + existeRegistro + buscarPorId + TransactWriteItems = 4 × 12000
    expect(resultado.tempoExecucaoTransacaoConsumidorMs).toBe(48_000);
    // até 2 execuções por mensagem (sem executarComRetentativaConflito)
    expect(resultado.tempoTransacaoPorMensagemMs).toBe(96_000);
    expect(resultado.tempoMensagemSucessoMs).toBe(141_000);
    // transação + envio à DLQ + confirmação
    expect(resultado.tempoMensagemErroPermanenteMs).toBe(186_000);
    expect(resultado.tempoMensagemErroPermanenteMs).toBeGreaterThan(
      resultado.tempoMensagemSucessoMs,
    );
    expect(resultado.cicloConsumidorPiorCasoMs).toBe(603_000);
    expect(resultado.visibilityTimeoutSecondsMinimo).toBe(633);
  });

  it('calcula o publicador com reivindicação dentro do lease e contagem limitada', () => {
    const resultado = calcularPrazosOperacionaisExecution(PARAMETROS_PADRAO);

    expect(resultado.listagemOutboxPiorCasoMs).toBe(96_000);
    expect(resultado.reivindicacaoOutboxPiorCasoMs).toBe(60_000);
    // envio SQS + confirmarEnvio falhando + liberarAposFalha
    expect(resultado.tempoItemOutboxMs).toBe(69_000);
    expect(resultado.duracaoLeaseOutboxPiorCasoMs).toBe(405_000);
    expect(resultado.contagemBacklogPiorCasoMs).toBe(96_000);
    expect(resultado.cicloOutboxPiorCasoMs).toBe(597_000);
    expect(resultado.outboxReivindicacaoMsMinimo).toBe(435_000);
  });

  it('inclui o GetItem do guard no pior caso da requisição de diagnóstico', () => {
    const resultado = calcularPrazosOperacionaisExecution(PARAMETROS_PADRAO);

    expect(resultado.tempoGuardResponsavelMs).toBe(12_000);
    expect(resultado.tempoUowHttpMs).toBe(72_000);
    // guard + gravar pendente + OS + aplicar resultado
    expect(resultado.requisicaoDiagnosticoPiorCasoMs).toBe(159_000);
  });

  it('soma drenagem, requisição HTTP, keep-alive do Fastify e margem no encerramento', () => {
    const resultado = calcularPrazosOperacionaisExecution(PARAMETROS_PADRAO);

    expect(resultado.drenagemMensageriaMs).toBe(603_000);
    expect(resultado.keepAliveHttpMs).toBe(72_000);
    // 603000 + 159000 + 72000 + 30000
    expect(resultado.shutdownPiorCasoMs).toBe(864_000);
    expect(resultado.terminationGracePeriodSecondsMinimo).toBe(864);
    expect(870).toBeGreaterThanOrEqual(
      resultado.terminationGracePeriodSecondsMinimo,
    );
    expect(720).toBeGreaterThanOrEqual(
      resultado.visibilityTimeoutSecondsMinimo,
    );
    expect(480_000).toBeGreaterThanOrEqual(
      resultado.outboxReivindicacaoMsMinimo,
    );
  });

  it('escala a listagem e a contagem com OUTBOX_GSI_MAX_PAGINAS', () => {
    const resultado = calcularPrazosOperacionaisExecution({
      ...PARAMETROS_PADRAO,
      outboxGsiMaxPaginas: 1,
    });

    expect(resultado.listagemOutboxPiorCasoMs).toBe(12_000);
    expect(resultado.contagemBacklogPiorCasoMs).toBe(12_000);
    expect(resultado.cicloOutboxPiorCasoMs).toBe(12_000 + 405_000 + 12_000);
    expect(resultado.duracaoLeaseOutboxPiorCasoMs).toBe(405_000);
  });

  it('usa a drenagem do publicador quando ele supera o consumidor', () => {
    const resultado = calcularPrazosOperacionaisExecution({
      ...PARAMETROS_PADRAO,
      loteConsumidor: 1,
      loteOutbox: 10,
    });

    expect(resultado.cicloConsumidorPiorCasoMs).toBe(45_000 + 186_000);
    expect(resultado.cicloOutboxPiorCasoMs).toBe(
      96_000 + 120_000 + 690_000 + 96_000,
    );
    expect(resultado.drenagemMensageriaMs).toBe(
      resultado.cicloOutboxPiorCasoMs,
    );
    expect(resultado.duracaoLeaseOutboxPiorCasoMs).toBe(120_000 + 690_000);
  });

  it('respeita a margem informada', () => {
    const resultado = calcularPrazosOperacionaisExecution({
      ...PARAMETROS_PADRAO,
      margemMs: 0,
    });

    expect(resultado.outboxReivindicacaoMsMinimo).toBe(405_000);
    expect(resultado.shutdownPiorCasoMs).toBe(603_000 + 159_000 + 72_000);
    expect(resultado.visibilityTimeoutSecondsMinimo).toBe(603);
  });
});
