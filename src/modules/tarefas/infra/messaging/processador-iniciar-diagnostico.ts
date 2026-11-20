import { Injectable } from '@nestjs/common';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { ProcessadorMensagem } from '@/shared/messaging/application/ports/processador-mensagem.port';
import { ErroMensagemPermanente } from '@/shared/messaging/domain/mensageria.errors';
import {
  COMANDO_INICIAR_DIAGNOSTICO,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';
import { CriarTarefaDiagnosticoUseCase } from '../../application/use-cases/criar-tarefa-diagnostico.use-case';
import type { ItemDiagnostico } from '../../domain/entities/tarefa.entity';

type Registro = Record<string, unknown>;

@Injectable()
export class ProcessadorIniciarDiagnostico implements ProcessadorMensagem {
  readonly eventType = COMANDO_INICIAR_DIAGNOSTICO;

  constructor(private readonly criarTarefa: CriarTarefaDiagnosticoUseCase) {}

  async processar(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem,
  ): Promise<void> {
    const payload = envelope.payload as Registro | null;
    const veiculo = payload?.veiculo as Registro | undefined;

    if (
      typeof envelope.ordemServicoId !== 'string' ||
      !envelope.ordemServicoId
    ) {
      throw new ErroMensagemPermanente('ordemServicoId inválido no comando.');
    }
    if (!Number.isInteger(envelope.rodada) || envelope.rodada < 1) {
      throw new ErroMensagemPermanente('rodada inválida no comando.');
    }
    if (
      typeof veiculo?.placa !== 'string' ||
      typeof veiculo?.modelo !== 'string'
    ) {
      throw new ErroMensagemPermanente('veiculo inválido no comando.');
    }
    if (typeof payload?.descricaoProblema !== 'string') {
      throw new ErroMensagemPermanente(
        'descricaoProblema inválida no comando.',
      );
    }

    await this.criarTarefa.execute(contexto, {
      ordemServicoId: envelope.ordemServicoId,
      rodada: envelope.rodada,
      correlationId: envelope.correlationId,
      veiculo: { placa: veiculo.placa, modelo: veiculo.modelo },
      descricaoProblema: payload.descricaoProblema,
      sugestoes: this.lerSugestoes(payload.sugestoes),
    });
  }

  private lerSugestoes(bruto: unknown): ItemDiagnostico[] {
    if (bruto === undefined) return [];
    if (!Array.isArray(bruto)) {
      throw new ErroMensagemPermanente('sugestoes inválidas no comando.');
    }
    return bruto.map((item: Registro) => {
      const valido =
        (item?.tipo === 'PECA' || item?.tipo === 'SERVICO') &&
        typeof item.itemId === 'string' &&
        Number.isInteger(item.quantidade) &&
        (item.quantidade as number) > 0;
      if (!valido) {
        throw new ErroMensagemPermanente('item de sugestoes inválido.');
      }
      return {
        tipo: item.tipo as 'PECA' | 'SERVICO',
        itemId: item.itemId as string,
        quantidade: item.quantidade as number,
      };
    });
  }
}
