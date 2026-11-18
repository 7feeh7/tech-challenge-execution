import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDbClientProvider } from '@/shared/database/dynamodb-client.provider';
import { DynamoDbContextoTransacao } from '@/shared/database/dynamodb-contexto-transacao';
import type { DynamoDbTabelasService } from '@/shared/database/dynamodb-tabelas.config';
import { Tarefa } from '../../domain/entities/tarefa.entity';
import { CursorTarefasInvalidoError } from '../../domain/errors/tarefa.errors';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { DynamoDbTarefaGateway } from './dynamodb-tarefa.gateway';
import { DynamoDbTarefaMapper } from './dynamodb-tarefa.mapper';

describe('DynamoDbTarefaGateway', () => {
  const tabelas = {
    tarefas: 'tarefas',
    outbox: 'outbox',
    mensagensProcessadas: 'processadas',
  } as DynamoDbTabelasService;
  let send: jest.Mock;
  let gateway: DynamoDbTarefaGateway;
  let contexto: DynamoDbContextoTransacao;

  const tarefa = Tarefa.criar({
    tipo: TipoTarefa.DIAGNOSTICO,
    ordemServicoId: 'os-1',
    rodada: 1,
    correlationId: 'corr-1',
    veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
    descricaoProblema: 'Barulho',
    sugestoes: [],
    itensOficiais: [],
    criadoEm: new Date('2026-11-15T10:00:00.000Z'),
  });
  const itemDynamo = marshall(
    DynamoDbTarefaMapper.toItem(tarefa) as Record<string, unknown>,
    { removeUndefinedValues: true },
  );

  beforeEach(() => {
    send = jest.fn();
    const provider = { enviar: send } as unknown as DynamoDbClientProvider;
    gateway = new DynamoDbTarefaGateway(provider, tabelas);
    contexto = new DynamoDbContextoTransacao(provider, tabelas);
  });

  it('cria com escrita condicional na chave da tarefa', async () => {
    await gateway.criar(contexto, tarefa);

    const put = contexto.obterEscritasPendentes()[0].Put!;
    expect(put.TableName).toBe('tarefas');
    expect(put.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(put.Item?.pk).toEqual({ S: 'os-1#1#DIAGNOSTICO' });
  });

  it('salva com condição na versão lida e incrementa a versão', async () => {
    await gateway.salvar(contexto, tarefa);

    const put = contexto.obterEscritasPendentes()[0].Put!;
    expect(put.ConditionExpression).toBe('versao = :versaoLida');
    expect(put.ExpressionAttributeValues).toEqual({
      ':versaoLida': { N: '0' },
    });
    expect(put.Item?.versao).toEqual({ N: '1' });
  });

  it('só tarefas pendentes carregam os atributos do índice da fila', async () => {
    const pendente = DynamoDbTarefaMapper.toItem(tarefa);
    expect(pendente.indiceFila).toBe('DIAGNOSTICO#PENDENTE');
    expect(pendente.indiceFilaOrdem).toBe(
      '2026-11-15T10:00:00.000Z#os-1#1#DIAGNOSTICO',
    );

    const iniciada = DynamoDbTarefaMapper.toDomain(unmarshall(itemDynamo));
    iniciada.iniciar('mec-1', new Date('2026-11-15T11:00:00.000Z'));
    const emAndamento = DynamoDbTarefaMapper.toItem(iniciada);
    expect(emAndamento.indiceFila).toBeUndefined();
    expect(emAndamento.indiceFilaOrdem).toBeUndefined();
    expect(emAndamento.responsavelId).toBe('mec-1');
  });

  it('consulta por id com leitura consistente e ignora marcador de bloqueio', async () => {
    send.mockResolvedValueOnce({ Item: itemDynamo });
    await expect(
      gateway.consultarPorId('os-1#1#DIAGNOSTICO'),
    ).resolves.toMatchObject({ id: 'os-1#1#DIAGNOSTICO' });
    expect(send.mock.calls[0][0].input.ConsistentRead).toBe(true);

    send.mockResolvedValueOnce({
      Item: marshall({ pk: 'os-9#1#DIAGNOSTICO', situacao: 'BLOQUEADA' }),
    });
    await expect(
      gateway.consultarPorId('os-9#1#DIAGNOSTICO'),
    ).resolves.toBeNull();

    send.mockResolvedValueOnce({});
    await expect(gateway.consultarPorId('nenhum')).resolves.toBeNull();
  });

  it('informa existência e responsável para o guard', async () => {
    send.mockResolvedValueOnce({ Item: itemDynamo });
    await expect(gateway.buscarResponsavel('x')).resolves.toEqual({
      existe: true,
      responsavelId: null,
    });

    send.mockResolvedValueOnce({});
    await expect(gateway.buscarResponsavel('y')).resolves.toEqual({
      existe: false,
      responsavelId: null,
    });
  });

  it('lista a fila pelo índice em ordem de chegada e devolve o cursor', async () => {
    send.mockResolvedValueOnce({
      Items: [itemDynamo],
      LastEvaluatedKey: marshall({
        pk: 'a',
        indiceFila: 'DIAGNOSTICO#PENDENTE',
        indiceFilaOrdem: 'o',
      }),
    });

    const pagina = await gateway.listarFila({
      tipo: TipoTarefa.DIAGNOSTICO,
      limite: 10,
    });

    const entrada = send.mock.calls[0][0].input;
    expect(entrada.IndexName).toBe('gsi-fila-tarefas');
    expect(entrada.ScanIndexForward).toBe(true);
    expect(entrada.Limit).toBe(10);
    expect(pagina.tarefas).toHaveLength(1);
    expect(pagina.proximoCursor).toEqual(expect.any(String));

    send.mockResolvedValueOnce({ Items: [] });
    await gateway.listarFila({
      tipo: TipoTarefa.DIAGNOSTICO,
      limite: 10,
      cursor: pagina.proximoCursor!,
    });
    expect(send.mock.calls[1][0].input.ExclusiveStartKey.pk).toEqual({
      S: 'a',
    });
  });

  it('devolve página vazia sem cursor quando o índice não tem itens', async () => {
    send.mockResolvedValueOnce({});

    await expect(
      gateway.listarFila({ tipo: TipoTarefa.REPARO, limite: 5 }),
    ).resolves.toEqual({ tarefas: [], proximoCursor: null });
  });

  it.each([
    'não-é-base64-json',
    Buffer.from('{"pk":"a"}').toString('base64url'),
    Buffer.from('{"pk":1,"indiceFila":"x","indiceFilaOrdem":"y"}').toString(
      'base64url',
    ),
  ])('rejeita cursor inválido: %s', async (cursor) => {
    await expect(
      gateway.listarFila({ tipo: TipoTarefa.DIAGNOSTICO, limite: 5, cursor }),
    ).rejects.toBeInstanceOf(CursorTarefasInvalidoError);
    expect(send).not.toHaveBeenCalled();
  });

  it('lê dentro da transação e não trata marcador como tarefa', async () => {
    send
      .mockResolvedValueOnce({ Item: itemDynamo })
      .mockResolvedValueOnce({
        Item: marshall({ pk: 'bloqueio', situacao: 'BLOQUEADA' }),
      })
      .mockResolvedValueOnce({});

    await expect(
      gateway.buscarPorId(contexto, 'os-1#1#DIAGNOSTICO'),
    ).resolves.toMatchObject({ id: 'os-1#1#DIAGNOSTICO' });
    await expect(gateway.buscarPorId(contexto, 'bloqueio')).resolves.toBeNull();
    await expect(gateway.buscarPorId(contexto, 'nada')).resolves.toBeNull();

    send
      .mockResolvedValueOnce({
        Item: marshall({ pk: 'bloqueio2', situacao: 'BLOQUEADA' }),
      })
      .mockResolvedValueOnce({});
    await expect(gateway.existeRegistro(contexto, 'bloqueio2')).resolves.toBe(
      true,
    );
    await expect(gateway.existeRegistro(contexto, 'nada')).resolves.toBe(false);
  });
});
