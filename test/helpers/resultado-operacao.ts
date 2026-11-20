export function exigirCumprida<T = unknown>(
  resultado: PromiseSettledResult<unknown> | undefined,
): T {
  if (resultado?.status !== 'fulfilled') {
    throw new Error(
      `Operação deveria ter sido cumprida; resultado: ${descrever(resultado)}`,
    );
  }
  return resultado.value as T;
}

/** Exige a CLASSE exata do erro, sem aceitar subclasses. */
export function exigirRecusadaCom(
  resultado: PromiseSettledResult<unknown> | undefined,
  classeErro: new (...args: never[]) => Error,
): Error {
  if (resultado?.status !== 'rejected') {
    throw new Error(
      `Operação deveria ter sido recusada com ${classeErro.name}; resultado: ${descrever(resultado)}`,
    );
  }
  const motivo = resultado.reason as Error;
  if (motivo.constructor !== classeErro) {
    throw new Error(
      `Esperado ${classeErro.name}, recebido ${motivo.constructor.name}: ${motivo.message}`,
    );
  }
  return motivo;
}

function descrever(resultado: PromiseSettledResult<unknown> | undefined) {
  if (!resultado) return 'indefinido';
  return resultado.status === 'rejected'
    ? `recusada (${(resultado.reason as Error)?.constructor?.name}: ${(resultado.reason as Error)?.message})`
    : 'cumprida';
}
