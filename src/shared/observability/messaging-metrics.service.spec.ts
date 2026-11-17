import { MessagingMetricsService } from './messaging-metrics.service';
import { MetricsService } from './metrics.service';
import { METRIC_NAMES } from './observability.config';

describe('MessagingMetricsService', () => {
  it('registra contadores de mensageria sem eventId como tag', async () => {
    const metrics = new MetricsService();
    const outboxRepo = {
      contarPendentes: jest.fn().mockResolvedValue(3),
    };
    const service = new MessagingMetricsService(metrics, outboxRepo as never);
    service.recordMensagemProcessada('processada');
    service.recordErroConsumo('transitorio');
    service.recordPublicacaoFalha();
    await service.recordOutboxBacklog();
    expect(
      metrics.obterContador(METRIC_NAMES.mensagemProcessada, [
        'resultado:processada',
      ]),
    ).toBe(1);
    expect(metrics.obterGauge(METRIC_NAMES.outboxPendentes)).toBe(3);
  });
});
