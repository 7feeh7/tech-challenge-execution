import { Inject, Injectable } from '@nestjs/common';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { MarcadorEfeitoGateway } from '@/shared/messaging/application/ports/marcador-efeito.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import type { ProcessadorMensagem } from '@/shared/messaging/application/ports/processador-mensagem.port';
import {
  MARCADOR_EFEITO_GATEWAY,
  OUTBOX_GATEWAY,
} from '@/shared/messaging/application/ports/tokens';
import {
  COMANDO_INICIAR_DIAGNOSTICO,
  DESTINO_FILA_OS,
  type EnvelopeMensagem,
} from '@/shared/messaging/envelope';

@Injectable()
export class ProcessadorMarcadorTeste implements ProcessadorMensagem {
  readonly eventType = COMANDO_INICIAR_DIAGNOSTICO;

  constructor(
    @Inject(MARCADOR_EFEITO_GATEWAY)
    private readonly marcador: MarcadorEfeitoGateway,
    @Inject(OUTBOX_GATEWAY)
    private readonly outbox: OutboxGateway,
  ) {}

  async processar(
    contexto: ContextoTransacao,
    envelope: EnvelopeMensagem,
  ): Promise<void> {
    const pk = `${envelope.ordemServicoId}#${envelope.rodada}#DIAGNOSTICO`;
    await this.marcador.gravarMarcador(contexto, pk, envelope.eventId);
    const eventoId = `saida-${envelope.eventId}`;
    await this.outbox.registrar(contexto, {
      eventId: eventoId,
      eventType: 'execution.diagnostico-iniciado.v1',
      envelope: {
        ...envelope,
        eventId: eventoId,
        eventType: 'execution.diagnostico-iniciado.v1',
        source: 'execution',
        causationId: envelope.eventId,
      },
      correlationId: envelope.correlationId,
      causationId: envelope.eventId,
      destino: DESTINO_FILA_OS,
    });
  }
}
