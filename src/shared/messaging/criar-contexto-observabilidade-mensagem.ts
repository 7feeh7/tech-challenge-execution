import type { ObservabilityContext } from '@/shared/http/correlation-id.context';
import type { EnvelopeMensagem } from './envelope';

export function criarContextoObservabilidadeMensagem(
  envelope: EnvelopeMensagem,
): ObservabilityContext {
  return {
    correlationId: envelope.correlationId,
    ordemServicoId: envelope.ordemServicoId,
    eventId: envelope.eventId,
    causationId: envelope.causationId,
    eventType: envelope.eventType,
    rodada: envelope.rodada,
  };
}
