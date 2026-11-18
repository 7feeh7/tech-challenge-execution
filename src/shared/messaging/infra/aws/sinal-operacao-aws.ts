export interface SinalOperacaoAws {
  signal: AbortSignal;
  dispose: () => void;
}

export function criarSinalOperacaoAws(
  deadlineMs: number,
  sinalExterno?: AbortSignal,
): SinalOperacaoAws {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), deadlineMs);

  const abortar = () => controlador.abort();
  sinalExterno?.addEventListener('abort', abortar, { once: true });

  const dispose = () => {
    clearTimeout(timeout);
    sinalExterno?.removeEventListener('abort', abortar);
  };

  controlador.signal.addEventListener('abort', dispose, { once: true });

  return { signal: controlador.signal, dispose };
}

/** Compatibilidade: preferir `criarSinalOperacaoAws` e chamar `dispose` após a operação. */
export function sinalOperacaoAws(
  deadlineMs: number,
  sinalExterno?: AbortSignal,
): AbortSignal {
  return criarSinalOperacaoAws(deadlineMs, sinalExterno).signal;
}
