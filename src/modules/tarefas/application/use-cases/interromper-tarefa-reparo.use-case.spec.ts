import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { EVENTO_REPARO_INTERROMPIDO } from '@/shared/messaging/envelope';
import { Tarefa } from '../../domain/entities/tarefa.entity';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { InterromperTarefaReparoUseCase } from './interromper-tarefa-reparo.use-case';
import { criarTarefaGatewayMock, criarUnitOfWorkFake } from './test-doubles';

describe('InterromperTarefaReparoUseCase', () => {
  const agora = () => new Date('2026-11-15T14:00:00.000Z');
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let outbox: jest.Mocked<OutboxGateway>;
  let unitOfWork: UnitOfWork;
  let caso: InterromperTarefaReparoUseCase;

  beforeEach(() => {
    tarefas = criarTarefaGatewayMock();
    outbox = { registrar: jest.fn() };
    unitOfWork = criarUnitOfWorkFake();
    caso = new InterromperTarefaReparoUseCase(
      unitOfWork,
      tarefas,
      outbox,
      agora,
    );
  });

  it('interrompe reparo em INTERRUPCAO_SOLICITADA e persiste fatoTerminalEventId', async () => {
    const tarefa = Tarefa.criar({
      tipo: TipoTarefa.REPARO,
      ordemServicoId: 'os-1',
      rodada: 1,
      correlationId: 'c',
      veiculo: { placa: 'X', modelo: 'Y' },
      descricaoProblema: 'p',
      sugestoes: [],
      itensOficiais: [
        {
          tipo: 'SERVICO',
          itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          nome: 'S',
          quantidade: 1,
        },
      ],
      criadoEm: agora(),
    });
    tarefa.iniciar('mec-1', agora());
    tarefa.solicitarInterrupcao(agora());
    tarefas.buscarPorId.mockResolvedValue(tarefa);

    await caso.execute('os-1#1#REPARO', {
      servicosRealizados: [
        { itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', quantidade: 1 },
      ],
      pecasUtilizadas: [],
      responsavelOperacaoId: 'mec-1',
    });

    expect(tarefa.situacao).toBe(SituacaoTarefa.INTERROMPIDA);
    expect(tarefa.fatoTerminalEventId).toBeTruthy();
    expect(outbox.registrar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: EVENTO_REPARO_INTERROMPIDO }),
    );
  });
});
