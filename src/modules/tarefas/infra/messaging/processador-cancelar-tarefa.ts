import { Injectable } from '@nestjs/common';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { ProcessadorMensagem } from '@/shared/messaging/application/ports/processador-mensagem.port';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import {
  COMANDO_CANCELAR_TAREFA,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';
import { CancelarTarefaUseCase } from '../../application/use-cases/cancelar-tarefa.use-case';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';

type Registro = Record<string, unknown>;

@Injectable()
export class ProcessadorCancelarTarefa implements ProcessadorMensagem {
  readonly eventType = COMANDO_CANCELAR_TAREFA;

  constructor(private readonly cancelar: CancelarTarefaUseCase) {}

  async processar(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem,
  ): Promise<void> {
    const payload = envelope.payload as Registro | null;
    const tipoTarefa = this.lerTipoTarefa(payload?.tipoTarefa);
    const motivo = this.lerMotivo(payload?.motivo);

    if (
      typeof envelope.ordemServicoId !== 'string' ||
      !envelope.ordemServicoId
    ) {
      throw new ErroMensagemPermanente('ordemServicoId inválido no comando.');
    }
    if (!Number.isInteger(envelope.rodada) || envelope.rodada < 1) {
      throw new ErroMensagemPermanente('rodada inválida no comando.');
    }
    if (typeof envelope.correlationId !== 'string' || !envelope.correlationId) {
      throw new ErroMensagemPermanente('correlationId inválido no comando.');
    }

    await this.cancelar.execute(contexto, envelope, { tipoTarefa, motivo });
  }

  private lerTipoTarefa(bruto: unknown): TipoTarefa {
    if (bruto === TipoTarefa.DIAGNOSTICO || bruto === TipoTarefa.REPARO) {
      return bruto;
    }
    throw new ErroMensagemPermanente('tipoTarefa inválido no comando.');
  }

  private lerMotivo(bruto: unknown): string | null {
    if (bruto === undefined || bruto === null) {
      return null;
    }
    if (typeof bruto !== 'string') {
      throw new ErroMensagemPermanente('motivo inválido no comando.');
    }
    const motivo = bruto.trim();
    return motivo || null;
  }
}
