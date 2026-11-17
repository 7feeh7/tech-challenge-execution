import {
  DevolucaoForaDaRodadaInicialError,
  TarefaSituacaoInvalidaError,
} from '../errors/tarefa.errors';
import { SituacaoTarefa } from '../situacao-tarefa.enum';
import { TipoTarefa } from '../tipo-tarefa.enum';
import { Tarefa } from './tarefa.entity';

const agora = new Date('2026-11-15T10:00:00.000Z');
const depois = new Date('2026-11-15T11:00:00.000Z');
const conclusao = {
  laudo: 'Pastilhas desgastadas',
  itens: [{ tipo: 'PECA' as const, itemId: 'peca-1', quantidade: 2 }],
};

function criarTarefa(rodada = 1): Tarefa {
  return Tarefa.criar({
    tipo: TipoTarefa.DIAGNOSTICO,
    ordemServicoId: 'os-1',
    rodada,
    correlationId: 'corr-1',
    veiculo: { placa: 'ABC1D23', modelo: 'Sedan' },
    descricaoProblema: 'Barulho ao frear',
    sugestoes: [],
    itensOficiais: [],
    criadoEm: agora,
  });
}

describe('Tarefa', () => {
  it('nasce pendente com chave osId#rodada#tipo', () => {
    const tarefa = criarTarefa();

    expect(tarefa.id).toBe('os-1#1#DIAGNOSTICO');
    expect(tarefa.situacao).toBe(SituacaoTarefa.PENDENTE);
    expect(tarefa.responsavelId).toBeNull();
    expect(tarefa.versao).toBe(0);
  });

  it('inicia a partir de pendente registrando responsável e marco', () => {
    const tarefa = criarTarefa();

    tarefa.iniciar('mec-1', depois);

    expect(tarefa.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
    expect(tarefa.responsavelId).toBe('mec-1');
    expect(tarefa.iniciadoEm).toEqual(depois);
    expect(tarefa.estaEmAndamentoPor('mec-1')).toBe(true);
    expect(tarefa.estaEmAndamentoPor('mec-2')).toBe(false);
  });

  it('recusa iniciar tarefa que não está pendente', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);

    expect(() => tarefa.iniciar('mec-2', depois)).toThrow(
      TarefaSituacaoInvalidaError,
    );
  });

  it('devolve à fila na rodada 1 e libera o responsável', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);

    tarefa.devolverAFila(depois);

    expect(tarefa.situacao).toBe(SituacaoTarefa.PENDENTE);
    expect(tarefa.responsavelId).toBeNull();
    expect(tarefa.devolvidaEm).toEqual(depois);
  });

  it('recusa devolução fora da rodada 1', () => {
    const tarefa = criarTarefa(2);
    tarefa.iniciar('mec-1', agora);

    expect(() => tarefa.devolverAFila(depois)).toThrow(
      DevolucaoForaDaRodadaInicialError,
    );
  });

  it('recusa devolução de tarefa pendente ou já em conclusão', () => {
    const pendente = criarTarefa();
    expect(() => pendente.devolverAFila(depois)).toThrow(
      TarefaSituacaoInvalidaError,
    );

    const emConclusao = criarTarefa();
    emConclusao.iniciar('mec-1', agora);
    emConclusao.registrarConclusaoPendente(conclusao, agora);
    expect(() => emConclusao.devolverAFila(depois)).toThrow(
      TarefaSituacaoInvalidaError,
    );
  });

  it('guarda o payload ao registrar a conclusão pendente', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);

    tarefa.registrarConclusaoPendente(conclusao, depois);

    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUSAO_EM_ANDAMENTO);
    expect(tarefa.conclusaoPendente).toEqual(conclusao);
    expect(tarefa.laudo).toBeNull();
  });

  it('só registra conclusão pendente a partir de EM_ANDAMENTO', () => {
    expect(() =>
      criarTarefa().registrarConclusaoPendente(conclusao, depois),
    ).toThrow(TarefaSituacaoInvalidaError);
  });

  it('conclui consolidando laudo e proposta e limpando o payload pendente', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);
    tarefa.registrarConclusaoPendente(conclusao, agora);

    tarefa.concluir(depois);

    expect(tarefa.situacao).toBe(SituacaoTarefa.CONCLUIDA);
    expect(tarefa.laudo).toBe(conclusao.laudo);
    expect(tarefa.propostaItens).toEqual(conclusao.itens);
    expect(tarefa.conclusaoPendente).toBeNull();
    expect(tarefa.concluidaEm).toEqual(depois);
  });

  it('não conclui sem conclusão pendente gravada', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);

    expect(() => tarefa.concluir(depois)).toThrow(TarefaSituacaoInvalidaError);
  });

  it('reabre após recusa descartando o payload', () => {
    const tarefa = criarTarefa();
    tarefa.iniciar('mec-1', agora);
    tarefa.registrarConclusaoPendente(conclusao, agora);

    tarefa.reabrirAposRecusa(depois);

    expect(tarefa.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
    expect(tarefa.conclusaoPendente).toBeNull();
    expect(tarefa.responsavelId).toBe('mec-1');
  });

  it('restaura o estado persistido', () => {
    const original = criarTarefa();
    original.iniciar('mec-1', depois);

    const restaurada = Tarefa.restaurar({
      id: original.id,
      tipo: original.tipo,
      ordemServicoId: original.ordemServicoId,
      rodada: original.rodada,
      situacao: original.situacao,
      correlationId: original.correlationId,
      veiculo: original.veiculo,
      descricaoProblema: original.descricaoProblema,
      sugestoes: original.sugestoes,
      itensOficiais: original.itensOficiais,
      responsavelId: original.responsavelId,
      conclusaoPendente: original.conclusaoPendente,
      laudo: original.laudo,
      propostaItens: original.propostaItens,
      servicosRealizados: original.servicosRealizados,
      pecasUtilizadas: original.pecasUtilizadas,
      divergencias: original.divergencias,
      responsavelOperacaoId: original.responsavelOperacaoId,
      motivoFalha: original.motivoFalha,
      falhouEm: original.falhouEm,
      criadoEm: original.criadoEm,
      iniciadoEm: original.iniciadoEm,
      devolvidaEm: original.devolvidaEm,
      concluidaEm: original.concluidaEm,
      atualizadoEm: original.atualizadoEm,
      versao: 3,
    });

    expect(restaurada.situacao).toBe(SituacaoTarefa.EM_ANDAMENTO);
    expect(restaurada.versao).toBe(3);
    expect(restaurada.atualizadoEm).toEqual(depois);
  });
});
