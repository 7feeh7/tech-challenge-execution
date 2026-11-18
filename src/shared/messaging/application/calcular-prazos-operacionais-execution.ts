/**
 * Pior caso operacional do Execution (E25). Valores padrão alinhados ao ConfigMap de produção.
 * Cada termo vem do caminho realmente executado no código; o prazo de cada operação AWS é o
 * deadline imposto por `AbortSignal`, que cobre as tentativas internas do SDK.
 */

export const MARGEM_OPERACIONAL_MS = 30_000;

export const LOTE_CONSUMIDOR_PADRAO = 3;
export const LOTE_OUTBOX_PADRAO = 5;

/** `ProcessarMensagemEntradaService` repete a transação uma vez após conflito. */
export const TENTATIVAS_PROCESSAR_MENSAGEM = 2;
/** `executarComRetentativaConflito` nos fluxos HTTP. */
export const TENTATIVAS_CONFLITO_TRANSACIONAL = 3;
export const AWS_SDK_MAX_ATTEMPTS_PADRAO = 3;

/**
 * Operações DynamoDB de uma execução da transação do consumidor: `jaProcessada`,
 * as duas leituras do cancelamento sem tarefa (`existeRegistro` e `buscarPorId`; leitura nula
 * não entra no cache do contexto) e o `TransactWriteItems`.
 */
export const OPERACOES_DYNAMODB_POR_EXECUCAO_CONSUMIDOR = 4;
/** Fluxos HTTP: leitura da tarefa (`buscarPorId`) e `TransactWriteItems` por tentativa. */
export const OPERACOES_DYNAMODB_POR_TENTATIVA_HTTP = 2;
/** `TarefaResponsavelGuard`: um `GetItem` (`buscarResponsavel`) antes do caso de uso. */
export const OPERACOES_DYNAMODB_GUARD_RESPONSAVEL = 1;
/** Envio da outbox: `confirmarEnvio` e, se ele falhar, `liberarAposFalha`. */
export const OPERACOES_DYNAMODB_POR_ITEM_OUTBOX = 2;

export const OUTBOX_GSI_MAX_PAGINAS_PADRAO = 8;

/** Default do lease da outbox quando `OUTBOX_REIVINDICACAO_MS` não é informado; publicador e validação usam o mesmo. */
export const OUTBOX_REIVINDICACAO_MS_PADRAO = 300_000;

/**
 * Default de `keepAliveTimeout` do Fastify 5. A conexão que estava ocupada com uma requisição
 * no `close()` só é fechada ao atingir esse tempo de ociosidade, então o fechamento do HTTP
 * pode durar até esse prazo depois da última resposta.
 */
