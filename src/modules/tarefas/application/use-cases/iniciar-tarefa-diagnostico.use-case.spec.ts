import { ConflitoTransacionalError } from '@/shared/database/conflito-transacional.error';
import {
  TarefaNaoEncontradaError,
  TarefaSituacaoInvalidaError,
} from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { IniciarTarefaDiagnosticoUseCase } from './iniciar-tarefa-diagnostico.use-case';
import {
  AGORA,
  criarOutboxMock,
  criarTarefaEmAndamentoFake,
  criarTarefaFake,
  criarTarefaGatewayMock,
  criarUnitOfWorkFake,
} from './test-doubles';

describe('IniciarTarefaDiagnosticoUseCase', () => {
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let outbox: ReturnType<typeof criarOutboxMock>;
  let useCase: IniciarTarefaDiagnosticoUseCase;

  beforeEach(() => {
    tarefas = criarTarefaGatewayMock();
    outbox = criarOutboxMock();
    useCase = new IniciarTarefaDiagnosticoUseCase(
      criarUnitOfWorkFake(),
      tarefas,
      outbox,
      () => AGORA,
    );
  });

  it('inicia a tarefa pendente e publica DiagnosticoIniciado na outbox', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaFake());

    const saida = await useCase.execute('os-1#1#DIAGNOSTICO', 'mec-1');

    expect(saida.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
    expect(saida.responsavelId).toBe('mec-1');
    expect(tarefas.salvar).toHaveBeenCalledTimes(1);
    const registro = outbox.registrar.mock.calls[0][1];
    expect(registro.eventType).toBe('execution.diagnostico-iniciado.v1');
    expect(registro.destino).toBe('os-in');
    expect(registro.envelope).toMatchObject({
      source: 'execution',
      ordemServicoId: 'os-1',
      rodada: 1,
      correlationId: 'corr-1',
      payload: {
        tarefaId: 'os-1#1#DIAGNOSTICO',
        iniciadoEm: AGORA.toISOString(),
      },
    });
  });

  it('é idempotente para o mesmo mecânico já responsável, sem novo evento', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaEmAndamentoFake('mec-1'));

    const saida = await useCase.execute('os-1#1#DIAGNOSTICO', 'mec-1');

    expect(saida.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
    expect(tarefas.salvar).not.toHaveBeenCalled();
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('recusa quando outro mecânico já iniciou a tarefa', async () => {
    tarefas.buscarPorId.mockResolvedValue(criarTarefaEmAndamentoFake('mec-2'));

    await expect(
      useCase.execute('os-1#1#DIAGNOSTICO', 'mec-1'),
    ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);
    expect(outbox.registrar).not.toHaveBeenCalled();
  });

  it('falha quando a tarefa não existe', async () => {
    tarefas.buscarPorId.mockResolvedValue(null);

    await expect(useCase.execute('x', 'mec-1')).rejects.toBeInstanceOf(
      TarefaNaoEncontradaError,
    );
  });

  it('refaz a leitura quando perde a escrita condicional', async () => {
    tarefas.buscarPorId
      .mockResolvedValueOnce(criarTarefaFake())
      .mockResolvedValueOnce(criarTarefaEmAndamentoFake('mec-2'));
    tarefas.salvar.mockRejectedValueOnce(new ConflitoTransacionalError('x'));

    await expect(
      useCase.execute('os-1#1#DIAGNOSTICO', 'mec-1'),
    ).rejects.toBeInstanceOf(TarefaSituacaoInvalidaError);
    expect(tarefas.buscarPorId).toHaveBeenCalledTimes(2);
  });
});
