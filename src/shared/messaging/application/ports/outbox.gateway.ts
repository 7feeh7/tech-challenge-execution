import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { EnvelopeMensagem } from '../../envelope';

export interface RegistrarOutboxInput {
  eventId: string;
  eventType: string;
  envelope: EnvelopeMensagem;
  correlationId: string;
  causationId: string | null;
  destino: string;
}

export interface OutboxGateway {
  registrar(
    contexto: ContextoTransacao,
    input: RegistrarOutboxInput,
  ): Promise<void>;
}
