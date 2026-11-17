import type { ItemDiagnostico } from '../../domain/entities/tarefa.entity';

export interface PedidoConclusaoDiagnosticoOs {
  ordemServicoId: string;
  rodada: number;
  tarefaId: string;
  laudo: string;
  itens: ItemDiagnostico[];
  correlationId: string;
  requestId: string;
}

export interface ItemOficial {
  tipo: string;
  itemId: string;
  nome: string;
  quantidade: number;
}

export type ResultadoConclusaoDiagnosticoOs =
  | { tipo: 'sucesso'; rodada: number; itensOficiais: ItemOficial[] }
  | { tipo: 'recusada'; status: number; codigo: string; mensagem: string }
  | { tipo: 'indeterminado'; motivo: string };

export interface ConclusaoDiagnosticoOsGateway {
  concluir(
    pedido: PedidoConclusaoDiagnosticoOs,
  ): Promise<ResultadoConclusaoDiagnosticoOs>;
}
