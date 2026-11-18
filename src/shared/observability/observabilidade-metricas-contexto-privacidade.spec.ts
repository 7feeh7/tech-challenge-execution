import {
  correlationIdStorage,
  getObservabilityLogFields,
} from '@/shared/http/correlation-id.context';
import { criarContextoObservabilidadeMensagem } from '@/shared/messaging/criar-contexto-observabilidade-mensagem';
import type { EnvelopeMensagem } from '@/shared/messaging/envelope';
import { JsonLoggerService } from './json-logger.service';
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
      contarPendentes: async () => ({
        quantidade: 2,
        truncada: false,
        paginasConsultadas: 1,
      }),
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

  it('contexto de tracing da mensageria não propaga segredos do payload', () => {
    const envelope = {
      eventId: 'evt-tracing',
      eventType: 'os.cancelar-tarefa.v1',
      correlationId: 'corr-tracing',
      ordemServicoId: 'os-tracing',
      rodada: 1,
      causationId: null,
      dataOcorrencia: new Date().toISOString(),
      payload: {
        justificativaDivergencia: 'segredo-justificativa',
        motivo: 'segredo-motivo',
        responsavelId: 'mec-secreto',
        sub: 'jwt-sub-secreto',
        OS_SERVICE_TOKEN: 'token-os',
        authorization: 'Bearer jwt.secreto',
      },
    } as EnvelopeMensagem;

    const contexto = criarContextoObservabilidadeMensagem(envelope);
    const campos = correlationIdStorage.run(contexto, () =>
      getObservabilityLogFields(),
    );
    const logger = new JsonLoggerService();
    let linha = '';
    jest.spyOn(console, 'log').mockImplementation((msg) => {
      linha = String(msg);
    });
    correlationIdStorage.run(contexto, () =>
      logger.logWithMeta('info', 'processamento', {}, 'Mensageria'),
    );
    jest.restoreAllMocks();

    expect(campos).toEqual({
      correlationId: 'corr-tracing',
      ordemServicoId: 'os-tracing',
      eventId: 'evt-tracing',
      causationId: null,
      eventType: 'os.cancelar-tarefa.v1',
      rodada: 1,
    });
    expect(JSON.stringify(campos)).not.toMatch(
      /justificativa|segredo-motivo|mec-secreto|jwt|Bearer|OS_SERVICE/i,
    );
    expect(JSON.stringify(JSON.parse(linha))).not.toMatch(
      /justificativa|segredo-motivo|mec-secreto|jwt\.secreto|token-os/i,
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
