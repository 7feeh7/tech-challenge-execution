import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import type { EnvelopeMensagem } from '@/shared/messaging/envelope';
import { ResultadoCancelamento } from '../../domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { montarTarefaId } from '../../domain/tarefa-id';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { montarPayloadRespostaCancelamento } from '../mappers/montar-resposta-cancelamento';
import type { TarefaGateway } from '../ports/tarefa.gateway';
import { registrarRespostaCancelamento } from '../registrar-resposta-cancelamento';

export interface CancelarTarefaInput {
  tipoTarefa: TipoTarefa;
  motivo: string | null;
}

export class CancelarTarefaUseCase {
  constructor(
    private readonly tarefas: TarefaGateway,
    private readonly outbox: OutboxGateway,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async execute(
    contexto: ContextoTransacao,
    comando: EnvelopeMensagem,
    input: CancelarTarefaInput,
  ): Promise<void> {
    const tarefaId = montarTarefaId(
      comando.ordemServicoId,
      comando.rodada,
      input.tipoTarefa,
    );
    const existe = await this.tarefas.existeRegistro(contexto, tarefaId);
    const tarefa = await this.tarefas.buscarPorId(contexto, tarefaId);
    const agora = this.agora();

    if (!existe) {
      await this.tarefas.gravarMarcadorBloqueio(
        contexto,
        tarefaId,
        comando.eventId,
        comando.ordemServicoId,
        comando.rodada,
        input.tipoTarefa,
      );
      await this.emitirResposta(
        contexto,
        comando,
        null,
        input.tipoTarefa,
        ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
        agora,
      );
      return;
    }

    if (!tarefa) {
      await this.emitirResposta(
        contexto,
        comando,
        null,
        input.tipoTarefa,
        ResultadoCancelamento.CANCELADA_SEM_EXISTIR,
        agora,
      );
      return;
    }

    if (tarefa.tipo !== input.tipoTarefa) {
      throw new ErroMensagemPermanente(
        `tipoTarefa ${input.tipoTarefa} diverge do registro ${tarefa.tipo}.`,
      );
    }

    const situacao = tarefa.situacao;

    if (situacao === SituacaoTarefa.CONCLUIDA) {
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.JA_CONCLUIDA,
        agora,
      );
      return;
    }

    if (
      situacao === SituacaoTarefa.FALHOU ||
      situacao === SituacaoTarefa.INTERROMPIDA ||
      situacao === SituacaoTarefa.CANCELADA
    ) {
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.JA_ENCERRADA,
        agora,
      );
      return;
    }

    if (situacao === SituacaoTarefa.INTERRUPCAO_SOLICITADA) {
      tarefa.atribuirMotivoCancelamento(input.motivo);
      await this.tarefas.salvar(contexto, tarefa);
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
        agora,
      );
      return;
    }

    if (situacao === SituacaoTarefa.PENDENTE) {
      tarefa.cancelarSemInicio(input.motivo, agora);
      await this.tarefas.salvar(contexto, tarefa);
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.CANCELADA_SEM_INICIO,
        agora,
      );
      return;
    }

    if (
      input.tipoTarefa === TipoTarefa.DIAGNOSTICO &&
      (situacao === SituacaoTarefa.EM_ANDAMENTO ||
        situacao === SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO)
    ) {
      tarefa.cancelarEmAndamento(input.motivo, agora);
      await this.tarefas.salvar(contexto, tarefa);
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
        agora,
      );
      return;
    }

    if (
      input.tipoTarefa === TipoTarefa.REPARO &&
      situacao === SituacaoTarefa.EM_ANDAMENTO
    ) {
      tarefa.atribuirMotivoCancelamento(input.motivo);
      tarefa.solicitarInterrupcao(agora);
      await this.tarefas.salvar(contexto, tarefa);
      await this.emitirResposta(
        contexto,
        comando,
        tarefa,
        input.tipoTarefa,
        ResultadoCancelamento.INTERRUPCAO_SOLICITADA,
        agora,
      );
      return;
    }

    await this.emitirResposta(
      contexto,
      comando,
      tarefa,
      input.tipoTarefa,
      this.resultadoParaEstadoInesperado(situacao, input.tipoTarefa),
      agora,
    );
  }

  private resultadoParaEstadoInesperado(
    situacao: SituacaoTarefa,
    tipo: TipoTarefa,
  ): ResultadoCancelamento {
    if (
      situacao === SituacaoTarefa.EM_ANDAMENTO &&
      tipo === TipoTarefa.REPARO
    ) {
      return ResultadoCancelamento.INTERRUPCAO_SOLICITADA;
    }
    if (
      situacao === SituacaoTarefa.EM_ANDAMENTO ||
      situacao === SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO
    ) {
      return ResultadoCancelamento.CANCELADA_EM_ANDAMENTO;
    }
    return ResultadoCancelamento.JA_ENCERRADA;
  }

  private async emitirResposta(
    contexto: ContextoTransacao,
    comando: EnvelopeMensagem,
    tarefa: import('../../domain/entities/tarefa.entity').Tarefa | null,
    tipoTarefa: TipoTarefa,
    resultado: ResultadoCancelamento,
    agora: Date,
  ): Promise<void> {
    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      tipoTarefa,
      resultado,
    );
    await registrarRespostaCancelamento(
      this.outbox,
      contexto,
      comando,
      payload,
      agora,
    );
  }
}
