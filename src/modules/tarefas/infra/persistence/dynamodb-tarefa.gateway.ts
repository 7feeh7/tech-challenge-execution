import {
  GetItemCommand,
  type GetItemCommandOutput,
  QueryCommand,
  type QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Injectable } from '@nestjs/common';
import type {
  ResponsavelTarefa,
  ResponsavelTarefaGateway,
} from '@/modules/auth/ports/responsavel-tarefa.gateway';
import { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import {
  montarIndiceFilaTarefa,
  TAREFAS_ATTR_INDICE_FILA,
  TAREFAS_ATTR_INDICE_FILA_ORDEM,
  TAREFAS_GSI_FILA,
} from '@/shared/database/dynamodb-indices.constants';
import { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';
import { obterContextoDynamodb } from '@/shared/database/obter-contexto-dynamodb';
import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type {
  FiltroFilaTarefas,
  PaginaTarefas,
  TarefaGateway,
} from '../../application/ports/tarefa.gateway';
import type { Tarefa } from '../../domain/entities/tarefa.entity';
import { CursorTarefasInvalidoError } from '../../domain/errors/tarefa.errors';
import { TIPO_REGISTRO_MARCADOR_BLOQUEIO } from '../../domain/marcador-bloqueio';
import {
  ehTarefa,
  tarefaToDomain,
  tarefaToItem,
} from './dynamodb-tarefa.mapper';

@Injectable()
export class DynamoDbTarefaGateway
  implements TarefaGateway, ResponsavelTarefaGateway
{
  constructor(
    private readonly dynamo: DynamoDbClientProvider,
    private readonly tabelas: DynamoDbTabelasService,
  ) {}

  async buscarPorId(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<Tarefa | null> {
    const ctx = obterContextoDynamodb(contexto);
    const registro = await ctx.obterRegistro(ctx.nomeTabelaTarefas(), {
      pk: id,
    });
    if (!registro || !ehTarefa(registro)) return null;
    return tarefaToDomain(registro);
  }

  async existeRegistro(
    contexto: ContextoTransacao,
    id: string,
  ): Promise<boolean> {
    const ctx = obterContextoDynamodb(contexto);
    const registro = await ctx.obterRegistro(ctx.nomeTabelaTarefas(), {
      pk: id,
    });
    return registro !== null;
  }

  async gravarMarcadorBloqueio(
    contexto: ContextoTransacao,
    id: string,
    cancelamentoEventId: string,
    ordemServicoId: string,
    rodada: number,
    tipoTarefa: string,
  ): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    const agora = new Date().toISOString();
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaTarefas(),
        Item: marshall(
          {
            pk: id,
            tipo: TIPO_REGISTRO_MARCADOR_BLOQUEIO,
            ordemServicoId,
            rodada,
            tipoTarefa,
            cancelamentoEventId,
            criadoEm: agora,
            atualizadoEm: agora,
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    });
  }

  async criar(contexto: ContextoTransacao, tarefa: Tarefa): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaTarefas(),
        Item: marshall(tarefaToItem(tarefa), {
          removeUndefinedValues: true,
        }),
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    });
  }

  async salvar(contexto: ContextoTransacao, tarefa: Tarefa): Promise<void> {
    const ctx = obterContextoDynamodb(contexto);
    ctx.adicionarEscrita({
      Put: {
        TableName: ctx.nomeTabelaTarefas(),
        Item: marshall(tarefaToItem(tarefa), {
          removeUndefinedValues: true,
        }),
        ConditionExpression: 'versao = :versaoLida',
        ExpressionAttributeValues: marshall({ ':versaoLida': tarefa.versao }),
      },
    });
  }

  async consultarPorId(id: string): Promise<Tarefa | null> {
    const resposta = await this.dynamo.enviar<GetItemCommandOutput>(
      new GetItemCommand({
        TableName: this.tabelas.tarefas,
        Key: marshall({ pk: id }),
        ConsistentRead: true,
      }),
    );
    if (!resposta.Item) return null;
    const registro = unmarshall(resposta.Item);
    return ehTarefa(registro) ? tarefaToDomain(registro) : null;
  }

  async listarFila(filtro: FiltroFilaTarefas): Promise<PaginaTarefas> {
    const resposta = await this.dynamo.enviar<QueryCommandOutput>(
      new QueryCommand({
        TableName: this.tabelas.tarefas,
        IndexName: TAREFAS_GSI_FILA,
        KeyConditionExpression: `${TAREFAS_ATTR_INDICE_FILA} = :indice`,
        ExpressionAttributeValues: marshall({
          ':indice': montarIndiceFilaTarefa(filtro.tipo),
        }),
        ScanIndexForward: true,
        Limit: filtro.limite,
        ExclusiveStartKey: filtro.cursor
          ? marshall(decodificarCursor(filtro.cursor))
          : undefined,
      }),
    );

    return {
      tarefas: (resposta.Items ?? []).map((item) =>
        tarefaToDomain(unmarshall(item)),
      ),
      proximoCursor: resposta.LastEvaluatedKey
        ? codificarCursor(unmarshall(resposta.LastEvaluatedKey))
        : null,
    };
  }

  async buscarResponsavel(tarefaId: string): Promise<ResponsavelTarefa> {
    const tarefa = await this.consultarPorId(tarefaId);
    return {
      existe: tarefa !== null,
      responsavelId: tarefa?.responsavelId ?? null,
    };
  }
}

function codificarCursor(chave: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(chave)).toString('base64url');
}

function decodificarCursor(cursor: string): Record<string, string> {
  try {
    const chave = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    const camposEsperados = [
      'pk',
      TAREFAS_ATTR_INDICE_FILA,
      TAREFAS_ATTR_INDICE_FILA_ORDEM,
    ];
    const valido =
      Object.keys(chave).length === camposEsperados.length &&
      camposEsperados.every((campo) => typeof chave[campo] === 'string');
    if (!valido) throw new CursorTarefasInvalidoError();
    return chave as Record<string, string>;
  } catch {
    throw new CursorTarefasInvalidoError();
  }
}
