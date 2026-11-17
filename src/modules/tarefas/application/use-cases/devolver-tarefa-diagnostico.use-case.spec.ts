import {
  DevolucaoForaDaRodadaInicialError,
  TarefaNaoEncontradaError,
  TarefaSituacaoInvalidaError,
} from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { DevolverTarefaDiagnosticoUseCase } from './devolver-tarefa-diagnostico.use-case';
import {
  AGORA,
  conclusaoFake,
  criarOutboxMock,
  criarTarefaEmAndamentoFake,
  criarTarefaFake,
  criarTarefaGatewayMock,
  criarUnitOfWorkFake,
} from './test-doubles';

describe('DevolverTarefaDiagnosticoUseCase', () => {
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let outbox: ReturnType<typeof criarOutboxMock>;
  let useCase: DevolverTarefaDiagnosticoUseCase;

  beforeEach(() => {
    tarefas = criarTarefaGatewayMock();
    outbox = criarOutboxMock();
    useCase = new DevolverTarefaDiagnosticoUseCase(
      criarUnitOfWorkFake(),
      tarefas,
      outbox,
      () => AGORA,
    );
  });

  it('devolve o diagnóstico em andamento da rodada 1 e publica TarefaDevolvidaAFila', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaEmAndamentoFake());

    const saida = await useCase.execute('os-1#1#DIAGNOSTICO');

    expect(saida.situacao).toBe(SituacaoTarefa.PENDENTE);
    expect(saida.responsavelId).toBeNull();
    expect(tarefas.salvar).toHaveBeenCalledTimes(1);
    const registro = outbox.registrar.mock.calls[0][1];
    expect(registro.eventType).toBe('execution.tarefa-devolvida-a-fila.v1');
    expect(registro.envelope.payload).toEqual({
      tarefaId: 'os-1#1#DIAGNOSTICO',
      devolvidaEm: AGORA.toISOString(),
    });
  });

  it('recusa devolução fora da rodada 1', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaEmAndamentoFake('m', 2));

    await expect(useCase.execute('os-1#2#DIAGNOSTICO')).rejects.toBeInstanceOf(
      DevolucaoForaDaRodadaInicialError,
    );
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('recusa devolução depois que a conclusão foi iniciada', async () => {
    const tarefa = criarTarefaEmAndamentoFake();
    tarefa.registrarConclusaoPendente(conclusaoFake, AGORA);
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await expect(useCase.execute(tarefa.id)).rejects.toBeInstanceOf(
      TarefaSituacaoInvalidaError,
    );
    expect(tarefas.salvar).not.toHaveBeenCalled();
  });

  it('recusa devolução de tarefa ainda pendente', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaFake());

    await expect(useCase.execute('os-1#1#DIAGNOSTICO')).rejects.toBeInstanceOf(
      TarefaSituacaoInvalidaError,
    );
  });

  it('falha quando a tarefa não existe', async () => {
    tarefas.buscarPorId.mockResolvedValue(null);

    await expect(useCase.execute('x')).rejects.toBeInstanceOf(
      TarefaNaoEncontradaError,
    );
  });
});
