import { EVENTO_REPARO_CONCLUIDO } from '@/shared/messaging/envelope';
import { PecaAdicionalNaoAutorizadaError } from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { ConcluirTarefaReparoUseCase } from './concluir-tarefa-reparo.use-case';
import {
  AGORA,
  criarOutboxMock,
  criarTarefaGatewayMock,
  criarTarefaReparoFake,
  criarUnitOfWorkFake,
} from './test-doubles';

describe('ConcluirTarefaReparoUseCase', () => {
  const unitOfWork = criarUnitOfWorkFake();
  const tarefas = criarTarefaGatewayMock();
  const outbox = criarOutboxMock();
  const useCase = new ConcluirTarefaReparoUseCase(
    unitOfWork,
    tarefas,
    outbox,
    () => AGORA,
  );

  beforeEach(() => jest.clearAllMocks());

  it('publica ReparoConcluido', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefa.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await useCase.execute(tarefa.id, {
      servicosRealizados: [{ itemId: 'svc-1', quantidade: 1 }],
      pecasUtilizadas: [{ itemId: 'peca-1', quantidade: 2 }],
    });

    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_REPARO_CONCLUIDO }),
    );
  });

  it('idempotente quando já concluída', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefa.iniciar('mec-1', AGORA);
    tarefa.concluirReparo(
      {
        servicosRealizados: [],
        pecasUtilizadas: [],
        divergencias: [],
        motivoFalha: null,
      },
      AGORA,
    );
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await useCase.execute(tarefa.id, {
      servicosRealizados: [],
      pecasUtilizadas: [],
    });

    expect(outbox.registrar).not.toHaveBeenCalled();
    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
  });

  it('recusa peça adicional', async () => {
    const reparo = criarTarefaReparoFake();
    reparo.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(reparo);
    await expect(
      useCase.execute(reparo.id, {
        servicosRealizados: [{ itemId: 'svc-1', quantidade: 1 }],
        pecasUtilizadas: [{ itemId: 'x', quantidade: 1 }],
      }),
    ).rejects.toBeInstanceOf(PecaAdicionalNaoAutorizadaError);
  });
});
