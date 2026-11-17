import { aplicarJustificativaDivergencia } from './aplicar-justificativa-divergencia';
import {
  JustificativaDivergenciaInvalidaError,
  JustificativaDivergenciaObrigatoriaError,
} from './errors/tarefa.errors';
import { TipoDivergenciaPeca } from './tipo-divergencia-peca.enum';

const divergenciaForaDaLista = {
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
  quantidadePrevista: 0,
  quantidadeUtilizada: 1,
  observacao: 'Peça utilizada fora do previsto.',
};

describe('aplicarJustificativaDivergencia', () => {
  it('exige justificativa para CONSUMO_ACIMA ou FORA_DA_LISTA', () => {
    expect(() =>
      aplicarJustificativaDivergencia([divergenciaForaDaLista]),
    ).toThrow(JustificativaDivergenciaObrigatoriaError);
  });

  it('rejeita justificativa apenas com espaços', () => {
    expect(() =>
      aplicarJustificativaDivergencia([divergenciaForaDaLista], '   '),
    ).toThrow(JustificativaDivergenciaInvalidaError);
  });

  it('copia a justificativa aparada para todas as divergências', () => {
    const divergencias = aplicarJustificativaDivergencia(
      [
        divergenciaForaDaLista,
        {
          itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          tipo: TipoDivergenciaPeca.CONSUMO_ACIMA,
          quantidadePrevista: 2,
          quantidadeUtilizada: 3,
          observacao: 'Consumo efetivo superior ao autorizado para a peça.',
        },
      ],
      '  Peça quebrou no serviço  ',
    );

    expect(
      divergencias.every((d) => d.justificativa === 'Peça quebrou no serviço'),
    ).toBe(true);
  });

  it('permite omitir justificativa em divergências informativas', () => {
    const divergencias = aplicarJustificativaDivergencia([
      {
        itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        tipo: TipoDivergenciaPeca.CONSUMO_INFERIOR,
        quantidadePrevista: 2,
        quantidadeUtilizada: 1,
        observacao: 'Consumo efetivo inferior ao autorizado para a peça.',
      },
    ]);

    expect(divergencias[0].justificativa).toBeUndefined();
  });
});
