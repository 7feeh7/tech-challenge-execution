import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  type ConclusaoDiagnostico,
  Tarefa,
} from '../../domain/entities/tarefa.entity';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import type { ConclusaoDiagnosticoOsGateway } from '../ports/conclusao-diagnostico-os.gateway';
import type { TarefaGateway } from '../ports/tarefa.gateway';

export const AGORA = new Date('2026-11-15T12:00:00.000Z');

export const conclusaoFake: ConclusaoDiagnostico = {
  laudo: 'Pastilhas desgastadas',
  itens: [{ tipo: 'PECA', itemId: 'peca-1', quantidade: 2 }],
};

export const criarTarefaFake = (rodada = 1): Tarefa =>
  Tarefa.criar({
    tipo: TipoTarefa.DIAGNOSTICO,
    ordemServicoId: 'os-1',
    rodada,
    correlationId: 'corr-1',
    veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
    descricaoProblema: 'Barulho ao frear',
    sugestoes: [],
    criadoEm: new Date('2026-11-15T10:00:00.000Z'),
  });

export const criarTarefaEmAndamentoFake = (
  responsavelId = 'mec-1',
  rodada = 1,
): Tarefa => {
  const tarefa = criarTarefaFake(rodada);
  tarefa.iniciar(responsavelId, new Date('2026-11-15T11:00:00.000Z'));
  return tarefa;
};

export const criarTarefaGatewayMock = (): jest.Mocked<TarefaGateway> => ({
  buscarPorId: jest.fn(),
  existeRegistro: jest.fn(),
  criar: jest.fn(),
  salvar: jest.fn(),
  consultarPorId: jest.fn(),
  listarFila: jest.fn(),
});

export const criarOutboxMock = (): jest.Mocked<OutboxGateway> => ({
  registrar: jest.fn(),
});

export const criarOsGatewayMock =
  (): jest.Mocked<ConclusaoDiagnosticoOsGateway> => ({
    concluir: jest.fn(),
  });

export const criarUnitOfWorkFake = (): UnitOfWorkFake => new UnitOfWorkFake();
