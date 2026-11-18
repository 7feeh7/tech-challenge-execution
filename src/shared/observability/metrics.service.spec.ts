import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('incrementa contadores com tags', () => {
    const metrics = new MetricsService();
    metrics.increment('metrica.teste', 1, ['resultado:ok']);
    expect(metrics.obterContador('metrica.teste', ['resultado:ok'])).toBe(1);
  });

  it('incrementa sem tags', () => {
    const metrics = new MetricsService();
    metrics.increment('metrica.simples');
    expect(metrics.obterContador('metrica.simples')).toBe(1);
  });

  it('registra gauge', () => {
    const metrics = new MetricsService();
    metrics.gauge('backlog', 7);
    expect(metrics.obterGauge('backlog')).toBe(7);
  });

  it('redige tags sensíveis', () => {
    const metrics = new MetricsService();
    metrics.increment('privacidade', 1, ['sub:jwt-x', 'tipo:ok']);
    const registro = [
      ...(
        metrics as unknown as {
          contadores: Map<string, { tags: Record<string, string> }>;
        }
      ).contadores.values(),
    ][0];
    expect(registro?.tags.sub).toBe('[redacted]');
    expect(registro?.tags.tipo).toBe('ok');
  });
});
