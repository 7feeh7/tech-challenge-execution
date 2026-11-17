import type {
  DivergenciaPeca,
  ItemOficial,
  ItemUtilizado,
} from './entities/tarefa.entity';
import {
  ItemServicoNaoAutorizadoError,
  PecaAdicionalNaoAutorizadaError,
  QuantidadeExcedeAutorizadaError,
  QuantidadeUtilizadaInvalidaError,
} from './errors/tarefa.errors';

export interface ExecucaoReparoValidada {
  servicosRealizados: ItemUtilizado[];
  pecasUtilizadas: ItemUtilizado[];
  divergencias: DivergenciaPeca[];
}

export function agregarItensUtilizados(
  itens: ItemUtilizado[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const { itemId, quantidade } of itens) {
    if (!itemId || !Number.isInteger(quantidade) || quantidade <= 0) {
      throw new QuantidadeUtilizadaInvalidaError(itemId);
    }
    mapa.set(itemId, (mapa.get(itemId) ?? 0) + quantidade);
  }
  return mapa;
}

/** Valida serviços e peças contra os itens oficiais e calcula divergências (D2.18). */
export function validarExecucaoReparo(
  itensOficiais: ItemOficial[],
  servicosInformados: ItemUtilizado[],
  pecasInformadas: ItemUtilizado[],
): ExecucaoReparoValidada {
  const pecasOficiais = new Map<string, number>();
  const servicosOficiais = new Map<string, number>();
  for (const item of itensOficiais) {
    const destino = item.tipo === 'PECA' ? pecasOficiais : servicosOficiais;
    const atual = destino.get(item.itemId) ?? 0;
    destino.set(item.itemId, atual + item.quantidade);
  }

  const servicosMapa = agregarItensUtilizados(servicosInformados);
  const pecasMapa = agregarItensUtilizados(pecasInformadas);

  for (const [itemId, quantidade] of servicosMapa) {
    const autorizada = servicosOficiais.get(itemId);
    if (autorizada === undefined) {
      throw new ItemServicoNaoAutorizadoError(itemId);
    }
    if (quantidade > autorizada) {
      throw new QuantidadeExcedeAutorizadaError(itemId, quantidade, autorizada);
    }
  }

  for (const [itemId, quantidade] of pecasMapa) {
    const autorizada = pecasOficiais.get(itemId);
    if (autorizada === undefined) {
      throw new PecaAdicionalNaoAutorizadaError(itemId);
    }
    if (quantidade > autorizada) {
      throw new QuantidadeExcedeAutorizadaError(itemId, quantidade, autorizada);
    }
  }

  const divergencias: DivergenciaPeca[] = [];
  for (const [itemId, utilizada] of pecasMapa) {
    const prevista = pecasOficiais.get(itemId)!;
    if (utilizada !== prevista) {
      divergencias.push({
        itemId,
        quantidadePrevista: prevista,
        quantidadeUtilizada: utilizada,
        observacao:
          utilizada < prevista
            ? 'Consumo efetivo inferior ao autorizado para a peça.'
            : 'Peça utilizada fora do previsto.',
      });
    }
  }

  const servicosRealizados = [...servicosMapa.entries()].map(
    ([itemId, quantidade]) => ({ itemId, quantidade }),
  );
  const pecasUtilizadas = [...pecasMapa.entries()].map(
    ([itemId, quantidade]) => ({
      itemId,
      quantidade,
    }),
  );

  return { servicosRealizados, pecasUtilizadas, divergencias };
}
