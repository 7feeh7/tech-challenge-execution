export const COMANDO_INICIAR_DIAGNOSTICO = 'execution.iniciar-diagnostico.v1';
export const COMANDO_INICIAR_REPARO = 'execution.iniciar-reparo.v1';
export const COMANDO_CANCELAR_TAREFA = 'execution.cancelar-tarefa.v1';

export const DESTINO_FILA_OS = 'os-in';

export interface EnvelopeMensagem<T = unknown> {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  source: string;
  correlationId: string;
  causationId: string | null;
  ordemServicoId: string;
  rodada: number;
  payload: T;
}
