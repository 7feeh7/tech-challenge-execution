import { randomUUID } from 'node:crypto';
import { executarComRetentativaConflito } from '@/shared/database/executar-com-retentativa-conflito';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type {
  ConclusaoDiagnostico,
  Tarefa,
} from '../../domain/entities/tarefa.entity';
import {
  ConclusaoIndeterminadaError,
  ConclusaoRecusadaPeloOsConflitoError,
  ConclusaoRecusadaPeloOsError,
  TarefaNaoEncontradaError,
  TarefaTipoInvalidoError,
} from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import {
  type TarefaOutput,
  TarefaOutputMapper,
} from '../mappers/tarefa-output.mapper';
import type {
  ConclusaoDiagnosticoOsGateway,
  ItemOficial,
  ResultadoConclusaoDiagnosticoOs,
} from '../ports/conclusao-diagnostico-os.gateway';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export interface ConcluirTarefaDiagnosticoOutput {
  tarefa: TarefaOutput;
  itensOficiais: ItemOficial[];
}

type ResultadoRecusado = Extract<
  ResultadoConclusaoDiagnosticoOs,
  { tipo: 'recusada' }
>;

/**
 * Conclusão em três passos (D1.13): grava o payload pendente, chama o OS fora
 * da transação e só então aplica o resultado. Nenhuma conclusão é gravada sem
 * o 200 do OS.
 */
export class ConcluirTarefaDiagnosticoUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tarefas: TarefaGateway,
    private readonly os: ConclusaoDiagnosticoOsGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async execute(
    tarefaId: string,
    conclusao: ConclusaoDiagnostico,
  ): Promise<ConcluirTarefaDiagnosticoOutput> {
    const { tarefa, conclusaoEfetiva } = await this.gravarConclusaoPendente(
      tarefaId,
      conclusao,
    );

    const resultado = await this.os.concluir({
      ordemServicoId: tarefa.ordemServicoId,
      rodada: tarefa.rodada,
      tarefaId: tarefa.id,
      laudo: conclusaoEfetiva.laudo,
      itens: conclusaoEfetiva.itens,
      correlationId: tarefa.correlationId,
      requestId: randomUUID(),
    });

    if (resultado.tipo === 'sucesso') {
      return this.aplicarConclusao(tarefaId, resultado.itensOficiais);
    }
    if (resultado.tipo === 'recusada') {
      await this.reabrirTarefa(tarefaId);
      throw this.criarErroRecusa(resultado);
    }
    throw new ConclusaoIndeterminadaError(resultado.motivo);
  }

  private gravarConclusaoPendente(
    tarefaId: string,
    conclusao: ConclusaoDiagnostico,
  ): Promise<{ tarefa: Tarefa; conclusaoEfetiva: ConclusaoDiagnostico }> {
    return executarComRetentativaConflito(() =>
      this.unitOfWork.executar(async (contexto) => {
        const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
        if (!tarefa) {
          throw new TarefaNaoEncontradaError(tarefaId);
        }
        if (tarefa.tipo !== TipoTarefa.DIAGNOSTICO) {
          throw new TarefaTipoInvalidoError(
            'concluir diagnóstico',
            tarefa.tipo,
          );
        }

        // Nova tentativa após resposta indeterminada reenvia o payload gravado
        // e ignora o conteúdo novo, para manter a mesma chave idempotente.
        if (
          tarefa.situacao === SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO &&
          tarefa.conclusaoPendente
        ) {
          return { tarefa, conclusaoEfetiva: tarefa.conclusaoPendente };
        }

        tarefa.registrarConclusaoPendente(conclusao, this.agora());
        await this.tarefas.salvar(contexto, tarefa);
        return { tarefa, conclusaoEfetiva: conclusao };
      }),
    );
  }

  private aplicarConclusao(
    tarefaId: string,
    itensOficiais: ItemOficial[],
  ): Promise<ConcluirTarefaDiagnosticoOutput> {
    return executarComRetentativaConflito(() =>
      this.unitOfWork.executar(async (contexto) => {
        const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
        if (!tarefa) {
          throw new TarefaNaoEncontradaError(tarefaId);
        }

        // Outra chamada concorrente já aplicou o mesmo 200 idempotente do OS.
        if (tarefa.situacao !== SituacaoTarefa.CONCLUIDA) {
          tarefa.concluir(this.agora());
          await this.tarefas.salvar(contexto, tarefa);
        }
        return { tarefa: TarefaOutputMapper.toOutput(tarefa), itensOficiais };
      }),
    );
  }

  private reabrirTarefa(tarefaId: string): Promise<void> {
    return executarComRetentativaConflito(() =>
      this.unitOfWork.executar(async (contexto) => {
        const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
        if (tarefa?.situacao !== SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO) {
          return;
        }
        tarefa.reabrirAposRecusa(this.agora());
        await this.tarefas.salvar(contexto, tarefa);
      }),
    );
  }

  private criarErroRecusa(resultado: ResultadoRecusado): Error {
    return resultado.status === 409
      ? new ConclusaoRecusadaPeloOsConflitoError(
          resultado.codigo,
          resultado.mensagem,
        )
      : new ConclusaoRecusadaPeloOsError(resultado.codigo, resultado.mensagem);
  }
}
