import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObservabilityContext {
  correlationId?: string;
  requestId?: string;
  ordemServicoId?: string;
  eventId?: string;
  causationId?: string | null;
  eventType?: string;
  rodada?: number;
}

export const correlationIdStorage =
  new AsyncLocalStorage<ObservabilityContext>();

export function getCorrelationId(): string | undefined {
  return correlationIdStorage.getStore()?.correlationId;
}

export function getObservabilityLogFields(): Record<string, unknown> {
  const store = correlationIdStorage.getStore();
  if (!store) {
    return {};
  }

  const campos: Record<string, unknown> = {};
  if (store.correlationId) campos.correlationId = store.correlationId;
  if (store.requestId) campos.requestId = store.requestId;
  if (store.ordemServicoId) campos.ordemServicoId = store.ordemServicoId;
  if (store.eventId) campos.eventId = store.eventId;
  if (store.causationId !== undefined) campos.causationId = store.causationId;
  if (store.eventType) campos.eventType = store.eventType;
  if (store.rodada !== undefined) campos.rodada = store.rodada;
  return campos;
}
