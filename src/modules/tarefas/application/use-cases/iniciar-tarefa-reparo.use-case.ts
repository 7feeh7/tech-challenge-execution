import { executarComRetentativaConflito } from '@/shared/database/executar-com-retentativa-conflito';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { EVENTO_REPARO_INICIADO } from '@/shared/messaging/envelope';
import {
  TarefaNaoEncontradaError,
  TarefaSituacaoInvalidaError,
  TarefaTipoInvalidoError,
} from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import {
  type TarefaOutput,
  toTarefaOutput,
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
          return toTarefaOutput(tarefa);
        }
        if (tarefa.situacao === SituacaoTarefa.CANCELADA) {
          throw new TarefaSituacaoInvalidaError('iniciar', tarefa.situacao, [
            SituacaoTarefa.PENDENTE,
          ]);
        }
        if (tarefa.situacao === SituacaoTarefa.INTERRUPCAO_SOLICITADA) {
          throw new TarefaSituacaoInvalidaError('iniciar', tarefa.situacao, [
            SituacaoTarefa.PENDENTE,
          ]);
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
        return toTarefaOutput(tarefa);
      }),
    );
  }
}
