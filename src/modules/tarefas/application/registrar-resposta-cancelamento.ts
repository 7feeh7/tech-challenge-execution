import { randomUUID } from 'node:crypto';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
  EVENTO_RESPOSTA_CANCELAMENTO,
} from '@/shared/messaging/envelope';

export async function registrarRespostaCancelamento(
  outbox: OutboxGateway,
  contexto: ContextoTransacao,
  comando: EnvelopeMensagem,
  payload: Record<string, unknown>,
  ocorridoEm: Date,
): Promise<string> {
  const eventId = randomUUID();
  await outbox.registrar(contexto, {
    eventId,
    eventType: EVENTO_RESPOSTA_CANCELAMENTO,
    envelope: {
      eventId,
      eventType: EVENTO_RESPOSTA_CANCELAMENTO,
      version: 1,
      occurredAt: ocorridoEm.toISOString(),
      source: 'execution',
      correlationId: comando.correlationId,
      causationId: comando.eventId,
      ordemServicoId: comando.ordemServicoId,
      rodada: comando.rodada,
      payload,
    },
    correlationId: comando.correlationId,
    causationId: comando.eventId,
    destino: DESTINO_FILA_OS,
  });
  return eventId;
}
