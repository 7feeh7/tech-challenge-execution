import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import {
  type TarefaOutput,
  TarefaOutputMapper,
} from '../mappers/tarefa-output.mapper';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export interface ListarTarefasInput {
  tipo?: TipoTarefa;
  limite?: number;
  cursor?: string;
}

export interface ListarTarefasOutput {
  itens: TarefaOutput[];
  proximoCursor: string | null;
}

const LIMITE_PADRAO = 50;

export class ListarTarefasUseCase {
  constructor(private readonly tarefas: TarefaGateway) {}

  async execute(input: ListarTarefasInput): Promise<ListarTarefasOutput> {
    const pagina = await this.tarefas.listarFila({
      tipo: input.tipo ?? TipoTarefa.DIAGNOSTICO,
      limite: input.limite ?? LIMITE_PADRAO,
      cursor: input.cursor,
    });
    return {
      itens: pagina.tarefas.map(TarefaOutputMapper.toOutput),
      proximoCursor: pagina.proximoCursor,
    };
  }
}
