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
});
