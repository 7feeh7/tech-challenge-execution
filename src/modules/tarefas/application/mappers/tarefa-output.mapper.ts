import type {
  ConclusaoDiagnostico,
  DivergenciaPeca,
  ItemDiagnostico,
  ItemOficial,
  ItemUtilizado,
  Tarefa,
  VeiculoTarefa,
} from '../../domain/entities/tarefa.entity';

export interface TarefaOutput {
  id: string;
  tipo: string;
  ordemServicoId: string;
  rodada: number;
  situacao: string;
  responsavelId: string | null;
  veiculo: VeiculoTarefa;
  descricaoProblema: string;
  sugestoes: ItemDiagnostico[];
  itensOficiais: ItemOficial[];
  conclusaoPendente: ConclusaoDiagnostico | null;
  laudo: string | null;
  propostaItens: ItemDiagnostico[];
  servicosRealizados: ItemUtilizado[];
  pecasUtilizadas: ItemUtilizado[];
  divergencias: DivergenciaPeca[];
  motivoFalha: string | null;
  falhouEm: string | null;
  criadoEm: string;
  iniciadoEm: string | null;
  devolvidaEm: string | null;
  concluidaEm: string | null;
}

export class TarefaOutputMapper {
  static toOutput(this: void, tarefa: Tarefa): TarefaOutput {
    return {
      id: tarefa.id,
      tipo: tarefa.tipo,
      ordemServicoId: tarefa.ordemServicoId,
      rodada: tarefa.rodada,
      situacao: tarefa.situacao,
      responsavelId: tarefa.responsavelId,
      veiculo: tarefa.veiculo,
      descricaoProblema: tarefa.descricaoProblema,
      sugestoes: tarefa.sugestoes,
      itensOficiais: tarefa.itensOficiais,
      conclusaoPendente: tarefa.conclusaoPendente,
      laudo: tarefa.laudo,
      propostaItens: tarefa.propostaItens,
      servicosRealizados: tarefa.servicosRealizados,
      pecasUtilizadas: tarefa.pecasUtilizadas,
      divergencias: tarefa.divergencias,
      motivoFalha: tarefa.motivoFalha,
      falhouEm: tarefa.falhouEm?.toISOString() ?? null,
      criadoEm: tarefa.criadoEm.toISOString(),
      iniciadoEm: tarefa.iniciadoEm?.toISOString() ?? null,
      devolvidaEm: tarefa.devolvidaEm?.toISOString() ?? null,
      concluidaEm: tarefa.concluidaEm?.toISOString() ?? null,
    };
  }
}
