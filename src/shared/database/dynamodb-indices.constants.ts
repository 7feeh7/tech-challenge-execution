/** GSI esparso: só itens outbox ainda não publicados. */
export const OUTBOX_GSI_PUBLICACAO_PENDENTE = 'gsi-publicacao-pendente';
export const OUTBOX_ATTR_INDICE_PENDENTE = 'indicePublicacaoPendente';
export const OUTBOX_ATTR_INDICE_PENDENTE_ORDEM =
  'indicePublicacaoPendenteOrdem';
export const OUTBOX_VALOR_INDICE_PENDENTE = 'PENDENTE';

/** GSI da fila de tarefas pendentes por tipo. */
export const TAREFAS_GSI_FILA = 'gsi-fila-tarefas';
export const TAREFAS_ATTR_INDICE_FILA = 'indiceFila';
export const TAREFAS_ATTR_INDICE_FILA_ORDEM = 'indiceFilaOrdem';

export function montarIndiceFilaTarefa(tipo: string): string {
  return `${tipo}#PENDENTE`;
}
