import { marshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import { obterContextoDynamodb } from '@/shared/database/obter-contexto-dynamodb';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { MensagemProcessadaGateway } from '../../application/ports/mensagem-processada.gateway';

@Injectable()
export class DynamoDbMensagemProcessadaGateway
  implements MensagemProcessadaGateway
{
  async jaProcessada(
    contexto: ContextoTransacao,
    eventId: string,
  ): Promise<boolean> {
    const ctx = obterContextoDynamodb(contexto);
    const registro = await ctx.obterRegistro(
      ctx.nomeTabelaMensagensProcessadas(),
      { eventId },
    );
    return registro !== null;
  }

  async registrar(
    contexto: ContextoTransacao,
    eventId: string,
    hashConteudo: string,
  ): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    const agora = new Date().toISOString();
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaMensagensProcessadas(),
        Item: marshall({
          eventId,
          hashConteudo,
          processadoEm: agora,
        }),
        ConditionExpression: 'attribute_not_exists(eventId)',
      },
    });
  }

  async buscarHash(
    contexto: ContextoTransacao,
    eventId: string,
  ): Promise<string | null> {
    const ctx = obterContextoDynamodb(contexto);
    const registro = await ctx.obterRegistro(
      ctx.nomeTabelaMensagensProcessadas(),
      { eventId },
    );
    if (!registro) return null;
    const hash = registro.hashConteudo;
    return typeof hash === 'string' ? hash : null;
  }
}
