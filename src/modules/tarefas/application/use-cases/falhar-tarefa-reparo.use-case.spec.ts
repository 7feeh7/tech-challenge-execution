import { EVENTO_REPARO_FALHOU } from '@/shared/messaging/envelope';
import { JustificativaDivergenciaObrigatoriaError } from '../../domain/errors/tarefa.errors';
import { TipoDivergenciaPeca } from '../../domain/tipo-divergencia-peca.enum';
import { FalharTarefaReparoUseCase } from './falhar-tarefa-reparo.use-case';
import {
  AGORA,
  criarOutboxMock,
  criarTarefaGatewayMock,
  criarTarefaReparoFake,
  criarUnitOfWorkFake,
} from './test-doubles';

const PECA_FORA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('FalharTarefaReparoUseCase', () => {
  const unitOfWork = criarUnitOfWorkFake();
  const tarefas = criarTarefaGatewayMock();
  const outbox = criarOutboxMock();
  const useCase = new FalharTarefaReparoUseCase(
    unitOfWork,
    tarefas,
    outbox,
    () => AGORA,
  );

  beforeEach(() => jest.clearAllMocks());

  it('publica ReparoFalhou com responsavelId e divergências', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefa.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await useCase.execute(tarefa.id, {
      motivo: 'Peça incompatível',
      servicosRealizados: [{ itemId: 'svc-1', quantidade: 1 }],
      pecasUtilizadas: [{ itemId: PECA_FORA, quantidade: 1 }],
      justificativaDivergencia: 'Usada para testar o veículo',
      responsavelOperacaoId: 'mec-1',
    });

    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: EVENTO_REPARO_FALHOU,
        envelope: expect.objectContaining({
          payload: expect.objectContaining({
            responsavelId: 'mec-1',
            divergencias: expect.arrayContaining([
              expect.objectContaining({
                tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
                justificativa: 'Usada para testar o veículo',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('exige justificativa para peça fora da lista', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefa.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await expect(
      useCase.execute(tarefa.id, {
        motivo: 'Peça incompatível',
        servicosRealizados: [{ itemId: 'svc-1', quantidade: 1 }],
        pecasUtilizadas: [{ itemId: PECA_FORA, quantidade: 1 }],
        responsavelOperacaoId: 'mec-1',
      }),
    ).rejects.toBeInstanceOf(JustificativaDivergenciaObrigatoriaError);
  });
});
