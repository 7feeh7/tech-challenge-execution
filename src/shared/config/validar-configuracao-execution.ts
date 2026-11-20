import { resolverDeadlineOperacaoAws } from '@/shared/aws/resolver-deadline-operacao-aws';
import {
  AWS_SDK_MAX_ATTEMPTS_PADRAO,
  calcularPrazosOperacionaisExecution,
  LOTE_CONSUMIDOR_PADRAO,
  LOTE_OUTBOX_PADRAO,
  OUTBOX_GSI_MAX_PAGINAS_PADRAO,
  OUTBOX_REIVINDICACAO_MS_PADRAO,
} from '@/shared/messaging/application/calcular-prazos-operacionais-execution';
import { ConfiguracaoExecutionInvalidaError } from './configuracao-execution-invalida.error';

export type AmbienteConfiguracao = Record<string, string | undefined>;

const MARCADOR_CHAVE_PUBLICA = 'BEGIN PUBLIC KEY';

function texto(
  ambiente: AmbienteConfiguracao,
  chave: string,
  padrao: string,
): string {
  const bruto = ambiente[chave]?.trim();
  return bruto && bruto.length > 0 ? bruto : padrao;
}

function numeroInteiroPositivo(
  ambiente: AmbienteConfiguracao,
  chave: string,
  padrao?: number,
): number {
  const bruto = ambiente[chave]?.trim();
  if (!bruto) {
    if (padrao === undefined) {
      throw new ConfiguracaoExecutionInvalidaError(
        `${chave}: variável ausente ou vazia.`,
      );
    }
    return padrao;
  }
  if (!/^\d+$/.test(bruto)) {
    throw new ConfiguracaoExecutionInvalidaError(
      `${chave} deve ser inteiro positivo (recebido: valor inválido).`,
    );
  }
  const convertido = Number(bruto);
  if (convertido <= 0) {
    throw new ConfiguracaoExecutionInvalidaError(
      `${chave} deve ser maior que zero (recebido: ${convertido}).`,
    );
  }
  return convertido;
}

/** Mesma derivação do runtime: deadline explícito ou timeout da tentativa × tentativas do SDK. */
function deadlineOperacaoAws(
  ambiente: AmbienteConfiguracao,
  chaveDeadline: string,
  chavesTimeoutTentativa: string[],
  timeoutTentativaPadraoMs: number,
): number {
  const chaveTimeout = chavesTimeoutTentativa.find((chave) =>
    ambiente[chave]?.trim(),
  );
  const explicito = ambiente[chaveDeadline]?.trim();
  return resolverDeadlineOperacaoAws({
    deadlineExplicito: explicito
      ? String(numeroInteiroPositivo(ambiente, chaveDeadline))
      : undefined,
    httpAttemptTimeoutMs: chaveTimeout
      ? numeroInteiroPositivo(ambiente, chaveTimeout)
      : timeoutTentativaPadraoMs,
    maxAttempts: numeroInteiroPositivo(
      ambiente,
      'AWS_SDK_MAX_ATTEMPTS',
      AWS_SDK_MAX_ATTEMPTS_PADRAO,
    ),
  });
}

function deadlineSqs(ambiente: AmbienteConfiguracao): number {
  return deadlineOperacaoAws(
    ambiente,
    'SQS_OPERATION_DEADLINE_MS',
    ['SQS_HTTP_ATTEMPT_TIMEOUT_MS', 'SQS_REQUEST_TIMEOUT_MS'],
    12_000,
  );
}

function exigirPreenchido(
  ambiente: AmbienteConfiguracao,
  chave: string,
  rotulo: string,
): string {
  const valor = ambiente[chave]?.trim();
  if (!valor) {
    throw new ConfiguracaoExecutionInvalidaError(
      `${rotulo}: variável ${chave} ausente ou vazia.`,
    );
  }
  return valor;
}

function exigirChavePem(valor: string, chave: string): void {
  if (!valor.includes(MARCADOR_CHAVE_PUBLICA)) {
    throw new ConfiguracaoExecutionInvalidaError(
      `${chave} não contém PEM válido (esperado "${MARCADOR_CHAVE_PUBLICA}").`,
    );
  }
}

function recusarLegadoHs256(ambiente: AmbienteConfiguracao): void {
  if (ambiente.JWT_SECRET?.trim()) {
    throw new ConfiguracaoExecutionInvalidaError(
      'JWT_SECRET não é mais suportado; use JWT_PUBLIC_KEY (RS256).',
    );
  }
}

function validarFlagTriState(
  ambiente: AmbienteConfiguracao,
  chave: string,
): void {
  const valor = ambiente[chave]?.trim();
  if (!valor) return;
  if (valor !== 'true' && valor !== 'false') {
    throw new ConfiguracaoExecutionInvalidaError(
      `${chave} deve ser "true" ou "false" (recebido: valor inválido).`,
    );
  }
}

