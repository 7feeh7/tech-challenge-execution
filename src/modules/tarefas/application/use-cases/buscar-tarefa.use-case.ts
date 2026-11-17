import { TarefaNaoEncontradaError } from '../../domain/errors/tarefa.errors';
import {
  type TarefaOutput,
  TarefaOutputMapper,
} from '../mappers/tarefa-output.mapper';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export class BuscarTarefaUseCase {
  constructor(private readonly tarefas: TarefaGateway) {}

  async execute(id: string): Promise<TarefaOutput> {
    const tarefa = await this.tarefas.consultarPorId(id);
    if (!tarefa) {
      throw new TarefaNaoEncontradaError(id);
    }
    return TarefaOutputMapper.toOutput(tarefa);
  }
}
