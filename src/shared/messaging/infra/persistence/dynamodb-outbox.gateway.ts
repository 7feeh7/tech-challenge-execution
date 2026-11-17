import { marshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import { obterContextoDynamodb } from '@/shared/database/obter-contexto-dynamodb';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  OutboxGateway,
  RegistrarOutboxInput,
} from '../../application/ports/outbox.gateway';

@Injectable()
export class DynamoDbOutboxGateway implements OutboxGateway {
  async registrar(
    contexto: ContextoTransacao,
    input: RegistrarOutboxInput,
  ): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    const agora = new Date().toISOString();
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaOutbox(),
        Item: marshall(
          {
            eventId: input.eventId,
            eventType: input.eventType,
            envelope: input.envelope,
            correlationId: input.correlationId,
            causationId: input.causationId,
            destino: input.destino,
            situacao: 'PENDENTE',
            criadoEm: agora,
            tentativas: 0,
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: 'attribute_not_exists(eventId)',
      },
    });
  }
}
