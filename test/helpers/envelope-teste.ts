import { randomUUID } from 'node:crypto';
import {
  COMANDO_INICIAR_DIAGNOSTICO,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';

export function criarComandoIniciarDiagnostico(
  patch: Partial<EnvelopeMensagem> = {},
): EnvelopeMensagem {
  return {
    eventId: randomUUID(),
    eventType: COMANDO_INICIAR_DIAGNOSTICO,
    version: 1,
    occurredAt: '2026-11-15T10:00:00.000Z',
    source: 'os-service',
    correlationId: randomUUID(),
    causationId: null,
    ordemServicoId: randomUUID(),
    rodada: 1,
    payload: {
      veiculo: { placa: 'ABC1D23', modelo: 'Sedan 2020' },
      descricaoProblema: 'Barulho ao frear',
      sugestoes: [
        {
          tipo: 'PECA',
          itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          quantidade: 2,
        },
      ],
    },
    ...patch,
  };
}
