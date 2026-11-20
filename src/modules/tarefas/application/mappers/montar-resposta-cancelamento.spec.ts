import { Tarefa } from '../../domain/entities/tarefa.entity';
import { ResultadoCancelamento } from '../../domain/resultado-cancelamento.enum';
import { SituacaoTarefa } from '../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { montarPayloadRespostaCancelamento } from './montar-resposta-cancelamento';

const agora = new Date('2026-11-15T12:00:00.000Z');

function criarReparo(): Tarefa {
  return Tarefa.criar({
    tipo: TipoTarefa.REPARO,
    ordemServicoId: 'os-1',
    rodada: 1,
    correlationId: 'corr',
    veiculo: { placa: 'X', modelo: 'Y' },
    descricaoProblema: '',
    sugestoes: [],
    itensOficiais: [],
    criadoEm: agora,
  });
}

function criarDiagnostico(): Tarefa {
  return Tarefa.criar({
    tipo: TipoTarefa.DIAGNOSTICO,
    ordemServicoId: 'os-1',
    rodada: 1,
    correlationId: 'corr',
    veiculo: { placa: 'X', modelo: 'Y' },
    descricaoProblema: '',
    sugestoes: [],
    itensOficiais: [],
    criadoEm: agora,
  });
}

function serializadoSemCamposConsumo(payload: Record<string, unknown>): void {
  const json = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  expect(json).not.toHaveProperty('pecasUtilizadas');
  expect(json).not.toHaveProperty('servicosRealizados');
  expect(json).not.toHaveProperty('divergencias');
}

describe('montarPayloadRespostaCancelamento', () => {
  it('JA_CONCLUIDA de reparo inclui consumo e fatoTerminalEventId', () => {
    const tarefa = criarReparo();
    tarefa.iniciar('mec-1', agora);
    tarefa.registrarFatoTerminalEventId('fato-uuid');
    tarefa.concluirReparo(
      {
        servicosRealizados: [],
        pecasUtilizadas: [{ itemId: 'p1', quantidade: 1 }],
        divergencias: [],
        responsavelOperacaoId: 'mec-1',
        motivoFalha: null,
      },
      agora,
    );

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.REPARO,
      ResultadoCancelamento.JA_CONCLUIDA,
    );

    expect(payload).toMatchObject({
      tipoTarefa: 'REPARO',
      resultado: 'JA_CONCLUIDA',
      situacaoTarefa: 'CONCLUIDA',
      fatoTerminalEventId: 'fato-uuid',
      responsavelId: 'mec-1',
    });
  });

  it('JA_CONCLUIDA de diagnóstico não inclui consumo nem responsavelId', () => {
    const tarefa = criarDiagnostico();
    tarefa.iniciar('mec-1', agora);
    tarefa.registrarConclusaoPendente({ laudo: 'ok', itens: [] }, agora);
    tarefa.concluir(agora);

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.DIAGNOSTICO,
      ResultadoCancelamento.JA_CONCLUIDA,
    );

    expect(payload).toMatchObject({
      tipoTarefa: 'DIAGNOSTICO',
      resultado: 'JA_CONCLUIDA',
      situacaoTarefa: 'CONCLUIDA',
      concluidaEm: agora.toISOString(),
      encerradaEm: agora.toISOString(),
    });
    expect(payload.responsavelId).toBeUndefined();
    expect(payload.fatoTerminalEventId).toBeUndefined();
    serializadoSemCamposConsumo(payload);
  });

  it('JA_ENCERRADA FALHOU inclui motivo e encerradaEm', () => {
    const tarefa = criarReparo();
    tarefa.iniciar('mec-1', agora);
    tarefa.falharReparo(
      {
        servicosRealizados: [],
        pecasUtilizadas: [],
        divergencias: [],
        responsavelOperacaoId: 'mec-1',
        motivoFalha: 'falha',
      },
      agora,
    );

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.REPARO,
      ResultadoCancelamento.JA_ENCERRADA,
    );

    expect(payload.motivo).toBe('falha');
    expect(payload.situacaoTarefa).toBe('FALHOU');
  });

  it('JA_ENCERRADA CANCELADA de reparo traz listas vazias sem fato terminal', () => {
    const tarefa = criarReparo();
    tarefa.cancelarSemInicio('motivo', agora);

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.REPARO,
      ResultadoCancelamento.JA_ENCERRADA,
    );

    expect(payload).toMatchObject({
      situacaoTarefa: SituacaoTarefa.CANCELADA,
      pecasUtilizadas: [],
      servicosRealizados: [],
      divergencias: [],
    });
    expect(payload.fatoTerminalEventId).toBeUndefined();
  });

  it('JA_ENCERRADA CANCELADA de diagnóstico não inclui campos de consumo', () => {
    const tarefa = criarDiagnostico();
    tarefa.cancelarSemInicio('motivo', agora);

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.DIAGNOSTICO,
      ResultadoCancelamento.JA_ENCERRADA,
    );

    expect(payload).toMatchObject({
      tipoTarefa: 'DIAGNOSTICO',
      resultado: 'JA_ENCERRADA',
      situacaoTarefa: SituacaoTarefa.CANCELADA,
      encerradaEm: agora.toISOString(),
    });
    expect(payload.fatoTerminalEventId).toBeUndefined();
    expect(payload.responsavelId).toBeUndefined();
    serializadoSemCamposConsumo(payload);
  });

  it('CANCELADA_EM_ANDAMENTO de diagnóstico não inclui campos de consumo', () => {
    const tarefa = criarDiagnostico();
    tarefa.iniciar('mec-1', agora);
    tarefa.cancelarEmAndamento('motivo', agora);

    const payload = montarPayloadRespostaCancelamento(
      tarefa,
      TipoTarefa.DIAGNOSTICO,
      ResultadoCancelamento.CANCELADA_EM_ANDAMENTO,
    );

    expect(payload).toEqual({
      tipoTarefa: 'DIAGNOSTICO',
      resultado: 'CANCELADA_EM_ANDAMENTO',
    });
    serializadoSemCamposConsumo(payload);
  });
});
