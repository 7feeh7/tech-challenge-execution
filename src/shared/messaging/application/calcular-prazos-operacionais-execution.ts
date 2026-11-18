/**
 * Pior caso operacional do Execution (E25). Valores padrão alinhados ao ConfigMap de produção.
 * O prazo de cada operação AWS usa o deadline configurável imposto via AbortSignal.
 */

export const MARGEM_OPERACIONAL_MS = 30_000;

export const LOTE_CONSUMIDOR_PADRAO = 3;
export const LOTE_OUTBOX_PADRAO = 5;

export const TENTATIVAS_PROCESSAR_MENSAGEM = 2;
export const TENTATIVAS_CONFLITO_TRANSACIONAL = 3;
/** Leitura + TransactWriteItems por unidade de trabalho com retentativa de conflito. */
export const OPERACOES_DYNAMODB_POR_UOW_CONFLITO = 2;
export const AWS_SDK_MAX_ATTEMPTS_PADRAO = 3;

export const OUTBOX_GSI_MAX_PAGINAS_PADRAO = 8;

export interface ParametrosPrazosExecution {
  dynamodbOperationDeadlineMs: number;
  sqsOperationDeadlineMs: number;
  sqsLongPollSeconds: number;
  osRequestTimeoutMs: number;
  loteConsumidor: number;
  loteOutbox: number;
  outboxGsiMaxPaginas?: number;
  outboxReivindicacaoMs: number;
  awsSdkMaxAttempts?: number;
  margemMs?: number;
}

export interface ResultadoPrazosExecution {
  tempoTransacaoPorMensagemMs: number;
  tempoMensagemSucessoMs: number;
  tempoMensagemErroPermanenteMs: number;
  cicloConsumidorPiorCasoMs: number;
  listagemOutboxPiorCasoMs: number;
  contagemBacklogPiorCasoMs: number;
  cicloOutboxPiorCasoMs: number;
  duracaoLeaseOutboxPiorCasoMs: number;
  requisicaoDiagnosticoPiorCasoMs: number;
  shutdownPiorCasoMs: number;
  visibilityTimeoutSecondsMinimo: number;
  terminationGracePeriodSecondsMinimo: number;
  outboxReivindicacaoMsMinimo: number;
}

export function calcularPrazosOperacionaisExecution(
  params: ParametrosPrazosExecution,
): ResultadoPrazosExecution {
  const margem = params.margemMs ?? MARGEM_OPERACIONAL_MS;
  const paginasGsi =
    params.outboxGsiMaxPaginas ?? OUTBOX_GSI_MAX_PAGINAS_PADRAO;

  const transacoesPorMensagem =
    TENTATIVAS_PROCESSAR_MENSAGEM * TENTATIVAS_CONFLITO_TRANSACIONAL;
  const tempoTransacaoPorMensagemMs =
    transacoesPorMensagem * params.dynamodbOperationDeadlineMs;

  const tempoMensagemSucessoMs =
    tempoTransacaoPorMensagemMs + params.sqsOperationDeadlineMs;

  const tempoMensagemErroPermanenteMs =
    tempoMensagemSucessoMs + params.sqsOperationDeadlineMs * 2;

  const cicloConsumidorPiorCasoMs =
    params.sqsOperationDeadlineMs +
    params.loteConsumidor * tempoMensagemErroPermanenteMs;

  const tempoItemOutboxMs =
    params.dynamodbOperationDeadlineMs * 3 + params.sqsOperationDeadlineMs;

  const listagemOutboxPiorCasoMs =
    paginasGsi * params.dynamodbOperationDeadlineMs;
  const contagemBacklogPiorCasoMs =
    paginasGsi * params.dynamodbOperationDeadlineMs;
  const reivindicacaoOutboxPiorCasoMs =
    params.loteOutbox * params.dynamodbOperationDeadlineMs;

  const cicloOutboxPiorCasoMs =
    listagemOutboxPiorCasoMs +
    reivindicacaoOutboxPiorCasoMs +
    params.loteOutbox * tempoItemOutboxMs +
    contagemBacklogPiorCasoMs;

  const duracaoLeaseOutboxPiorCasoMs = params.loteOutbox * tempoItemOutboxMs;

  const tempoUowDiagnosticoMs =
    TENTATIVAS_CONFLITO_TRANSACIONAL *
    OPERACOES_DYNAMODB_POR_UOW_CONFLITO *
    params.dynamodbOperationDeadlineMs;

  const requisicaoDiagnosticoPiorCasoMs =
    tempoUowDiagnosticoMs * 2 + params.osRequestTimeoutMs;

  const drenagemMensageriaMs = Math.max(
    cicloConsumidorPiorCasoMs,
    cicloOutboxPiorCasoMs,
  );

  const shutdownPiorCasoMs =
    drenagemMensageriaMs + requisicaoDiagnosticoPiorCasoMs + margem;

  const visibilityTimeoutSecondsMinimo = Math.ceil(
    (cicloConsumidorPiorCasoMs + margem) / 1000,
  );

  const terminationGracePeriodSecondsMinimo = Math.ceil(
    shutdownPiorCasoMs / 1000,
  );

  const outboxReivindicacaoMsMinimo = duracaoLeaseOutboxPiorCasoMs + margem;

  return {
    tempoTransacaoPorMensagemMs,
    tempoMensagemSucessoMs,
    tempoMensagemErroPermanenteMs,
    cicloConsumidorPiorCasoMs,
    listagemOutboxPiorCasoMs,
    contagemBacklogPiorCasoMs,
    cicloOutboxPiorCasoMs,
    duracaoLeaseOutboxPiorCasoMs,
    requisicaoDiagnosticoPiorCasoMs,
    shutdownPiorCasoMs,
    visibilityTimeoutSecondsMinimo,
    terminationGracePeriodSecondsMinimo,
    outboxReivindicacaoMsMinimo,
  };
}
