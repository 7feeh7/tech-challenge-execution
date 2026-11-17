import { executarComRetentativaConflito } from '@/shared/database/executar-com-retentativa-conflito';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { EVENTO_REPARO_CONCLUIDO } from '@/shared/messaging/envelope';
import type { ItemUtilizado } from '../../domain/entities/tarefa.entity';
import {
  TarefaNaoEncontradaError,
  TarefaTipoInvalidoError,
} from '../../domain/errors/tarefa.errors';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { validarExecucaoReparo } from '../../domain/validar-execucao-reparo';
import {
  type TarefaOutput,
  TarefaOutputMapper,
} from '../mappers/tarefa-output.mapper';
import type { TarefaGateway } from '../ports/tarefa.gateway';
import { registrarEventoTarefa } from '../registrar-evento-tarefa';

export interface ConcluirTarefaReparoInput {
  servicosRealizados: ItemUtilizado[];
  pecasUtilizadas: ItemUtilizado[];
}

export class ConcluirTarefaReparoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tarefas: TarefaGateway,
    private readonly outbox: OutboxGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async execute(
    tarefaId: string,
    input: ConcluirTarefaReparoInput,
  ): Promise<TarefaOutput> {
    return executarComRetentativaConflito(() =>
      this.unitOfWork.executar(async (contexto) => {
        const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
        if (!tarefa) {
          throw new TarefaNaoEncontradaError(tarefaId);
        }
        if (tarefa.tipo !== TipoTarefa.REPARO) {
          throw new TarefaTipoInvalidoError('concluir reparo', tarefa.tipo);
        }
        if (tarefa.estaEncerradaReparo()) {
          return TarefaOutputMapper.toOutput(tarefa);
        }

        const validada = validarExecucaoReparo(
          tarefa.itensOficiais,
          input.servicosRealizados,
          input.pecasUtilizadas,
        );
        const agora = this.agora();
        tarefa.concluirReparo(
          {
            ...validada,
            motivoFalha: null,
          },
          agora,
        );
        await this.tarefas.salvar(contexto, tarefa);
        await registrarEventoTarefa(
          this.outbox,
          contexto,
          tarefa,
          EVENTO_REPARO_CONCLUIDO,
          {
            tarefaId: tarefa.id,
            concluidoEm: agora.toISOString(),
            servicosRealizados: validada.servicosRealizados,
            pecasUtilizadas: validada.pecasUtilizadas,
            divergencias: validada.divergencias,
          },
          agora,
        );
        return TarefaOutputMapper.toOutput(tarefa);
      }),
    );
  }
}
