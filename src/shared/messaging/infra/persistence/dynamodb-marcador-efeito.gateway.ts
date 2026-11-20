import { marshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import { obterContextoDynamodb } from '@/shared/database/obter-contexto-dynamodb';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { MarcadorEfeitoGateway } from '../../application/ports/marcador-efeito.gateway';

@Injectable()
export class DynamoDbMarcadorEfeitoGateway implements MarcadorEfeitoGateway {
  async gravarMarcador(
    contexto: ContextoTransacao,
    chavePk: string,
    eventId: string,
  ): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaTarefas(),
        Item: marshall({
          pk: chavePk,
          tipo: 'MARCADOR_TESTE',
          eventIdOrigem: eventId,
          situacao: 'PENDENTE',
          atualizadoEm: new Date().toISOString(),
        }),
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    });
  }
}
