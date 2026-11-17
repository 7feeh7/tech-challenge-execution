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

  it('JA_ENCERRADA CANCELADA traz listas vazias sem fato terminal', () => {
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
});
