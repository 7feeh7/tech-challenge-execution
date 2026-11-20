import type { Tarefa } from '../../domain/entities/tarefa.entity';
import { ResultadoCancelamento } from '../../domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';

export function montarPayloadRespostaCancelamento(
  tarefa: Tarefa | null,
  tipoTarefa: TipoTarefa,
  resultado: ResultadoCancelamento,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { tipoTarefa, resultado };

  if (!tarefa) {
    return payload;
  }

  if (resultado === ResultadoCancelamento.JA_CONCLUIDA) {
    payload.situacaoTarefa = SituacaoTarefa.CONCLUIDA;
    payload.concluidaEm = tarefa.concluidaEm?.toISOString();
    payload.encerradaEm = tarefa.concluidaEm?.toISOString();
    if (tipoTarefa === TipoTarefa.REPARO) {
      payload.responsavelId = tarefa.responsavelOperacaoId ?? undefined;
      payload.pecasUtilizadas = tarefa.pecasUtilizadas;
      payload.servicosRealizados = tarefa.servicosRealizados;
      payload.divergencias = tarefa.divergencias;
      if (tarefa.fatoTerminalEventId) {
        payload.fatoTerminalEventId = tarefa.fatoTerminalEventId;
      }
    }
    return payload;
  }

  if (resultado === ResultadoCancelamento.JA_ENCERRADA) {
    payload.situacaoTarefa = tarefa.situacao;
    payload.encerradaEm = horarioEncerramento(tarefa)?.toISOString();

    if (tarefa.situacao === SituacaoTarefa.CANCELADA) {
      if (tipoTarefa === TipoTarefa.REPARO) {
        payload.pecasUtilizadas = [];
        payload.servicosRealizados = [];
        payload.divergencias = [];
      }
      return payload;
    }

    if (tipoTarefa === TipoTarefa.REPARO) {
      payload.pecasUtilizadas = tarefa.pecasUtilizadas;
      payload.servicosRealizados = tarefa.servicosRealizados;
      payload.divergencias = tarefa.divergencias;
      if (tarefa.responsavelOperacaoId) {
        payload.responsavelId = tarefa.responsavelOperacaoId;
      }
      if (tarefa.situacao === SituacaoTarefa.FALHOU && tarefa.motivoFalha) {
        payload.motivo = tarefa.motivoFalha;
      }
      if (
        tarefa.situacao === SituacaoTarefa.INTERROMPIDA &&
        tarefa.motivoCancelamento
      ) {
        payload.motivo = tarefa.motivoCancelamento;
      }
      if (tarefa.fatoTerminalEventId) {
        payload.fatoTerminalEventId = tarefa.fatoTerminalEventId;
      }
    }
  }

  return payload;
}

function horarioEncerramento(tarefa: Tarefa): Date | null {
  switch (tarefa.situacao) {
    case SituacaoTarefa.CONCLUIDA:
      return tarefa.concluidaEm;
    case SituacaoTarefa.FALHOU:
      return tarefa.falhouEm;
    case SituacaoTarefa.INTERROMPIDA:
      return tarefa.interrompidaEm;
    case SituacaoTarefa.CANCELADA:
      return tarefa.canceladaEm;
    default:
      return null;
  }
}
