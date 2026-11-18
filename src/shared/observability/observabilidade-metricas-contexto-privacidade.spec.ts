import {
  correlationIdStorage,
  getObservabilityLogFields,
} from '@/shared/http/correlation-id.context';
import { MessagingMetricsService } from './messaging-metrics.service';
import { MetricsService } from './metrics.service';

describe('Privacidade de métricas e contexto de tracing', () => {
  it('não expõe segredos em tags de métricas', () => {
    const metrics = new MetricsService();
    metrics.increment('teste.privacidade', 1, [
      'justificativa:segredo-justificativa',
      'motivo:segredo-motivo',
      'sub:jwt-sub-secreto',
      'responsavelId:mec-secreto',
      'authorization:Bearer jwt.secreto',
      'resultado:permanente',
    ]);

    const armazenado = (
      metrics as unknown as {
        contadores: Map<string, { tags: Record<string, string> }>;
      }
    ).contadores
      .values()
      .next().value as { tags: Record<string, string> };

    expect(armazenado.tags.resultado).toBe('permanente');
    expect(armazenado.tags.justificativa).toBe('[redacted]');
    expect(armazenado.tags.motivo).toBe('[redacted]');
    expect(armazenado.tags.sub).toBe('[redacted]');
    expect(armazenado.tags.responsavelId).toBe('[redacted]');
    expect(armazenado.tags.authorization).toBe('[redacted]');
    expect(JSON.stringify(armazenado.tags)).not.toContain('segredo');
    expect(JSON.stringify(armazenado.tags)).not.toContain('jwt.secreto');
  });

  it('métricas operacionais da mensageria não carregam PII', () => {
    const metrics = new MetricsService();
    const mensageria = new MessagingMetricsService(metrics, {
      contarPendentes: async () => 2,
    } as never);

    mensageria.recordErroConsumo('permanente');
    mensageria.recordMensagemProcessada('os.iniciar-diagnostico.v1');
    void mensageria.recordOutboxBacklog();

    const chaves = [
      ...(
        metrics as unknown as { contadores: Map<string, unknown> }
      ).contadores.keys(),
    ];
    expect(JSON.stringify(chaves)).not.toMatch(
      /justificativa|motivo|Bearer|OS_SERVICE/,
    );
  });

  it('contexto AsyncLocalStorage limita campos técnicos permitidos', () => {
    const resultado = correlationIdStorage.run(
      {
        correlationId: 'corr-ok',
        eventId: 'evt-ok',
        requestId: 'req-ok',
        ordemServicoId: 'os-ok',
      },
      () => getObservabilityLogFields(),
    );
    expect(resultado).toEqual({
      correlationId: 'corr-ok',
      eventId: 'evt-ok',
      requestId: 'req-ok',
      ordemServicoId: 'os-ok',
    });
    expect(JSON.stringify(resultado)).not.toMatch(
      /justificativa|motivo|sub|token/i,
    );
  });
});
