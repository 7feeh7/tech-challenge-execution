import { TipoTarefa } from './tipo-tarefa.enum';

/** Chave determinística da tarefa (D5.2): uma por OS, rodada e tipo. */
export function montarTarefaId(
  ordemServicoId: string,
  rodada: number,
  tipo: TipoTarefa,
): string {
  return `${ordemServicoId}#${rodada}#${tipo}`;
}

export function extrairTipoTarefaId(id: string): TipoTarefa | null {
  const indice = id.lastIndexOf('#');
  if (indice < 0) return null;
  const sufixo = id.slice(indice + 1);
  if (sufixo === TipoTarefa.DIAGNOSTICO || sufixo === TipoTarefa.REPARO) {
    return sufixo;
  }
  return null;
}
