import type {
  ConclusaoDiagnostico,
  ItemDiagnostico,
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
  conclusaoPendente: ConclusaoDiagnostico | null;
  laudo: string | null;
  propostaItens: ItemDiagnostico[];
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
      conclusaoPendente: tarefa.conclusaoPendente,
      laudo: tarefa.laudo,
      propostaItens: tarefa.propostaItens,
      criadoEm: tarefa.criadoEm.toISOString(),
      iniciadoEm: tarefa.iniciadoEm?.toISOString() ?? null,
      devolvidaEm: tarefa.devolvidaEm?.toISOString() ?? null,
      concluidaEm: tarefa.concluidaEm?.toISOString() ?? null,
    };
  }
}
