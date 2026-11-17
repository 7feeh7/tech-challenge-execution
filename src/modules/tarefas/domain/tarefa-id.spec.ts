import { montarTarefaId } from './tarefa-id';
import { TipoTarefa } from './tipo-tarefa.enum';

describe('montarTarefaId', () => {
  it('compõe osId#rodada#tipo', () => {
    expect(montarTarefaId('os-1', 2, TipoTarefa.DIAGNOSTICO)).toBe(
      'os-1#2#DIAGNOSTICO',
    );
  });
});
