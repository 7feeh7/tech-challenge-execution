import {
  montarIndiceFilaTarefa,
  TAREFAS_ATTR_INDICE_FILA,
  TAREFAS_ATTR_INDICE_FILA_ORDEM,
} from '@/shared/database/dynamodb-indices.constants';
import {
  type ConclusaoDiagnostico,
  type DivergenciaPeca,
  type ItemDiagnostico,
  type ItemOficial,
  type ItemUtilizado,
  Tarefa,
  type VeiculoTarefa,
} from '../../domain/entities/tarefa.entity';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';

type Registro = Record<string, unknown>;

export class DynamoDbTarefaMapper {
  /** Só o item de tarefa vira entidade; marcadores de bloqueio ficam de fora. */
  static ehTarefa(registro: Registro): boolean {
    return Object.values(TipoTarefa).includes(registro.tipo as TipoTarefa);
  }

  /**
   * O índice da fila é esparso: só tarefas PENDENTE carregam os atributos,
   * ordenadas pela chegada (a devolução à fila preserva a posição original).
   */
  static toItem(tarefa: Tarefa): Registro {
    const naFila = tarefa.situacao === SituacaoTarefa.PENDENTE;
    return {
      pk: tarefa.id,
      tipo: tarefa.tipo,
      ordemServicoId: tarefa.ordemServicoId,
      rodada: tarefa.rodada,
      situacao: tarefa.situacao,
      correlationId: tarefa.correlationId,
      veiculo: tarefa.veiculo,
      descricaoProblema: tarefa.descricaoProblema,
      sugestoes: tarefa.sugestoes,
      itensOficiais: tarefa.itensOficiais,
      responsavelId: tarefa.responsavelId ?? undefined,
      conclusaoPendente: tarefa.conclusaoPendente ?? undefined,
      laudo: tarefa.laudo ?? undefined,
      propostaItens: tarefa.propostaItens,
      servicosRealizados: tarefa.servicosRealizados,
      pecasUtilizadas: tarefa.pecasUtilizadas,
      divergencias: tarefa.divergencias,
      responsavelOperacaoId: tarefa.responsavelOperacaoId ?? undefined,
      motivoFalha: tarefa.motivoFalha ?? undefined,
      falhouEm: tarefa.falhouEm?.toISOString(),
      interrompidaEm: tarefa.interrompidaEm?.toISOString(),
      canceladaEm: tarefa.canceladaEm?.toISOString(),
      motivoCancelamento: tarefa.motivoCancelamento ?? undefined,
      fatoTerminalEventId: tarefa.fatoTerminalEventId ?? undefined,
      criadoEm: tarefa.criadoEm.toISOString(),
      iniciadoEm: tarefa.iniciadoEm?.toISOString(),
      devolvidaEm: tarefa.devolvidaEm?.toISOString(),
      concluidaEm: tarefa.concluidaEm?.toISOString(),
      atualizadoEm: tarefa.atualizadoEm.toISOString(),
      versao: tarefa.versao + 1,
      [TAREFAS_ATTR_INDICE_FILA]: naFila
        ? montarIndiceFilaTarefa(tarefa.tipo)
        : undefined,
      [TAREFAS_ATTR_INDICE_FILA_ORDEM]: naFila
        ? `${tarefa.criadoEm.toISOString()}#${tarefa.id}`
        : undefined,
    };
  }

  static toDomain(registro: Registro): Tarefa {
    return Tarefa.restaurar({
      id: String(registro.pk),
      tipo: registro.tipo as TipoTarefa,
      ordemServicoId: String(registro.ordemServicoId),
      rodada: Number(registro.rodada),
      situacao: registro.situacao as SituacaoTarefa,
      correlationId: String(registro.correlationId),
      veiculo: registro.veiculo as VeiculoTarefa,
      descricaoProblema: String(registro.descricaoProblema ?? ''),
      sugestoes: (registro.sugestoes as ItemDiagnostico[]) ?? [],
      itensOficiais: (registro.itensOficiais as ItemOficial[]) ?? [],
      responsavelId: (registro.responsavelId as string | undefined) ?? null,
      conclusaoPendente:
        (registro.conclusaoPendente as ConclusaoDiagnostico | undefined) ??
        null,
      laudo: (registro.laudo as string | undefined) ?? null,
      propostaItens: (registro.propostaItens as ItemDiagnostico[]) ?? [],
      servicosRealizados:
        (registro.servicosRealizados as ItemUtilizado[]) ?? [],
      pecasUtilizadas: (registro.pecasUtilizadas as ItemUtilizado[]) ?? [],
      divergencias: (registro.divergencias as DivergenciaPeca[]) ?? [],
      responsavelOperacaoId:
        (registro.responsavelOperacaoId as string | undefined) ?? null,
      motivoFalha: (registro.motivoFalha as string | undefined) ?? null,
      falhouEm: paraData(registro.falhouEm),
      interrompidaEm: paraData(registro.interrompidaEm),
      canceladaEm: paraData(registro.canceladaEm),
      motivoCancelamento:
        (registro.motivoCancelamento as string | undefined) ?? null,
      fatoTerminalEventId:
        (registro.fatoTerminalEventId as string | undefined) ?? null,
      criadoEm: new Date(String(registro.criadoEm)),
      iniciadoEm: paraData(registro.iniciadoEm),
      devolvidaEm: paraData(registro.devolvidaEm),
      concluidaEm: paraData(registro.concluidaEm),
      atualizadoEm: new Date(String(registro.atualizadoEm)),
      versao: Number(registro.versao ?? 0),
    });
  }
}

function paraData(valor: unknown): Date | null {
  return typeof valor === 'string' ? new Date(valor) : null;
}
