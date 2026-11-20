import { randomUUID } from 'node:crypto';
import { TipoTarefa } from '@/modules/tarefas/domain/tipo-tarefa.enum';
import {
  COMANDO_CANCELAR_TAREFA,
  COMANDO_INICIAR_DIAGNOSTICO,
  COMANDO_INICIAR_REPARO,
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

export function criarComandoIniciarReparo(
  patch: Partial<EnvelopeMensagem> = {},
): EnvelopeMensagem {
  return {
    eventId: randomUUID(),
    eventType: COMANDO_INICIAR_REPARO,
    version: 1,
    occurredAt: '2026-11-15T11:00:00.000Z',
    source: 'os-service',
    correlationId: randomUUID(),
    causationId: randomUUID(),
    ordemServicoId: randomUUID(),
    rodada: 1,
    payload: {
      itensOficiais: [
        {
          tipo: 'SERVICO',
          itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          nome: 'Troca de pastilhas',
          quantidade: 1,
        },
        {
          tipo: 'PECA',
          itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          nome: 'Pastilha',
          quantidade: 2,
        },
      ],
    },
    ...patch,
  };
}

export function criarComandoCancelarTarefa(
  patch: Partial<EnvelopeMensagem> = {},
  tipoTarefa: TipoTarefa = TipoTarefa.DIAGNOSTICO,
): EnvelopeMensagem {
  const ordemServicoId =
    (patch.ordemServicoId as string | undefined) ?? randomUUID();
  const rodada = patch.rodada ?? 1;
  return {
    eventId: randomUUID(),
    eventType: COMANDO_CANCELAR_TAREFA,
    version: 1,
    occurredAt: '2026-11-15T12:00:00.000Z',
    source: 'os-service',
    correlationId: randomUUID(),
    causationId: randomUUID(),
    ordemServicoId,
    rodada,
    payload: {
      tipoTarefa,
      motivo: 'Desistência do cliente',
    },
    ...patch,
  };
}
