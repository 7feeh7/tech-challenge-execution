import { AsyncLocalStorage } from 'node:async_hooks';
import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { Injectable } from '@nestjs/common';
import { DynamoDbClientProvider } from './dynamodb-client.provider';
import { DynamoDbContextoTransacao } from './dynamodb-contexto-transacao';
import { DynamoDbTabelasService } from './dynamodb-tabelas.config';
import { LimiteTransacaoExcedidoError } from './limite-transacao-excedido.error';
import { TransacaoAninhadaError } from './transacao-aninhada.error';
import { mapearErroTransacaoDynamodb } from './tratar-erro-dynamodb-transacao';
import type { ContextoTransacao, UnitOfWork } from './unit-of-work.port';

const LIMITE_ITENS_TRANSACAO = 100;

@Injectable()
export class DynamoDbUnitOfWork implements UnitOfWork {
  // Por fluxo assíncrono, não por instância: requisições HTTP e o consumidor
  // executam transações concorrentes no mesmo singleton.
  private readonly emTransacao = new AsyncLocalStorage<true>();

  constructor(
    private readonly dynamo: DynamoDbClientProvider,
    private readonly tabelas: DynamoDbTabelasService,
  ) {}

  async executar<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T> {
    if (this.emTransacao.getStore()) {
      throw new TransacaoAninhadaError();
    }
    return this.emTransacao.run(true, () => this.executarIsolado(trabalho));
  }

  private async executarIsolado<T>(
    trabalho: (contexto: ContextoTransacao) => Promise<T>,
  ): Promise<T> {
    const contexto = new DynamoDbContextoTransacao(this.dynamo, this.tabelas);
    const resultado = await trabalho(contexto);
    const itens = [...contexto.obterEscritasPendentes()];
    if (itens.length === 0) {
      return resultado;
    }
    if (itens.length > LIMITE_ITENS_TRANSACAO) {
      throw new LimiteTransacaoExcedidoError(
        itens.length,
        LIMITE_ITENS_TRANSACAO,
      );
    }
    await this.gravarTransacaoUnica(itens);
    return resultado;
  }

  private async gravarTransacaoUnica(
    itens: import('@aws-sdk/client-dynamodb').TransactWriteItem[],
  ): Promise<void> {
    try {
      await this.dynamo.enviar(
        new TransactWriteItemsCommand({ TransactItems: itens }),
      );
    } catch (erro) {
      mapearErroTransacaoDynamodb(erro);
    }
  }
}
