import type { ItemOficial } from './entities/tarefa.entity';
import {
  ItemPecaIdInvalidoError,
  ItemServicoNaoAutorizadoError,
  QuantidadeExcedeAutorizadaError,
  QuantidadeUtilizadaInvalidaError,
} from './errors/tarefa.errors';
import { TipoDivergenciaPeca } from './tipo-divergencia-peca.enum';
import { validarExecucaoReparo } from './validar-execucao-reparo';

const PECA_AUTORIZADA = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const PECA_FORA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const itensOficiais: ItemOficial[] = [
  {
    tipo: 'SERVICO',
    itemId: 'svc-1',
    nome: 'Troca',
    quantidade: 1,
  },
  {
    tipo: 'PECA',
    itemId: PECA_AUTORIZADA,
    nome: 'Pastilha',
    quantidade: 2,
  },
];

describe('validarExecucaoReparo', () => {
  it('aceita consumo exatamente igual ao autorizado sem divergências', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [{ itemId: PECA_AUTORIZADA, quantidade: 2 }],
    );

    expect(resultado.divergencias).toHaveLength(0);
    expect(resultado.pecasUtilizadas).toEqual([
      { itemId: PECA_AUTORIZADA, quantidade: 2 },
    ]);
  });

  it('registra CONSUMO_INFERIOR', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [{ itemId: PECA_AUTORIZADA, quantidade: 1 }],
    );

    expect(resultado.divergencias).toEqual([
      expect.objectContaining({
        tipo: TipoDivergenciaPeca.CONSUMO_INFERIOR,
        quantidadePrevista: 2,
        quantidadeUtilizada: 1,
      }),
    ]);
  });

  it('registra CONSUMO_ZERO quando a peça autorizada não é informada', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [],
    );

    expect(resultado.divergencias).toEqual([
      expect.objectContaining({
        tipo: TipoDivergenciaPeca.CONSUMO_ZERO,
        quantidadeUtilizada: 0,
        quantidadePrevista: 2,
      }),
    ]);
  });

  it('aceita CONSUMO_ACIMA sem recusar a operação', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [{ itemId: PECA_AUTORIZADA, quantidade: 3 }],
    );

    expect(resultado.divergencias).toEqual([
      expect.objectContaining({
        tipo: TipoDivergenciaPeca.CONSUMO_ACIMA,
        quantidadePrevista: 2,
        quantidadeUtilizada: 3,
      }),
    ]);
    expect(resultado.pecasUtilizadas[0].quantidade).toBe(3);
  });

  it('aceita peça FORA_DA_LISTA com quantidadePrevista zero', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [{ itemId: PECA_FORA, quantidade: 1 }],
    );

    expect(resultado.divergencias).toEqual([
      expect.objectContaining({
        tipo: TipoDivergenciaPeca.CONSUMO_ZERO,
      }),
      expect.objectContaining({
        tipo: TipoDivergenciaPeca.FORA_DA_LISTA,
        itemId: PECA_FORA,
        quantidadePrevista: 0,
        quantidadeUtilizada: 1,
      }),
    ]);
  });

  it('recusa identificador de peça inválido', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [],
        [{ itemId: 'peca-extra', quantidade: 1 }],
      ),
    ).toThrow(ItemPecaIdInvalidoError);
  });

  it('recusa quantidade acima da autorizada para serviço', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [{ itemId: 'svc-1', quantidade: 2 }],
        [],
      ),
    ).toThrow(QuantidadeExcedeAutorizadaError);
  });

  it('recusa serviço não autorizado', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [{ itemId: 'svc-x', quantidade: 1 }],
        [],
      ),
    ).toThrow(ItemServicoNaoAutorizadoError);
  });

  it('consolida peças repetidas antes da comparação', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [
        { itemId: PECA_AUTORIZADA, quantidade: 1 },
        { itemId: PECA_AUTORIZADA, quantidade: 1 },
      ],
    );
    expect(resultado.pecasUtilizadas).toEqual([
      { itemId: PECA_AUTORIZADA, quantidade: 2 },
    ]);
    expect(resultado.divergencias).toHaveLength(0);
  });

  it('recusa quantidade zero ou negativa', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [],
        [{ itemId: PECA_AUTORIZADA, quantidade: 0 }],
      ),
    ).toThrow(QuantidadeUtilizadaInvalidaError);
  });
});
