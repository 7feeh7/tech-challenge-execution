import type {
  AttributeValue,
  DynamoDBClient,
  TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDbTabelasConfig } from './dynamodb-tabelas.config';
import {
  type ContextoTransacao,
  ContextoTransacaoMarca,
} from './unit-of-work.port';

export interface OperacaoEscritaPendente {
  readonly tabela: string;
  readonly item: TransactWriteItem;
}

export class DynamoDbContextoTransacao implements ContextoTransacao {
  readonly [ContextoTransacaoMarca] = undefined;

  private readonly escritas: TransactWriteItem[] = [];
  private readonly cacheLeitura = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly client: DynamoDBClient,
    private readonly tabelas: DynamoDbTabelasConfig,
  ) {}

  adicionarEscrita(item: TransactWriteItem): void {
    this.escritas.push(item);
  }

  obterEscritasPendentes(): readonly TransactWriteItem[] {
    return this.escritas;
  }

  async obterRegistro(
    tabela: string,
    chave: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const cacheKey = `${tabela}#${JSON.stringify(chave)}`;
    const emCache = this.cacheLeitura.get(cacheKey);
    if (emCache !== undefined) {
      return emCache;
    }

    const resposta = await this.client.send(
      new GetItemCommand({
        TableName: tabela,
        Key: marshall(chave) as Record<string, AttributeValue>,
        ConsistentRead: true,
      }),
    );

    const item = resposta.Item
      ? (Object.fromEntries(
          Object.entries(resposta.Item).map(([k, v]) => [
            k,
            deserializarAtributo(v),
          ]),
        ) as Record<string, unknown>)
      : null;

    if (item) {
      this.cacheLeitura.set(cacheKey, item);
    }
    return item;
  }

  nomeTabelaTarefas(): string {
    return this.tabelas.tarefas;
  }

  nomeTabelaOutbox(): string {
    return this.tabelas.outbox;
  }

  nomeTabelaMensagensProcessadas(): string {
    return this.tabelas.mensagensProcessadas;
  }
}

function deserializarAtributo(atributo: AttributeValue): unknown {
  if ('S' in atributo && atributo.S !== undefined) return atributo.S;
  if ('N' in atributo && atributo.N !== undefined) return Number(atributo.N);
  if ('BOOL' in atributo && atributo.BOOL !== undefined) return atributo.BOOL;
  if ('NULL' in atributo && atributo.NULL) return null;
  if ('M' in atributo && atributo.M) {
    return Object.fromEntries(
      Object.entries(atributo.M).map(([k, v]) => [k, deserializarAtributo(v)]),
    );
  }
  if ('L' in atributo && atributo.L) {
    return atributo.L.map(deserializarAtributo);
  }
  return undefined;
}
