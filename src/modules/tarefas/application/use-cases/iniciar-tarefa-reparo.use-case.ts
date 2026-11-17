import { executarComRetentativaConflito } from '@/shared/database/executar-com-retentativa-conflito';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { EVENTO_REPARO_INICIADO } from '@/shared/messaging/envelope';
import {
  TarefaNaoEncontradaError,
  TarefaTipoInvalidoError,
} from '../../domain/errors/tarefa.errors';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import {
  type TarefaOutput,
  TarefaOutputMapper,
} from '../mappers/tarefa-output.mapper';
import type { TarefaGateway } from '../ports/tarefa.gateway';
import { registrarEventoTarefa } from '../registrar-evento-tarefa';

export class IniciarTarefaReparoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tarefas: TarefaGateway,
    private readonly outbox: OutboxGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async execute(tarefaId: string, usuarioId: string): Promise<TarefaOutput> {
    return executarComRetentativaConflito(() =>
      this.unitOfWork.executar(async (contexto) => {
        const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
        if (!tarefa) {
          throw new TarefaNaoEncontradaError(tarefaId);
        }
        if (tarefa.tipo !== TipoTarefa.REPARO) {
          throw new TarefaTipoInvalidoError('iniciar reparo', tarefa.tipo);
        }
        if (tarefa.estaEmAndamentoPor(usuarioId)) {
          return TarefaOutputMapper.toOutput(tarefa);
        }

        const agora = this.agora();
        tarefa.iniciar(usuarioId, agora);
        await this.tarefas.salvar(contexto, tarefa);
        await registrarEventoTarefa(
          this.outbox,
          contexto,
          tarefa,
          EVENTO_REPARO_INICIADO,
          { tarefaId: tarefa.id, iniciadoEm: agora.toISOString() },
          agora,
        );
        return TarefaOutputMapper.toOutput(tarefa);
      }),
    );
  }
}
