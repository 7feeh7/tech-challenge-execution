import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { Injectable } from '@nestjs/common';
import { DynamoDbClientProvider } from './dynamodb-client.provider';
import { DynamoDbContextoTransacao } from './dynamodb-contexto-transacao';
import { DynamoDbTabelasService } from './dynamodb-tabelas.config';
import { TransacaoAninhadaError } from './transacao-aninhada.error';
import { mapearErroTransacaoDynamodb } from './tratar-erro-dynamodb-transacao';
import type { ContextoTransacao, UnitOfWork } from './unit-of-work.port';

const LIMITE_ITENS_TRANSACAO = 100;

@Injectable()
export class DynamoDbUnitOfWork implements UnitOfWork {
  private profundidade = 0;

  constructor(
    private readonly dynamo: DynamoDbClientProvider,
    private readonly tabelas: DynamoDbTabelasService,
  ) {}

  async executar<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T> {
    if (this.profundidade > 0) {
      throw new TransacaoAninhadaError();
    }
    this.profundidade += 1;
    const contexto = new DynamoDbContextoTransacao(
      this.dynamo.client,
      this.tabelas,
    );
    try {
      const resultado = await trabalho(contexto);
      const itens = [...contexto.obterEscritasPendentes()];
      if (itens.length === 0) {
        return resultado;
      }
      await this.gravarTransacao(itens);
      return resultado;
    } finally {
      this.profundidade -= 1;
    }
  }

  private async gravarTransacao(
    itens: import('@aws-sdk/client-dynamodb').TransactWriteItem[],
  ): Promise<void> {
    for (
      let inicio = 0;
      inicio < itens.length;
      inicio += LIMITE_ITENS_TRANSACAO
    ) {
      const lote = itens.slice(inicio, inicio + LIMITE_ITENS_TRANSACAO);
      try {
        await this.dynamo.client.send(
          new TransactWriteItemsCommand({ TransactItems: lote }),
        );
      } catch (erro) {
        mapearErroTransacaoDynamodb(erro);
      }
    }
  }
}
