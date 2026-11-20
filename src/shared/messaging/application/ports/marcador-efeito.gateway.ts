import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';

/** Grava marcador mínimo na tabela de tarefas dentro da transação — só testes e etapas de infra. */
export interface MarcadorEfeitoGateway {
  gravarMarcador(
    contexto: ContextoTransacao,
    chavePk: string,
    eventId: string,
  ): Promise<void>;
}
