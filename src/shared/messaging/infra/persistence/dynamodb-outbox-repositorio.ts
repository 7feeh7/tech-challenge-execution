import {
  QueryCommand,
  type QueryCommandOutput,
  UpdateItemCommand,
  type UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  OUTBOX_ATTR_INDICE_PENDENTE,
  OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
  OUTBOX_GSI_PUBLICACAO_PENDENTE,
  OUTBOX_VALOR_INDICE_PENDENTE,
} from '@/shared/database/dynamodb-indices.constants';
import { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';
import { OUTBOX_GSI_MAX_PAGINAS_PADRAO } from '@/shared/messaging/application/calcular-prazos-operacionais-execution';

export interface RegistroOutboxDynamodb {
  eventId: string;
  destino: string;
  envelope: unknown;
  correlationId: string;
  tokenReivindicacao: string | null;
  tentativas: number;
}

const EXPRESSAO_ELEGIVEL =
  'attribute_not_exists(enviadoEm) AND situacao = :pendente AND (attribute_not_exists(bloqueadoAte) OR bloqueadoAte < :agora) AND (attribute_not_exists(tokenReivindicacao) OR bloqueadoAte < :agora)';

@Injectable()
export class DynamoDbOutboxRepositorio {
  private readonly gsiMaxPaginas: number;

  constructor(
    private readonly dynamo: DynamoDbClientProvider,
    private readonly tabelas: DynamoDbTabelasService,
    config: ConfigService,
  ) {
    this.gsiMaxPaginas = Number(
      config.get<string>('OUTBOX_GSI_MAX_PAGINAS') ??
        String(OUTBOX_GSI_MAX_PAGINAS_PADRAO),
    );
  }

  async listarCandidatasPendentes(limite: number): Promise<string[]> {
    const agora = new Date().toISOString();
    const elegiveis: string[] = [];
    let lastKey: Record<string, unknown> | undefined;
    let paginas = 0;

    while (elegiveis.length < limite && paginas < this.gsiMaxPaginas) {
      paginas++;
      const resposta = await this.dynamo.enviar<QueryCommandOutput>(
        new QueryCommand({
          TableName: this.tabelas.outbox,
          IndexName: OUTBOX_GSI_PUBLICACAO_PENDENTE,
          KeyConditionExpression: `${OUTBOX_ATTR_INDICE_PENDENTE} = :indice`,
          FilterExpression: EXPRESSAO_ELEGIVEL,
          ExpressionAttributeValues: marshall({
            ':indice': OUTBOX_VALOR_INDICE_PENDENTE,
            ':pendente': 'PENDENTE',
            ':agora': agora,
          }),
          Limit: Math.max(limite * 2, 25),
          ExclusiveStartKey: lastKey
            ? marshall(lastKey, { removeUndefinedValues: true })
            : undefined,
        }),
      );

      for (const item of resposta.Items ?? []) {
        const registro = unmarshall(item);
        elegiveis.push(String(registro.eventId));
        if (elegiveis.length >= limite) break;
      }

      if (!resposta.LastEvaluatedKey) break;
      lastKey = unmarshall(resposta.LastEvaluatedKey);
    }

    return elegiveis;
  }

  async reivindicar(
    eventId: string,
    token: string,
    bloqueadoAte: string,
  ): Promise<RegistroOutboxDynamodb | null> {
    const agora = new Date().toISOString();
    try {
      const resposta = await this.dynamo.enviar<UpdateItemCommandOutput>(
        new UpdateItemCommand({
          TableName: this.tabelas.outbox,
          Key: marshall({ eventId }),
          UpdateExpression:
            'SET tokenReivindicacao = :token, bloqueadoAte = :bloqueadoAte',
          ConditionExpression: EXPRESSAO_ELEGIVEL,
          ExpressionAttributeValues: marshall({
            ':token': token,
            ':bloqueadoAte': bloqueadoAte,
            ':pendente': 'PENDENTE',
            ':agora': agora,
          }),
          ReturnValues: 'ALL_NEW',
        }),
      );
      if (!resposta.Attributes) return null;
      const item = unmarshall(resposta.Attributes);
      return {
        eventId: String(item.eventId),
        destino: String(item.destino),
        envelope: item.envelope,
        correlationId: String(item.correlationId),
        tokenReivindicacao: item.tokenReivindicacao
          ? String(item.tokenReivindicacao)
          : null,
        tentativas: Number(item.tentativas ?? 0),
      };
    } catch (erro) {
      const nome = (erro as { name?: string }).name;
      if (nome === 'ConditionalCheckFailedException') {
        return null;
      }
      throw erro;
    }
  }

  async confirmarEnvio(eventId: string, token: string): Promise<boolean> {
    const agora = new Date().toISOString();
    try {
      await this.dynamo.enviar(
        new UpdateItemCommand({
          TableName: this.tabelas.outbox,
          Key: marshall({ eventId }),
          UpdateExpression:
            'SET enviadoEm = :agora, situacao = :enviada, tokenReivindicacao = :nulo, bloqueadoAte = :nulo REMOVE #indice, #ordem',
          ConditionExpression:
            'tokenReivindicacao = :token AND attribute_not_exists(enviadoEm)',
          ExpressionAttributeNames: {
            '#indice': OUTBOX_ATTR_INDICE_PENDENTE,
            '#ordem': OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
          },
          ExpressionAttributeValues: marshall({
            ':agora': agora,
            ':enviada': 'ENVIADA',
            ':nulo': null,
            ':token': token,
          }),
        }),
      );
      return true;
    } catch (erro) {
      const nome = (erro as { name?: string }).name;
      if (nome === 'ConditionalCheckFailedException') {
        return false;
      }
      throw erro;
    }
  }

  async liberarAposFalha(
    eventId: string,
    token: string,
    bloqueadoAte: string,
    tentativas: number,
  ): Promise<boolean> {
    const agora = new Date().toISOString();
    try {
      await this.dynamo.enviar(
        new UpdateItemCommand({
          TableName: this.tabelas.outbox,
          Key: marshall({ eventId }),
          UpdateExpression:
            'SET tentativas = :tentativas, bloqueadoAte = :bloqueadoAte, tokenReivindicacao = :nulo, #indice = :indice, #ordem = if_not_exists(#ordem, :agora)',
          ConditionExpression: 'tokenReivindicacao = :token',
          ExpressionAttributeNames: {
            '#indice': OUTBOX_ATTR_INDICE_PENDENTE,
            '#ordem': OUTBOX_ATTR_INDICE_PENDENTE_ORDEM,
          },
          ExpressionAttributeValues: marshall({
            ':tentativas': tentativas,
            ':bloqueadoAte': bloqueadoAte,
            ':nulo': null,
            ':token': token,
            ':indice': OUTBOX_VALOR_INDICE_PENDENTE,
            ':agora': agora,
          }),
        }),
      );
      return true;
    } catch (erro) {
      const nome = (erro as { name?: string }).name;
      if (nome === 'ConditionalCheckFailedException') {
        return false;
      }
      throw erro;
    }
  }

  async contarPendentes(): Promise<number> {
    const agora = new Date().toISOString();
    let total = 0;
    let lastKey: Record<string, unknown> | undefined;

    do {
      const resposta = await this.dynamo.enviar<QueryCommandOutput>(
        new QueryCommand({
          TableName: this.tabelas.outbox,
          IndexName: OUTBOX_GSI_PUBLICACAO_PENDENTE,
          KeyConditionExpression: `${OUTBOX_ATTR_INDICE_PENDENTE} = :indice`,
          FilterExpression: EXPRESSAO_ELEGIVEL,
          ExpressionAttributeValues: marshall({
            ':indice': OUTBOX_VALOR_INDICE_PENDENTE,
            ':pendente': 'PENDENTE',
            ':agora': agora,
          }),
          Select: 'COUNT',
          ExclusiveStartKey: lastKey
            ? marshall(lastKey, { removeUndefinedValues: true })
            : undefined,
        }),
      );
      total += resposta.Count ?? 0;
      lastKey = resposta.LastEvaluatedKey
        ? unmarshall(resposta.LastEvaluatedKey)
        : undefined;
    } while (lastKey);

    return total;
  }
}
