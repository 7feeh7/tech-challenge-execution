import { ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';

export interface RegistroOutboxDynamodb {
  eventId: string;
  destino: string;
  envelope: unknown;
  correlationId: string;
  tokenReivindicacao: string | null;
  tentativas: number;
}

@Injectable()
export class DynamoDbOutboxRepositorio {
  constructor(
    private readonly dynamo: DynamoDbClientProvider,
    private readonly tabelas: DynamoDbTabelasService,
  ) {}

  async listarCandidatasPendentes(limite: number): Promise<string[]> {
    const agora = new Date().toISOString();
    const resposta = await this.dynamo.client.send(
      new ScanCommand({
        TableName: this.tabelas.outbox,
        FilterExpression:
          'situacao = :pendente AND attribute_not_exists(enviadoEm) AND (attribute_not_exists(bloqueadoAte) OR bloqueadoAte < :agora)',
        ExpressionAttributeValues: marshall({
          ':pendente': 'PENDENTE',
          ':agora': agora,
        }),
        Limit: Math.min(limite * 5, 100),
      }),
    );

    const itens = (resposta.Items ?? []).map((item) => unmarshall(item));
    return itens
      .sort((a, b) =>
        String(a.criadoEm ?? '').localeCompare(String(b.criadoEm ?? '')),
      )
      .slice(0, limite)
      .map((item) => String(item.eventId));
  }

  async reivindicar(
    eventId: string,
    token: string,
    bloqueadoAte: string,
  ): Promise<RegistroOutboxDynamodb | null> {
    const agora = new Date().toISOString();
    try {
      const resposta = await this.dynamo.client.send(
        new UpdateItemCommand({
          TableName: this.tabelas.outbox,
          Key: marshall({ eventId }),
          UpdateExpression:
            'SET tokenReivindicacao = :token, bloqueadoAte = :bloqueadoAte',
          ConditionExpression:
            'situacao = :pendente AND attribute_not_exists(enviadoEm) AND (attribute_not_exists(bloqueadoAte) OR bloqueadoAte < :agora) AND (attribute_not_exists(tokenReivindicacao) OR bloqueadoAte < :agora)',
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
      await this.dynamo.client.send(
        new UpdateItemCommand({
          TableName: this.tabelas.outbox,
          Key: marshall({ eventId }),
          UpdateExpression:
            'SET enviadoEm = :agora, situacao = :enviada, tokenReivindicacao = :nulo, bloqueadoAte = :nulo',
          ConditionExpression:
            'tokenReivindicacao = :token AND attribute_not_exists(enviadoEm)',
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
  ): Promise<void> {
    await this.dynamo.client.send(
      new UpdateItemCommand({
        TableName: this.tabelas.outbox,
        Key: marshall({ eventId }),
        UpdateExpression:
          'SET tentativas = :tentativas, bloqueadoAte = :bloqueadoAte, tokenReivindicacao = :nulo',
        ConditionExpression: 'tokenReivindicacao = :token',
        ExpressionAttributeValues: marshall({
          ':tentativas': tentativas,
          ':bloqueadoAte': bloqueadoAte,
          ':nulo': null,
          ':token': token,
        }),
      }),
    );
  }

  async contarPendentes(): Promise<number> {
    const resposta = await this.dynamo.client.send(
      new ScanCommand({
        TableName: this.tabelas.outbox,
        FilterExpression:
          'situacao = :pendente AND attribute_not_exists(enviadoEm)',
        ExpressionAttributeValues: marshall({ ':pendente': 'PENDENTE' }),
        Select: 'COUNT',
      }),
    );
    return resposta.Count ?? 0;
  }
}
