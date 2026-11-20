import type { ContextoTransacao } from '@/shared/database/unit-of-work.port';
import type { Tarefa } from '../../domain/entities/tarefa.entity';
import type { TipoTarefa } from '../../domain/tipo-tarefa.enum';

export interface FiltroFilaTarefas {
  tipo: TipoTarefa;
  limite: number;
  cursor?: string;
}

export interface PaginaTarefas {
  tarefas: Tarefa[];
  proximoCursor: string | null;
}

export interface TarefaGateway {
  /** Leitura consistente dentro da transação; ignora marcadores de bloqueio. */
  buscarPorId(contexto: ContextoTransacao, id: string): Promise<Tarefa | null>;
  /** Também enxerga o marcador de bloqueio de cancelamento (D4.4). */
  existeRegistro(contexto: ContextoTransacao, id: string): Promise<boolean>;
  gravarMarcadorBloqueio(
    contexto: ContextoTransacao,
    id: string,
    cancelamentoEventId: string,
    ordemServicoId: string,
    rodada: number,
    tipoTarefa: string,
  ): Promise<void>;
  criar(contexto: ContextoTransacao, tarefa: Tarefa): Promise<void>;
  /** Escrita condicional na versão lida; conflito vira nova tentativa. */
  salvar(contexto: ContextoTransacao, tarefa: Tarefa): Promise<void>;
  consultarPorId(id: string): Promise<Tarefa | null>;
  listarFila(filtro: FiltroFilaTarefas): Promise<PaginaTarefas>;
}
