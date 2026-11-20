import { Injectable } from '@nestjs/common';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { ProcessadorMensagem } from '@/shared/messaging/application/ports/processador-mensagem.port';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import {
  COMANDO_INICIAR_REPARO,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';
import { CriarTarefaReparoUseCase } from '../../application/use-cases/criar-tarefa-reparo.use-case';
import type { ItemOficial } from '../../domain/entities/tarefa.entity';

type Registro = Record<string, unknown>;

@Injectable()
export class ProcessadorIniciarReparo implements ProcessadorMensagem {
  readonly eventType = COMANDO_INICIAR_REPARO;

  constructor(private readonly criarTarefa: CriarTarefaReparoUseCase) {}

  async processar(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem,
  ): Promise<void> {
    const payload = envelope.payload as Registro | null;

    if (
      typeof envelope.ordemServicoId !== 'string' ||
      !envelope.ordemServicoId
    ) {
      throw new ErroMensagemPermanente('ordemServicoId inválido no comando.');
    }
    if (!Number.isInteger(envelope.rodada) || envelope.rodada < 1) {
      throw new ErroMensagemPermanente('rodada inválida no comando.');
    }

    await this.criarTarefa.execute(contexto, {
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      correlationId: envelope.correlationId,
      itensOficiais: this.lerItensOficiais(payload?.itensOficiais),
    });
  }

  private lerItensOficiais(bruto: unknown): ItemOficial[] {
    if (bruto === undefined) {
      throw new ErroMensagemPermanente('itensOficiais ausentes no comando.');
    }
    if (!Array.isArray(bruto)) {
      throw new ErroMensagemPermanente('itensOficiais inválidos no comando.');
    }
    return bruto.map((item: Registro) => {
      const valido =
        (item?.tipo === 'PECA' || item?.tipo === 'SERVICO') &&
        typeof item.itemId === 'string' &&
        typeof item.nome === 'string' &&
        Number.isInteger(item.quantidade) &&
        (item.quantidade as number) > 0;
      if (!valido) {
        throw new ErroMensagemPermanente('item de itensOficiais inválido.');
      }
      return {
        tipo: item.tipo as 'PECA' | 'SERVICO',
        itemId: item.itemId as string,
        nome: item.nome as string,
        quantidade: item.quantidade as number,
      };
    });
  }
}
