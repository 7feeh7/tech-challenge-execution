import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import { type ItemOficial, Tarefa } from '../../domain/entities/tarefa.entity';
import { montarTarefaId } from '../../domain/tarefa-id';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export interface CriarTarefaReparoInput {
  ordemServicoId: string;
  rodada: number;
  correlationId: string;
  itensOficiais: ItemOficial[];
}

export class CriarTarefaReparoUseCase {
  constructor(
    private readonly tarefas: TarefaGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Devolve `false` quando a chave já existe (tarefa ou marcador de bloqueio). */
  async execute(
    contexto: ContextoTransacao,
    input: CriarTarefaReparoInput,
  ): Promise<boolean> {
    const id = montarTarefaId(
      input.ordemServicoId,
      input.rodada,
      TipoTarefa.REPARO,
    );
    if (await this.tarefas.existeRegistro(contexto, id)) {
      return false;
    }

    const tarefa = Tarefa.criar({
      tipo: TipoTarefa.REPARO,
      ordemServicoId: input.ordemServicoId,
      rodada: input.rodada,
      correlationId: input.correlationId,
      veiculo: { placa: '', modelo: '' },
      descricaoProblema: '',
      sugestoes: [],
      itensOficiais: input.itensOficiais,
      criadoEm: this.agora(),
    });
    await this.tarefas.criar(contexto, tarefa);
    return true;
  }
}
