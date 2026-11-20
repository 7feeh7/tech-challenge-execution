import type {
  DivergenciaPeca,
  ItemOficial,
  ItemUtilizado,
} from './entities/tarefa.entity';
import {
  ItemServicoNaoAutorizadoError,
  QuantidadeExcedeAutorizadaError,
  QuantidadeUtilizadaInvalidaError,
} from './errors/tarefa.errors';
import { TipoDivergenciaPeca } from './tipo-divergencia-peca.enum';
import { validarItemIdPeca } from './validar-item-id-peca';

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

function agregarPecasUtilizadas(
  pecasInformadas: ItemUtilizado[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const { itemId, quantidade } of pecasInformadas) {
    if (!itemId || !Number.isInteger(quantidade) || quantidade <= 0) {
      throw new QuantidadeUtilizadaInvalidaError(itemId);
    }
    validarItemIdPeca(itemId);
    mapa.set(itemId, (mapa.get(itemId) ?? 0) + quantidade);
  }
  return mapa;
}

function observacaoPorTipo(tipo: TipoDivergenciaPeca): string {
  switch (tipo) {
    case TipoDivergenciaPeca.CONSUMO_INFERIOR:
      return 'Consumo efetivo inferior ao autorizado para a peça.';
    case TipoDivergenciaPeca.CONSUMO_ZERO:
      return 'Peça autorizada não consta no consumo efetivo informado.';
    case TipoDivergenciaPeca.CONSUMO_ACIMA:
      return 'Consumo efetivo superior ao autorizado para a peça.';
    case TipoDivergenciaPeca.FORA_DA_LISTA:
      return 'Peça utilizada fora do previsto.';
    default:
      return 'Divergência de consumo registrada.';
  }
}

function classificarConsumoOficial(
  itemId: string,
  prevista: number,
  utilizada: number,
): DivergenciaPeca | null {
  if (utilizada === prevista) {
    return null;
  }
  if (utilizada === 0) {
    return {
      itemId,
      tipo: TipoDivergenciaPeca.CONSUMO_ZERO,
      quantidadePrevista: prevista,
      quantidadeUtilizada: 0,
      observacao: observacaoPorTipo(TipoDivergenciaPeca.CONSUMO_ZERO),
    };
  }
  if (utilizada < prevista) {
    return {
      itemId,
      tipo: TipoDivergenciaPeca.CONSUMO_INFERIOR,
      quantidadePrevista: prevista,
      quantidadeUtilizada: utilizada,
      observacao: observacaoPorTipo(TipoDivergenciaPeca.CONSUMO_INFERIOR),
    };
  }
  return {
    itemId,
    tipo: TipoDivergenciaPeca.CONSUMO_ACIMA,
    quantidadePrevista: prevista,
    quantidadeUtilizada: utilizada,
    observacao: observacaoPorTipo(TipoDivergenciaPeca.CONSUMO_ACIMA),
  };
}

/** Valida serviços e peças contra os itens oficiais e calcula divergências (D2.18 revisada). */
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
  const pecasMapa = agregarPecasUtilizadas(pecasInformadas);

  for (const [itemId, quantidade] of servicosMapa) {
    const autorizada = servicosOficiais.get(itemId);
    if (autorizada === undefined) {
      throw new ItemServicoNaoAutorizadoError(itemId);
    }
    if (quantidade > autorizada) {
      throw new QuantidadeExcedeAutorizadaError(itemId, quantidade, autorizada);
    }
  }

  const divergencias: DivergenciaPeca[] = [];

  for (const [itemId, prevista] of pecasOficiais) {
    const utilizada = pecasMapa.get(itemId) ?? 0;
    const divergencia = classificarConsumoOficial(itemId, prevista, utilizada);
    if (divergencia) {
      divergencias.push(divergencia);
    }
  }

  for (const [itemId, utilizada] of pecasMapa) {
    if (!pecasOficiais.has(itemId)) {
      divergencias.push({
        itemId,
        tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
        quantidadePrevista: 0,
        quantidadeUtilizada: utilizada,
        observacao: observacaoPorTipo(TipoDivergenciaPeca.FORA_DA_LISTA),
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
