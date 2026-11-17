export function sinalOperacaoAws(
  deadlineMs: number,
  sinalExterno?: AbortSignal,
): AbortSignal {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), deadlineMs);

  const abortar = () => controlador.abort();
  sinalExterno?.addEventListener('abort', abortar, { once: true });

  controlador.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeout);
      sinalExterno?.removeEventListener('abort', abortar);
    },
    { once: true },
  );

  return controlador.signal;
}