export const FASTIFY_KEEP_ALIVE_TIMEOUT_MS = 72_000;

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
  tempoExecucaoTransacaoConsumidorMs: number;
  tempoTransacaoPorMensagemMs: number;
  tempoMensagemSucessoMs: number;
  tempoMensagemErroPermanenteMs: number;
  cicloConsumidorPiorCasoMs: number;
  listagemOutboxPiorCasoMs: number;
  reivindicacaoOutboxPiorCasoMs: number;
  tempoItemOutboxMs: number;
  contagemBacklogPiorCasoMs: number;
  cicloOutboxPiorCasoMs: number;
  duracaoLeaseOutboxPiorCasoMs: number;
  tempoGuardResponsavelMs: number;
  tempoUowHttpMs: number;
  requisicaoDiagnosticoPiorCasoMs: number;
  drenagemMensageriaMs: number;
  keepAliveHttpMs: number;
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
  const dynamo = params.dynamodbOperationDeadlineMs;
  const sqs = params.sqsOperationDeadlineMs;

  const tempoExecucaoTransacaoConsumidorMs =
    OPERACOES_DYNAMODB_POR_EXECUCAO_CONSUMIDOR * dynamo;
  const tempoTransacaoPorMensagemMs =
    TENTATIVAS_PROCESSAR_MENSAGEM * tempoExecucaoTransacaoConsumidorMs;

  // Sucesso: transação e confirmação. Erro permanente: transação, envio à DLQ e
  // confirmação (erro da AWS na confirmação é transitório e não vai à DLQ).
  const tempoMensagemSucessoMs = tempoTransacaoPorMensagemMs + sqs;
  const tempoMensagemErroPermanenteMs = tempoTransacaoPorMensagemMs + sqs * 2;

  const cicloConsumidorPiorCasoMs =
    sqs + params.loteConsumidor * tempoMensagemErroPermanenteMs;

  const listagemOutboxPiorCasoMs = paginasGsi * dynamo;
  const contagemBacklogPiorCasoMs = paginasGsi * dynamo;
  const reivindicacaoOutboxPiorCasoMs = params.loteOutbox * dynamo;

  // Envio (SQS) e, no pior caso, `confirmarEnvio` falhando seguido de `liberarAposFalha`.
  const tempoItemOutboxMs = sqs + OPERACOES_DYNAMODB_POR_ITEM_OUTBOX * dynamo;

  // O `bloqueadoAte` é calculado depois da listagem e antes do laço de reivindicação:
  // reivindicar o lote inteiro consome o lease antes do primeiro envio.
  const duracaoLeaseOutboxPiorCasoMs =
    reivindicacaoOutboxPiorCasoMs + params.loteOutbox * tempoItemOutboxMs;

  const cicloOutboxPiorCasoMs =
    listagemOutboxPiorCasoMs +
    duracaoLeaseOutboxPiorCasoMs +
    contagemBacklogPiorCasoMs;

  const tempoGuardResponsavelMs = OPERACOES_DYNAMODB_GUARD_RESPONSAVEL * dynamo;
  const tempoUowHttpMs =
    TENTATIVAS_CONFLITO_TRANSACIONAL *
    OPERACOES_DYNAMODB_POR_TENTATIVA_HTTP *
    dynamo;

  // Conclusão do diagnóstico por não administrador: guard, gravação do payload
  // pendente, chamada ao OS e aplicação do resultado (cada fase com até 3 tentativas).
  const requisicaoDiagnosticoPiorCasoMs =
    tempoGuardResponsavelMs +
    tempoUowHttpMs +
    params.osRequestTimeoutMs +
    tempoUowHttpMs;

  const drenagemMensageriaMs = Math.max(
    cicloConsumidorPiorCasoMs,
    cicloOutboxPiorCasoMs,
  );

  const shutdownPiorCasoMs =
    drenagemMensageriaMs +
    requisicaoDiagnosticoPiorCasoMs +
    FASTIFY_KEEP_ALIVE_TIMEOUT_MS +
    margem;

  const visibilityTimeoutSecondsMinimo = Math.ceil(
    (cicloConsumidorPiorCasoMs + margem) / 1000,
  );

  const terminationGracePeriodSecondsMinimo = Math.ceil(
    shutdownPiorCasoMs / 1000,
  );

  const outboxReivindicacaoMsMinimo = duracaoLeaseOutboxPiorCasoMs + margem;

  return {
    tempoExecucaoTransacaoConsumidorMs,
    tempoTransacaoPorMensagemMs,
    tempoMensagemSucessoMs,
    tempoMensagemErroPermanenteMs,
    cicloConsumidorPiorCasoMs,
    listagemOutboxPiorCasoMs,
    reivindicacaoOutboxPiorCasoMs,
    tempoItemOutboxMs,
    contagemBacklogPiorCasoMs,
    cicloOutboxPiorCasoMs,
    duracaoLeaseOutboxPiorCasoMs,
    tempoGuardResponsavelMs,
    tempoUowHttpMs,
    requisicaoDiagnosticoPiorCasoMs,
    drenagemMensageriaMs,
    keepAliveHttpMs: FASTIFY_KEEP_ALIVE_TIMEOUT_MS,
    shutdownPiorCasoMs,
    visibilityTimeoutSecondsMinimo,
    terminationGracePeriodSecondsMinimo,
    outboxReivindicacaoMsMinimo,
  };
}
