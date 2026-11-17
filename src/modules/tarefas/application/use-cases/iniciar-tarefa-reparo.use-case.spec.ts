import { EVENTO_REPARO_INICIADO } from '@/shared/messaging/envelope';
import { TarefaTipoInvalidoError } from '../../domain/errors/tarefa.errors';
import { IniciarTarefaReparoUseCase } from './iniciar-tarefa-reparo.use-case';
import {
  AGORA,
  criarOutboxMock,
  criarTarefaFake,
  criarTarefaGatewayMock,
  criarTarefaReparoFake,
  criarUnitOfWorkFake,
} from './test-doubles';

describe('IniciarTarefaReparoUseCase', () => {
  const unitOfWork = criarUnitOfWorkFake();
  const tarefas = criarTarefaGatewayMock();
  const outbox = criarOutboxMock();
  const useCase = new IniciarTarefaReparoUseCase(
    unitOfWork,
    tarefas,
    outbox,
    () => AGORA,
  );

  beforeEach(() => jest.clearAllMocks());

  it('publica ReparoIniciado ao iniciar tarefa pendente', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    const saida = await useCase.execute(tarefa.id, 'mec-1');

    expect(saida.situacao).toBe('EM_ANDAMENTO');
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_REPARO_INICIADO }),
    );
  });

  it('recusa diagnóstico', async () => {
    const tarefa = criarTarefaFake();
    tarefas.buscarPorId.mockResolvedValue(tarefa);
    await expect(useCase.execute(tarefa.id, 'mec-1')).rejects.toBeInstanceOf(
      TarefaTipoInvalidoError,
    );
  });
});
