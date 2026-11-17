import { Inject, Injectable } from '@nestjs/common';
import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import { ehConflitoMensagemProcessada } from '@/shared/database/tratar-erro-dynamodb-transacao';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import { correlationIdStorage } from '@/shared/http/correlation-id.context';
import { JsonLoggerService } from '@/shared/observability/json-logger.service';
import { MessagingMetricsService } from '@/shared/observability/messaging-metrics.service';
import { criarContextoObservabilidadeMensagem } from '../../criar-contexto-observabilidade-mensagem';
import { ConteudoMensagemDivergenteError } from '../../domain/mensageria.errors';
import type { EnvelopeMensagem } from '../../envelope';
import { hashEnvelope } from '../../hash-envelope';
import {
  EnvelopeMensagemInvalidoError,
  validarEnvelopeBase,
} from '../../validar-envelope';
import type { MensagemProcessadaGateway } from '../ports/mensagem-processada.gateway';
import { MENSAGEM_PROCESSADA_GATEWAY } from '../ports/tokens';
import { RoteadorProcessadoresMensagemService } from './roteador-processadores-mensagem.service';

@Injectable()
export class ProcessarMensagemEntradaService {
  constructor(
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
    @Inject(MENSAGEM_PROCESSADA_GATEWAY)
    private readonly mensagensProcessadas: MensagemProcessadaGateway,
    private readonly roteador: RoteadorProcessadoresMensagemService,
    private readonly logger: JsonLoggerService,
    private readonly mensageriaMetrics: MessagingMetricsService,
  ) {}

  async executar(corpoMensagem: string): Promise<void> {
    let envelopeBruto: unknown;
    try {
      envelopeBruto = JSON.parse(corpoMensagem) as unknown;
    } catch {
      throw new EnvelopeMensagemInvalidoError(
        'Corpo da mensagem não é JSON válido.',
      );
    }
    validarEnvelopeBase(envelopeBruto);
    const envelope = envelopeBruto;
    const hash = hashEnvelope(envelope);
    const contextoObservabilidade =
      criarContextoObservabilidadeMensagem(envelope);

    const executarTransacao = async (): Promise<void> => {
      await correlationIdStorage.run(contextoObservabilidade, async () => {
        await this.unitOfWork.executar(async (contexto) => {
          await this.processarNaTransacao(contexto, envelope, hash);
        });
      });
    };

    try {
      await executarTransacao();
    } catch (erro) {
      if (
        ehConflitoMensagemProcessada(erro) ||
        erro instanceof ConflitoTransacionalError
      ) {
        await executarTransacao();
        return;
      }
      throw erro;
    }
  }

  private async processarNaTransacao(
    contexto: import('@/shared/database/unit-of-work.port').ContextoTransacao,
    envelope: EnvelopeMensagem,
    hash: string,
  ): Promise<void> {
    const jaProcessada = await this.mensagensProcessadas.jaProcessada(
      contexto,
      envelope.eventId,
    );
    if (jaProcessada) {
      const hashExistente = await this.mensagensProcessadas.buscarHash(
        contexto,
        envelope.eventId,
      );
      if (hashExistente && hashExistente !== hash) {
        throw new ConteudoMensagemDivergenteError(envelope.eventId);
      }
      this.mensageriaMetrics.recordMensagemProcessada('duplicada');
      this.logger.logWithMeta(
        'debug',
        'mensagem.consumo.duplicada',
        { eventId: envelope.eventId },
        'MensagemConsumo',
      );
      return;
    }

    await this.roteador.processar(contexto, envelope);
    await this.mensagensProcessadas.registrar(contexto, envelope.eventId, hash);
    this.mensageriaMetrics.recordMensagemProcessada('processada');
    this.logger.logWithMeta(
      'info',
      'mensagem.consumo.processada',
      { eventId: envelope.eventId },
      'MensagemConsumo',
    );
  }
}
