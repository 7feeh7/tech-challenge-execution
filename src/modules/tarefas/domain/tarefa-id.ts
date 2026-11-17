import type { TipoTarefa } from './tipo-tarefa.enum';

/** Chave determinística da tarefa (D5.2): uma por OS, rodada e tipo. */
export function montarTarefaId(
  ordemServicoId: string,
  rodada: number,
  tipo: TipoTarefa,
): string {
  return `${ordemServicoId}#${rodada}#${tipo}`;
}
