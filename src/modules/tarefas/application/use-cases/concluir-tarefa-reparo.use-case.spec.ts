import { EVENTO_REPARO_CONCLUIDO } from '@/shared/messaging/envelope';
import { ItemPecaIdInvalidoError } from '../../domain/errors/tarefa.errors';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoDivergenciaPeca } from '../../domain/tipo-divergencia-peca.enum';
import { ConcluirTarefaReparoUseCase } from './concluir-tarefa-reparo.use-case';
import {
  AGORA,
  criarOutboxMock,
  criarTarefaGatewayMock,
  criarTarefaReparoFake,
  criarUnitOfWorkFake,
} from './test-doubles';

const PECA_AUTORIZADA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const PECA_FORA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

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

  const entradaBase = {
    servicosRealizados: [{ itemId: 'svc-1', quantidade: 1 }],
    pecasUtilizadas: [{ itemId: PECA_AUTORIZADA, quantidade: 2 }],
    responsavelOperacaoId: 'mec-1',
  };

  it('publica ReparoConcluido com responsavelId', async () => {
    const tarefa = criarTarefaReparoFake();
    tarefa.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await useCase.execute(tarefa.id, entradaBase);

    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: EVENTO_REPARO_CONCLUIDO,
        envelope: expect.objectContaining({
          payload: expect.objectContaining({ responsavelId: 'mec-1' }),
        }),
      }),
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
        responsavelOperacaoId: 'mec-1',
        motivoFalha: null,
      },
      AGORA,
    );
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await useCase.execute(tarefa.id, entradaBase);

    expect(outbox.registrar).not.toHaveBeenCalled();
    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
  });

  it('recusa peça com identificador inválido', async () => {
    const reparo = criarTarefaReparoFake();
    reparo.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(reparo);
    await expect(
      useCase.execute(reparo.id, {
        ...entradaBase,
        pecasUtilizadas: [{ itemId: 'peca-invalida', quantidade: 1 }],
      }),
    ).rejects.toBeInstanceOf(ItemPecaIdInvalidoError);
  });

  it('persiste divergência FORA_DA_LISTA com justificativa no evento', async () => {
    const reparo = criarTarefaReparoFake();
    reparo.iniciar('mec-1', AGORA);
    tarefas.buscarPorId.mockResolvedValue(reparo);

    await useCase.execute(reparo.id, {
      ...entradaBase,
      pecasUtilizadas: [{ itemId: PECA_FORA, quantidade: 1 }],
      justificativaDivergencia: 'Emergência no veículo',
    });

    const payload = outbox.registrar.mock.calls[0][1].envelope.payload as {
      divergencias: { tipo: string; justificativa?: string }[];
      responsavelId: string;
    };
    expect(payload.responsavelId).toBe('mec-1');
    expect(payload.divergencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
          justificativa: 'Emergência no veículo',
        }),
      ]),
    );
  });
});
