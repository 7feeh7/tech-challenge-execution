export interface ParametrosDeadlineOperacaoAws {
  /** Valor bruto da variável de deadline; ausente quando não configurada. */
  deadlineExplicito?: string;
  httpAttemptTimeoutMs: number;
  maxAttempts: number;
}

/**
 * Deadline total de uma operação AWS: o explícito ou, na falta dele, o timeout de cada
 * tentativa HTTP vezes o número de tentativas do SDK. Compartilhada pelos clientes e pela
 * validação da partida para que as duas partam do mesmo valor.
 */
export function resolverDeadlineOperacaoAws({
  deadlineExplicito,
  httpAttemptTimeoutMs,
  maxAttempts,
}: ParametrosDeadlineOperacaoAws): number {
  const derivado = httpAttemptTimeoutMs * maxAttempts;
  const deadline = Number(deadlineExplicito ?? String(derivado));
  return Number.isFinite(deadline) ? deadline : derivado;
}
