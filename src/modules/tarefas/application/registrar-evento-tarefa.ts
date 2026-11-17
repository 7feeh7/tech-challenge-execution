import { randomUUID } from 'node:crypto';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { DESTINO_FILA_OS } from '@/shared/messaging/envelope';
import type { Tarefa } from '../domain/entities/tarefa.entity';

/** Registra o fato na outbox, na mesma transação da mudança da tarefa. */
export async function registrarEventoTarefa(
  outbox: OutboxGateway,
  contexto: ContextoTransacao,
  tarefa: Tarefa,
  eventType: string,
  payload: Record<string, unknown>,
  ocorridoEm: Date,
  eventId: string = randomUUID(),
  causationId: string | null = null,
): Promise<string> {
  await outbox.registrar(contexto, {
    eventId,
    eventType,
    envelope: {
      eventId,
      eventType,
      version: 1,
      occurredAt: ocorridoEm.toISOString(),
      source: 'execution',
      correlationId: tarefa.correlationId,
      causationId,
      ordemServicoId: tarefa.ordemServicoId,
      rodada: tarefa.rodada,
      payload,
    },
    correlationId: tarefa.correlationId,
    causationId,
    destino: DESTINO_FILA_OS,
  });
  return eventId;
}
