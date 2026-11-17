import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { correlationIdStorage } from '@/shared/http/correlation-id.context';
import { JsonLoggerService } from '@/shared/observability/json-logger.service';
import { MessagingMetricsService } from '@/shared/observability/messaging-metrics.service';
import { calcularBloqueadoAteRetentativaOutbox } from '../../application/calcular-espera-retentativa-outbox';
import type { FilaMensagensGateway } from '../../application/ports/fila-mensagens.gateway';
import { FILA_MENSAGENS } from '../../application/ports/tokens';
import { DESTINO_FILA_OS, type EnvelopeMensagem } from '../../envelope';
import { AgendadorCicloProcessador } from '../agendador-ciclo-processador';
import {
  DynamoDbOutboxRepositorio,
  type RegistroOutboxDynamodb,
} from '../persistence/dynamodb-outbox-repositorio';

@Injectable()
export class PublicadorOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicadorOutboxService.name);
  private agendador?: AgendadorCicloProcessador;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;
  private readonly loteMaximo: number;
  private readonly retentativaBaseMs: number;
  private readonly retentativaTetoMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly outboxRepo: DynamoDbOutboxRepositorio,
    @Inject(FILA_MENSAGENS)
    private readonly fila: FilaMensagensGateway,
    private readonly jsonLogger: JsonLoggerService,
    private readonly mensageriaMetrics: MessagingMetricsService,
  ) {
    this.habilitado =
      this.config.get<string>('OUTBOX_PUBLISHER_HABILITADO') === 'true';
    this.intervaloMs = Number(
      this.config.get<string>('OUTBOX_PUBLISHER_INTERVAL_MS') ?? '2000',
    );
    this.posseMs = Number(
      this.config.get<string>('OUTBOX_REIVINDICACAO_MS') ?? '300000',
    );
    this.loteMaximo = Number(
      this.config.get<string>('OUTBOX_PUBLISHER_LOTE') ?? '5',
    );
    this.retentativaBaseMs = Number(
      this.config.get<string>('OUTBOX_RETRY_BASE_MS') ?? '1000',
    );
    this.retentativaTetoMs = Number(
      this.config.get<string>('OUTBOX_RETRY_TETO_MS') ?? '300000',
    );
  }

  onModuleInit(): void {
    if (!this.habilitado) return;

    this.agendador = new AgendadorCicloProcessador(
      this.intervaloMs,
      () => this.publicarLote(),
      this.logger,
      'Falha ao publicar outbox',
    );
    this.agendador.iniciar();
  }

  async onModuleDestroy(): Promise<void> {
    await this.agendador?.parar();
  }

  async publicarLote(): Promise<void> {
    const mensagens = await this.reivindicarLote();
    for (const mensagem of mensagens) {
      await this.publicarMensagemReivindicada(mensagem);
    }
    await this.mensageriaMetrics.recordOutboxBacklog();
  }

  async reivindicarLote(): Promise<RegistroOutboxDynamodb[]> {
    const candidatas = await this.outboxRepo.listarCandidatasPendentes(
      this.loteMaximo,
    );
    if (candidatas.length === 0) return [];

    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + this.posseMs).toISOString();
    const reivindicadas: RegistroOutboxDynamodb[] = [];

    for (const eventId of candidatas) {
      const token = randomUUID();
      const registro = await this.outboxRepo.reivindicar(
        eventId,
        token,
        bloqueadoAte,
      );
      if (registro?.tokenReivindicacao === token) {
        reivindicadas.push(registro);
      }
      if (reivindicadas.length >= this.loteMaximo) break;
    }
    return reivindicadas;
  }

  async publicarMensagemReivindicada(
    mensagem: RegistroOutboxDynamodb,
  ): Promise<void> {
    const token = mensagem.tokenReivindicacao;
    if (!token) return;

    try {
      await correlationIdStorage.run(
        {
          correlationId: mensagem.correlationId,
          requestId: randomUUID(),
          eventId: mensagem.eventId,
        },
        async () => {
          await this.enviarParaDestino(mensagem.destino, mensagem);
        },
      );
      const confirmado = await this.outboxRepo.confirmarEnvio(
        mensagem.eventId,
        token,
      );
      if (!confirmado) {
        this.jsonLogger.logWithMeta(
          'warn',
          'outbox.publicacao.fencing',
          { eventId: mensagem.eventId },
          'OutboxPublicador',
        );
      }
    } catch (erro) {
      this.mensageriaMetrics.recordPublicacaoFalha();
      this.jsonLogger.logWithMeta(
        'warn',
        'outbox.publicacao.falha',
        {
          eventId: mensagem.eventId,
          error: erro instanceof Error ? erro.message : 'erro desconhecido',
        },
        'OutboxPublicador',
      );
      const novasTentativas = (mensagem.tentativas ?? 0) + 1;
      const bloqueadoAte = calcularBloqueadoAteRetentativaOutbox(
        novasTentativas,
        this.retentativaBaseMs,
        this.retentativaTetoMs,
      ).toISOString();
      await this.outboxRepo.liberarAposFalha(
        mensagem.eventId,
        token,
        bloqueadoAte,
        novasTentativas,
      );
    }
  }

  private async enviarParaDestino(
    destino: string,
    mensagem: RegistroOutboxDynamodb,
  ): Promise<void> {
    const envelope = mensagem.envelope as EnvelopeMensagem;
    if (destino !== DESTINO_FILA_OS) {
      throw new Error(`Destino de outbox desconhecido: ${destino}`);
    }
    const filaUrl = this.config.getOrThrow<string>('SQS_OS_IN_URL');
    await this.fila.enviar(filaUrl, envelope, mensagem.correlationId);
  }
}
