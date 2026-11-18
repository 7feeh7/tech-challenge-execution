/**
 * Pior caso operacional do Execution (E25). Valores padrão alinhados ao ConfigMap de produção.
 * O prazo de cada operação AWS usa o deadline configurável imposto via AbortSignal.
 */

export const MARGEM_OPERACIONAL_MS = 30_000;

export const LOTE_CONSUMIDOR_PADRAO = 3;
export const LOTE_OUTBOX_PADRAO = 5;

export const TENTATIVAS_PROCESSAR_MENSAGEM = 2;
export const TENTATIVAS_CONFLITO_TRANSACIONAL = 3;
export const AWS_SDK_MAX_ATTEMPTS_PADRAO = 3;

/**
 * Listagem GSI: uma página com `Limit >= max(2*lote, 25)` cobre o lote padrão;
 * o teto evita paginação ilimitada quando o filtro esvazia páginas inteiras.
 */
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
  cicloOutboxPiorCasoMs: number;
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
  const paginasGsiPiorCaso = params.outboxGsiMaxPaginas ?? 1;
  const listagemOutboxPiorCasoMs =
    paginasGsiPiorCaso * params.dynamodbOperationDeadlineMs;
  const cicloOutboxPiorCasoMs =
    listagemOutboxPiorCasoMs +
    params.dynamodbOperationDeadlineMs * 2 +
    params.loteOutbox * tempoItemOutboxMs;

  const requisicaoDiagnosticoPiorCasoMs =
    TENTATIVAS_CONFLITO_TRANSACIONAL * params.dynamodbOperationDeadlineMs * 2 +
    params.osRequestTimeoutMs;

  // Encerramento: consumidor e publicador drenam ciclos em paralelo (onModuleDestroy);
  // requisição HTTP do diagnóstico pode estar em andamento no mesmo pod.
  const shutdownPiorCasoMs =
    Math.max(cicloConsumidorPiorCasoMs, cicloOutboxPiorCasoMs) +
    params.osRequestTimeoutMs +
    margem;

  const visibilityTimeoutSecondsMinimo = Math.ceil(
    (cicloConsumidorPiorCasoMs + margem) / 1000,
  );

  const terminationGracePeriodSecondsMinimo = Math.ceil(
    shutdownPiorCasoMs / 1000,
  );

  const outboxReivindicacaoMsMinimo = cicloOutboxPiorCasoMs + margem;

  return {
    tempoTransacaoPorMensagemMs,
    tempoMensagemSucessoMs,
    tempoMensagemErroPermanenteMs,
    cicloConsumidorPiorCasoMs,
    cicloOutboxPiorCasoMs,
    requisicaoDiagnosticoPiorCasoMs,
    shutdownPiorCasoMs,
    visibilityTimeoutSecondsMinimo,
    terminationGracePeriodSecondsMinimo,
    outboxReivindicacaoMsMinimo,
  };
}
