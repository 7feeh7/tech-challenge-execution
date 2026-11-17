import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import type { Tarefa } from '../../domain/entities/tarefa.entity';
import {
  ConclusaoIndeterminadaError,
  ConclusaoRecusadaPeloOsConflitoError,
  ConclusaoRecusadaPeloOsError,
  TarefaNaoEncontradaError,
  TarefaSituacaoInvalidaError,
} from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { ConcluirTarefaDiagnosticoUseCase } from './concluir-tarefa-diagnostico.use-case';
import {
  AGORA,
  conclusaoFake,
  criarOsGatewayMock,
  criarTarefaEmAndamentoFake,
  criarTarefaFake,
  criarTarefaGatewayMock,
  criarUnitOfWorkFake,
} from './test-doubles';

const itensOficiais = [
  { tipo: 'PECA', itemId: 'peca-1', nome: 'Pastilha', quantidade: 2 },
];

describe('ConcluirTarefaDiagnosticoUseCase', () => {
  let unitOfWork: ReturnType<typeof criarUnitOfWorkFake>;
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let os: ReturnType<typeof criarOsGatewayMock>;
  let tarefa: Tarefa;
  let situacoesGravadas: SituacaoTarefa[];
  let useCase: ConcluirTarefaDiagnosticoUseCase;

  beforeEach(() => {
    unitOfWork = criarUnitOfWorkFake();
    tarefas = criarTarefaGatewayMock();
    os = criarOsGatewayMock();
    tarefa = criarTarefaEmAndamentoFake();
    situacoesGravadas = [];
    tarefas.buscarPorId.mockImplementation(async () => tarefa);
    tarefas.salvar.mockImplementation(async (_contexto, salva) => {
      situacoesGravadas.push(salva.situacao);
    });
    useCase = new ConcluirTarefaDiagnosticoUseCase(
      unitOfWork,
      tarefas,
      os,
      () => AGORA,
    );
  });

  it('grava o payload pendente, chama o OS fora da transação e conclui com o 200', async () => {
    let profundidadeNaChamada = -1;
    os.concluir.mockImplementation(async () => {
      profundidadeNaChamada = unitOfWork.profundidade;
      expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);
      return { tipo: 'sucesso', rodada: 1, itensOficiais };
    });

    const saida = await useCase.execute(tarefa.id, conclusaoFake);

    expect(profundidadeNaChamada).toBe(0);
    expect(situacoesGravadas).toEqual([
      SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO,
      SituacaoTarefa.CONCLUIDA,
    ]);
    expect(os.concluir).toHaveBeenCalledWith(
      expect.objectContaining({
        ordemServicoId: 'os-1',
        rodada: 1,
        tarefaId: 'os-1#1#DIAGNOSTICO',
        laudo: conclusaoFake.laudo,
        itens: conclusaoFake.itens,
        correlationId: 'corr-1',
      }),
    );
    expect(saida.itensOficiais).toEqual(itensOficiais);
    expect(saida.tarefa).toMatchObject({
      situacao: 'CONCLUIDA',
      concluidaEm: AGORA.toISOString(),
      laudo: conclusaoFake.laudo,
      conclusaoPendente: null,
    });
  });

  it('volta a EM_ANDAMENTO e descarta o payload quando o OS recusa com 409', async () => {
    os.concluir.mockResolvedValue({
      tipo: 'recusada',
      status: 409,
      codigo: 'ESTADO_INCOMPATIVEL',
      mensagem: 'OS não está em diagnóstico',
    });

    await expect(
      useCase.execute(tarefa.id, conclusaoFake),
    ).rejects.toBeInstanceOf(ConclusaoRecusadaPeloOsConflitoError);

    expect(situacoesGravadas).toEqual([
      SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO,
      SituacaoTarefa.EM_ANDAMENTO,
    ]);
    expect(tarefa.conclusaoPendente).toBeNull();
    expect(tarefa.concluidaEm).toBeNull();
  });

  it('volta a EM_ANDAMENTO quando o OS recusa com 422', async () => {
    os.concluir.mockResolvedValue({
      tipo: 'recusada',
      status: 422,
      codigo: 'ITEM_INVALIDO',
      mensagem: 'Item inexistente',
    });

    const erro = await useCase
      .execute(tarefa.id, conclusaoFake)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConclusaoRecusadaPeloOsError);
    expect((erro as Error).message).toContain('ITEM_INVALIDO');
    expect(tarefa.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
  });

  it('permite reenviar conteúdo corrigido depois de uma recusa', async () => {
    os.concluir.mockResolvedValueOnce({
      tipo: 'recusada',
      status: 422,
      codigo: 'ITEM_INVALIDO',
      mensagem: 'Item inexistente',
    });
    await useCase.execute(tarefa.id, conclusaoFake).catch(() => undefined);

    const corrigida = { laudo: 'Laudo corrigido', itens: [] };
    os.concluir.mockResolvedValueOnce({
      tipo: 'sucesso',
      rodada: 1,
      itensOficiais: [],
    });
    await useCase.execute(tarefa.id, corrigida);

    expect(os.concluir.mock.calls[1][0]).toMatchObject({
      laudo: 'Laudo corrigido',
    });
    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
  });

  it('mantém CONCLUSAO_EM_ANDAMENTO quando o OS não responde de forma definitiva', async () => {
    os.concluir.mockResolvedValue({
      tipo: 'indeterminado',
      motivo: 'timeout',
    });

    await expect(
      useCase.execute(tarefa.id, conclusaoFake),
    ).rejects.toBeInstanceOf(ConclusaoIndeterminadaError);

    expect(situacoesGravadas).toEqual([SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO]);
    expect(tarefa.conclusaoPendente).toEqual(conclusaoFake);
    expect(tarefa.concluidaEm).toBeNull();
  });

  it('reenvia o payload gravado e ignora o conteúdo novo na nova tentativa', async () => {
    os.concluir.mockResolvedValueOnce({
      tipo: 'indeterminado',
      motivo: 'timeout',
    });
    await useCase.execute(tarefa.id, conclusaoFake).catch(() => undefined);

    os.concluir.mockResolvedValueOnce({
      tipo: 'sucesso',
      rodada: 1,
      itensOficiais,
    });
    await useCase.execute(tarefa.id, { laudo: 'Outro texto', itens: [] });

    expect(os.concluir).toHaveBeenCalledTimes(2);
    expect(os.concluir.mock.calls[1][0]).toMatchObject({
      tarefaId: os.concluir.mock.calls[0][0].tarefaId,
      laudo: conclusaoFake.laudo,
      itens: conclusaoFake.itens,
    });
    expect(situacoesGravadas).toEqual([
      SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO,
      SituacaoTarefa.CONCLUIDA,
    ]);
    expect(tarefa.laudo).toBe(conclusaoFake.laudo);
  });

  it('não chama o OS quando a tarefa não está em andamento', async () => {
    tarefa = criarTarefaFake();

    await expect(
      useCase.execute(tarefa.id, conclusaoFake),
    ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);
    expect(os.concluir).not.toHaveBeenCalled();
    expect(tarefas.salvar).not.toHaveBeenCalled();
  });

  it('não conclui de novo uma tarefa já concluída', async () => {
    tarefa.registrarConclusaoPendente(conclusaoFake, AGORA);
    tarefa.concluir(AGORA);

    await expect(
      useCase.execute(tarefa.id, conclusaoFake),
    ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);
    expect(os.concluir).not.toHaveBeenCalled();
  });

  it('falha quando a tarefa não existe', async () => {
    tarefas.buscarPorId.mockResolvedValue(null);

    await expect(useCase.execute('x', conclusaoFake)).rejects.toBeInstanceOf(
      TarefaNaoEncontradaError,
    );
  });

  it('refaz a gravação do payload quando perde a escrita condicional', async () => {
    tarefas.salvar.mockRejectedValueOnce(new ConflitoTransacionalError('x'));
    os.concluir.mockResolvedValue({
      tipo: 'sucesso',
      rodada: 1,
      itensOficiais,
    });

    await useCase.execute(tarefa.id, conclusaoFake);

    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
  });

  it('não grava de novo quando outra chamada já aplicou o 200 do OS', async () => {
    os.concluir.mockImplementation(async () => {
      tarefa.concluir(AGORA);
      return { tipo: 'sucesso', rodada: 1, itensOficiais };
    });

    const saida = await useCase.execute(tarefa.id, conclusaoFake);

    expect(saida.tarefa.situacao).toBe('CONCLUIDA');
    expect(situacoesGravadas).toEqual([SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO]);
  });

  it('não reabre a tarefa que saiu de CONCLUSAO_EM_ANDAMENTO durante a chamada ao OS', async () => {
    os.concluir.mockImplementation(async () => {
      tarefa.reabrirAposRecusa(AGORA);
      return {
        tipo: 'recusada',
        status: 409,
        codigo: 'OS_EM_CANCELAMENTO',
        mensagem: 'cancelando',
      };
    });

    await expect(
      useCase.execute(tarefa.id, conclusaoFake),
    ).rejects.toBeInstanceOf(ConclusaoRecusadaPeloOsConflitoError);
    expect(situacoesGravadas).toEqual([SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO]);
  });
});
