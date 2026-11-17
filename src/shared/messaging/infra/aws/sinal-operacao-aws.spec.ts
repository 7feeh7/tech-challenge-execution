import { sinalOperacaoAws } from './sinal-operacao-aws';

describe('sinalOperacaoAws', () => {
  it('propaga abortamento externo', () => {
    const externo = new AbortController();
    const sinal = sinalOperacaoAws(5_000, externo.signal);
    externo.abort();
    expect(sinal.aborted).toBe(true);
  });

  it('aborta após o prazo configurado', async () => {
    const sinal = sinalOperacaoAws(20);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sinal.aborted).toBe(true);
  });
});
