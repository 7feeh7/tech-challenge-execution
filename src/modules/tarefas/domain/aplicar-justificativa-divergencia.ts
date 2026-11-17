import type { DivergenciaPeca } from './entities/tarefa.entity';
import {
  JustificativaDivergenciaInvalidaError,
  JustificativaDivergenciaObrigatoriaError,
} from './errors/tarefa.errors';
import { TipoDivergenciaPeca } from './tipo-divergencia-peca.enum';

export const JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO = 500;

export function divergenciaExigeJustificativa(
  tipo: TipoDivergenciaPeca,
): boolean {
  return (
    tipo === TipoDivergenciaPeca.CONSUMO_ACIMA ||
    tipo === TipoDivergenciaPeca.FORA_DA_LISTA
  );
}

export function aplicarJustificativaDivergencia(
  divergencias: DivergenciaPeca[],
  justificativaInformada?: string,
): DivergenciaPeca[] {
  const exigeObrigatoria = divergencias.some((d) =>
    divergenciaExigeJustificativa(d.tipo),
  );
  const justificativa =
    justificativaInformada === undefined
      ? undefined
      : justificativaInformada.trim();

  if (justificativaInformada !== undefined && justificativa === '') {
    throw new JustificativaDivergenciaInvalidaError();
  }
  if (
    justificativa &&
    justificativa.length > JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO
  ) {
    throw new JustificativaDivergenciaInvalidaError();
  }
  if (exigeObrigatoria && !justificativa) {
    throw new JustificativaDivergenciaObrigatoriaError();
  }
  if (!justificativa) {
    return divergencias;
  }

  return divergencias.map((divergencia) => ({
    ...divergencia,
    justificativa,
  }));
}
