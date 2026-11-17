import type { JsonLoggerService } from '@/shared/observability/json-logger.service';
import type { MessagingMetricsService } from '@/shared/observability/messaging-metrics.service';

export function criarJsonLoggerMensageriaFake(): JsonLoggerService {
  return {
    logWithMeta: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as JsonLoggerService;
}

export function criarMessagingMetricsFake(): MessagingMetricsService {
  return {
    recordMensagemProcessada: jest.fn(),
    recordErroConsumo: jest.fn(),
    recordPublicacaoFalha: jest.fn(),
    recordOutboxBacklog: jest.fn().mockResolvedValue(undefined),
  } as unknown as MessagingMetricsService;
}