function validarCoerenciaPrazos(ambiente: AmbienteConfiguracao): void {
  const reivindicacaoMs = numeroInteiroPositivo(
    ambiente,
    'OUTBOX_REIVINDICACAO_MS',
    OUTBOX_REIVINDICACAO_MS_PADRAO,
  );
  const outboxGsiMaxPaginas = numeroInteiroPositivo(
    ambiente,
    'OUTBOX_GSI_MAX_PAGINAS',
    OUTBOX_GSI_MAX_PAGINAS_PADRAO,
  );

  const prazos = calcularPrazosOperacionaisExecution({
    dynamodbOperationDeadlineMs: deadlineOperacaoAws(
      ambiente,
      'DYNAMODB_OPERATION_DEADLINE_MS',
      ['DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS'],
      4_000,
    ),
    sqsOperationDeadlineMs: deadlineSqs(ambiente),
    sqsLongPollSeconds: numeroInteiroPositivo(
      ambiente,
      'SQS_LONG_POLL_SECONDS',
      10,
    ),
    osRequestTimeoutMs: numeroInteiroPositivo(
      ambiente,
      'OS_REQUEST_TIMEOUT_MS',
      3_000,
    ),
    loteConsumidor: numeroInteiroPositivo(
      ambiente,
      'SQS_CONSUMER_LOTE',
      LOTE_CONSUMIDOR_PADRAO,
    ),
    loteOutbox: numeroInteiroPositivo(
      ambiente,
      'OUTBOX_PUBLISHER_LOTE',
      LOTE_OUTBOX_PADRAO,
    ),
    outboxGsiMaxPaginas,
    outboxReivindicacaoMs: reivindicacaoMs,
  });

  if (reivindicacaoMs < prazos.outboxReivindicacaoMsMinimo) {
    throw new ConfiguracaoExecutionInvalidaError(
      `OUTBOX_REIVINDICACAO_MS (${reivindicacaoMs}) menor que o pior caso do lease (${prazos.outboxReivindicacaoMsMinimo}).`,
    );
  }

  const visibilitySeconds = numeroInteiroPositivo(
    ambiente,
    'SQS_VISIBILITY_TIMEOUT_SECONDS',
    prazos.visibilityTimeoutSecondsMinimo,
  );
  if (visibilitySeconds < prazos.visibilityTimeoutSecondsMinimo) {
    throw new ConfiguracaoExecutionInvalidaError(
      `SQS_VISIBILITY_TIMEOUT_SECONDS (${visibilitySeconds}) menor que o pior caso do consumidor (${prazos.visibilityTimeoutSecondsMinimo}).`,
    );
  }

  const grace = numeroInteiroPositivo(
    ambiente,
    'TERMINATION_GRACE_PERIOD_SECONDS',
    600,
  );
  if (grace < prazos.terminationGracePeriodSecondsMinimo) {
    throw new ConfiguracaoExecutionInvalidaError(
      `TERMINATION_GRACE_PERIOD_SECONDS (${grace}) menor que o pior caso de encerramento (${prazos.terminationGracePeriodSecondsMinimo}).`,
    );
  }

  const sqsPoll = numeroInteiroPositivo(ambiente, 'SQS_LONG_POLL_SECONDS', 10);
  const sqsDeadline = deadlineSqs(ambiente);
  if (sqsDeadline < sqsPoll * 1000) {
    throw new ConfiguracaoExecutionInvalidaError(
      `SQS_OPERATION_DEADLINE_MS (${sqsDeadline}) deve cobrir o long polling (${sqsPoll}s).`,
    );
  }

  if (outboxGsiMaxPaginas < 1) {
    throw new ConfiguracaoExecutionInvalidaError(
      'OUTBOX_GSI_MAX_PAGINAS deve ser maior que zero.',
    );
  }
}

/** Fail-closed na partida; em produção exige segredos, filas e prazos coerentes. */
export function validarConfiguracaoExecution(
  ambiente: AmbienteConfiguracao = process.env,
): void {
  recusarLegadoHs256(ambiente);

  const flags = [
    'SQS_CONSUMER_HABILITADO',
    'OUTBOX_PUBLISHER_HABILITADO',
  ] as const;
  for (const chave of flags) {
    validarFlagTriState(ambiente, chave);
  }

  validarCoerenciaPrazos(ambiente);

  const producao = texto(ambiente, 'NODE_ENV', 'development') === 'production';
  if (!producao) return;

  exigirPreenchido(ambiente, 'JWT_PUBLIC_KEY', 'Chave pública JWT');
  exigirChavePem(
    exigirPreenchido(ambiente, 'JWT_PUBLIC_KEY', 'Chave pública'),
    'JWT_PUBLIC_KEY',
  );
  exigirPreenchido(ambiente, 'JWT_ISSUER', 'JWT_ISSUER');
  exigirPreenchido(ambiente, 'JWT_AUDIENCE', 'JWT_AUDIENCE');
  exigirPreenchido(ambiente, 'OS_SERVICE_TOKEN', 'OS_SERVICE_TOKEN');
  exigirPreenchido(ambiente, 'OS_SERVICE_BASE_URL', 'OS_SERVICE_BASE_URL');
  exigirPreenchido(ambiente, 'SQS_EXECUTION_IN_URL', 'SQS_EXECUTION_IN_URL');
  exigirPreenchido(
    ambiente,
    'SQS_EXECUTION_IN_DLQ_URL',
    'SQS_EXECUTION_IN_DLQ_URL',
  );
  exigirPreenchido(ambiente, 'SQS_OS_IN_URL', 'SQS_OS_IN_URL');
  exigirPreenchido(
    ambiente,
    'DYNAMODB_TAREFAS_TABLE',
    'DYNAMODB_TAREFAS_TABLE',
  );
  exigirPreenchido(ambiente, 'DYNAMODB_OUTBOX_TABLE', 'DYNAMODB_OUTBOX_TABLE');
  exigirPreenchido(
    ambiente,
    'DYNAMODB_MENSAGENS_PROCESSADAS_TABLE',
    'DYNAMODB_MENSAGENS_PROCESSADAS_TABLE',
  );

  if (ambiente.DYNAMODB_ENDPOINT?.trim()) {
    throw new ConfiguracaoExecutionInvalidaError(
      'DYNAMODB_ENDPOINT não deve ser definido em produção.',
    );
  }
}
