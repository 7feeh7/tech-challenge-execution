import { Injectable } from '@nestjs/common';
import { DynamoDbOutboxRepositorio } from '@/shared/messaging/infra/persistence/dynamodb-outbox-repositorio';
import { MetricsService } from './metrics.service';
import { METRIC_NAMES } from './observability.config';

export type ResultadoProcessamentoMensagem = 'processada' | 'duplicada';
export type TipoErroConsumoMensagem = 'transitorio' | 'permanente';

@Injectable()
export class MessagingMetricsService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly outboxRepo: DynamoDbOutboxRepositorio,
  ) {}

  recordPublicacaoFalha(): void {
    this.metrics.increment(METRIC_NAMES.outboxPublicacaoFalha, 1);
  }

  recordMensagemProcessada(resultado: ResultadoProcessamentoMensagem): void {
    this.metrics.increment(METRIC_NAMES.mensagemProcessada, 1, [
      `resultado:${resultado}`,
    ]);
  }

  recordErroConsumo(tipo: TipoErroConsumoMensagem): void {
    this.metrics.increment(METRIC_NAMES.mensagemErroConsumo, 1, [
      `tipo:${tipo}`,
    ]);
  }

  async recordOutboxBacklog(): Promise<void> {
    const pendentes = await this.outboxRepo.contarPendentes();
    this.metrics.gauge(METRIC_NAMES.outboxPendentes, pendentes);
  }
}
