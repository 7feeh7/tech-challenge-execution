import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import {
  type ItemDiagnostico,
  Tarefa,
  type VeiculoTarefa,
} from '../../domain/entities/tarefa.entity';
import { montarTarefaId } from '../../domain/tarefa-id';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export interface CriarTarefaDiagnosticoInput {
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  veiculo: VeiculoTarefa;
  descricaoProblema: string;
  sugestoes: ItemDiagnostico[];
}

export class CriarTarefaDiagnosticoUseCase {
  constructor(
    private readonly tarefas: TarefaGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Devolve `false` quando a chave já existe (tarefa ou marcador de bloqueio). */
  async execute(
    contexto: ContextoTransacao,
    input: CriarTarefaDiagnosticoInput,
  ): Promise<boolean> {
    const id = montarTarefaId(
      input.ordemServicoId,
      input.rodada,
      TipoTarefa.DIAGNOSTICO,
    );
    if (await this.tarefas.existeRegistro(contexto, id)) {
      return false;
    }

    const tarefa = Tarefa.criar({
      ...input,
      tipo: TipoTarefa.DIAGNOSTICO,
      itensOficiais: [],
      criadoEm: this.agora(),
    });
    await this.tarefas.criar(contexto, tarefa);
    return true;
  }
}
