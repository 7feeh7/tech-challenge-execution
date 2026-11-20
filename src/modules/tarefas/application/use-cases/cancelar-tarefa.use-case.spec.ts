import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import type { EnvelopeMensagem } from '@/shared/messaging/envelope';
import { EVENTO_RESPOSTA_CANCELAMENTO } from '@/shared/messaging/envelope';
import { Tarefa } from '../../domain/entities/tarefa.entity';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { CancelarTarefaUseCase } from './cancelar-tarefa.use-case';
import { criarTarefaGatewayMock } from './test-doubles';

function comandoBase(): EnvelopeMensagem {
  return {
    eventId: 'evt-comando',
    eventType: 'execution.cancelar-tarefa.v1',
    version: 1,
    occurredAt: '2026-11-15T12:00:00.000Z',
    source: 'os-service',
    correlationId: 'corr-1',
    causationId: 'caus-1',
    ordemServicoId: 'os-1',
    rodada: 1,
    payload: { tipoTarefa: TipoTarefa.DIAGNOSTICO, motivo: 'teste' },
  };
}

function tarefaDiag(situacao: SituacaoTarefa): Tarefa {
  const t = Tarefa.criar({
    tipo: TipoTarefa.DIAGNOSTICO,
    ordemServicoId: 'os-1',
    rodada: 1,
    correlationId: 'corr-1',
    veiculo: { placa: 'X', modelo: 'Y' },
    descricaoProblema: 'p',
    sugestoes: [],
    itensOficiais: [],
    criadoEm: new Date('2026-11-15T10:00:00.000Z'),
  });
  if (situacao !== SituacaoTarefa.PENDENTE) {
    t.iniciar('mec-1', new Date('2026-11-15T10:05:00.000Z'));
  }
  if (situacao === SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO) {
    t.registrarConclusaoPendente(
      { laudo: 'l', itens: [] },
      new Date('2026-11-15T10:10:00.000Z'),
    );
  }
  return t;
}

describe('CancelarTarefaUseCase', () => {
  let tarefas: ReturnType<typeof criarTarefaGatewayMock>;
  let outbox: jest.Mocked<OutboxGateway>;
  let caso: CancelarTarefaUseCase;
  const agora = () => new Date('2026-11-15T12:00:00.000Z');

  beforeEach(() => {
    tarefas = criarTarefaGatewayMock();
    outbox = { registrar: jest.fn() };
    caso = new CancelarTarefaUseCase(tarefas, outbox, agora);
  });

  it('responde CANCELADA_SEM_EXISTIR quando só há marcador', async () => {
    tarefas.existeRegistro.mockResolvedValue(true);
    tarefas.buscarPorId.mockResolvedValue(null);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.DIAGNOSTICO,
      motivo: 'teste',
    });

    expect(tarefas.gravarMarcadorBloqueio).not.toHaveBeenCalled();
    const payload = (
      outbox.registrar.mock.calls[0][1] as { envelope: { payload: unknown } }
    ).envelope.payload as { resultado: string };
    expect(payload.resultado).toBe('CANCELADA_SEM_EXISTIR');
  });

  it('grava marcador e responde CANCELADA_SEM_EXISTIR sem tarefa', async () => {
    tarefas.existeRegistro.mockResolvedValue(false);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.DIAGNOSTICO,
      motivo: 'teste',
    });

    expect(tarefas.gravarMarcadorBloqueio).toHaveBeenCalled();
    expect(outbox.registrar).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: EVENTO_RESPOSTA_CANCELAMENTO,
      }),
    );
  });

  it('cancela diagnóstico em andamento', async () => {
    const tarefa = tarefaDiag(SituacaoTarefa.EM_ANDAMENTO);
    tarefas.existeRegistro.mockResolvedValue(true);
    tarefas.buscarPorId.mockResolvedValue(tarefa);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.DIAGNOSTICO,
      motivo: 'teste',
    });

    expect(tarefa.situacao).toBe(SituacaoTarefa.CANCELADA);
    const payload = (
      outbox.registrar.mock.calls[0][1] as { envelope: { payload: unknown } }
    ).envelope.payload as { resultado: string };
    expect(payload.resultado).toBe('CANCELADA_EM_ANDAMENTO');
  });

  it('cancela diagnóstico pendente', async () => {
    const tarefa = tarefaDiag(SituacaoTarefa.PENDENTE);
    tarefas.existeRegistro.mockResolvedValue(true);
    tarefas.buscarPorId.mockResolvedValue(tarefa);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.DIAGNOSTICO,
      motivo: 'teste',
    });

    expect(tarefa.situacao).toBe(SituacaoTarefa.CANCELADA);
    expect(tarefas.salvar).toHaveBeenCalled();
    const payload = (
      outbox.registrar.mock.calls[0][1] as { envelope: { payload: unknown } }
    ).envelope.payload as { resultado: string };
    expect(payload.resultado).toBe('CANCELADA_SEM_INICIO');
  });

  it('solicita interrupção de reparo em andamento', async () => {
    const tarefa = Tarefa.criar({
      tipo: TipoTarefa.REPARO,
      ordemServicoId: 'os-1',
      rodada: 1,
      correlationId: 'corr-1',
      veiculo: { placa: 'X', modelo: 'Y' },
      descricaoProblema: 'p',
      sugestoes: [],
      itensOficiais: [],
      criadoEm: new Date('2026-11-15T10:00:00.000Z'),
    });
    tarefa.iniciar('mec-1', new Date('2026-11-15T10:05:00.000Z'));
    tarefas.existeRegistro.mockResolvedValue(true);
    tarefas.buscarPorId.mockResolvedValue(tarefa);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.REPARO,
      motivo: 'desistência',
    });

    expect(tarefa.situacao).toBe(SituacaoTarefa.INTERRUPCAO_SOLICITADA);
    const payload = (
      outbox.registrar.mock.calls[0][1] as { envelope: { payload: unknown } }
    ).envelope.payload as { resultado: string };
    expect(payload.resultado).toBe('INTERRUPCAO_SOLICITADA');
  });

  it('responde JA_ENCERRADA para tarefa já cancelada', async () => {
    const tarefa = tarefaDiag(SituacaoTarefa.PENDENTE);
    tarefa.cancelarSemInicio('motivo', agora());
    tarefas.existeRegistro.mockResolvedValue(true);
    tarefas.buscarPorId.mockResolvedValue(tarefa);
    const ctx = {} as never;

    await caso.execute(ctx, comandoBase(), {
      tipoTarefa: TipoTarefa.DIAGNOSTICO,
      motivo: 'teste',
    });

    expect(tarefas.salvar).not.toHaveBeenCalled();
    const payload = (
      outbox.registrar.mock.calls[0][1] as { envelope: { payload: unknown } }
    ).envelope.payload as { resultado: string };
    expect(payload.resultado).toBe('JA_ENCERRADA');
  });
});
