import type { ItemOficial } from './entities/tarefa.entity';
import {
  ItemServicoNaoAutorizadoError,
  PecaAdicionalNaoAutorizadaError,
  QuantidadeExcedeAutorizadaError,
  QuantidadeUtilizadaInvalidaError,
} from './errors/tarefa.errors';
import { validarExecucaoReparo } from './validar-execucao-reparo';

const itensOficiais: ItemOficial[] = [
  {
    tipo: 'SERVICO',
    itemId: 'svc-1',
    nome: 'Troca',
    quantidade: 1,
  },
  {
    tipo: 'PECA',
    itemId: 'peca-1',
    nome: 'Pastilha',
    quantidade: 2,
  },
];

describe('validarExecucaoReparo', () => {
  it('aceita consumo inferior ao autorizado e registra divergência', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [{ itemId: 'peca-1', quantidade: 1 }],
    );

    expect(resultado.divergencias).toHaveLength(1);
    expect(resultado.divergencias[0]).toMatchObject({
      itemId: 'peca-1',
      quantidadePrevista: 2,
      quantidadeUtilizada: 1,
    });
  });

  it('recusa peça adicional', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [],
        [{ itemId: 'peca-extra', quantidade: 1 }],
      ),
    ).toThrow(PecaAdicionalNaoAutorizadaError);
  });

  it('recusa quantidade acima da autorizada', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [],
        [{ itemId: 'peca-1', quantidade: 3 }],
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

  it('agrega peças repetidas no corpo', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [
        { itemId: 'peca-1', quantidade: 1 },
        { itemId: 'peca-1', quantidade: 1 },
      ],
    );
    expect(resultado.pecasUtilizadas).toEqual([
      { itemId: 'peca-1', quantidade: 2 },
    ]);
    expect(resultado.divergencias).toHaveLength(0);
  });

  it('permite conclusão sem peças utilizadas', () => {
    const resultado = validarExecucaoReparo(
      itensOficiais,
      [{ itemId: 'svc-1', quantidade: 1 }],
      [],
    );
    expect(resultado.pecasUtilizadas).toEqual([]);
    expect(resultado.divergencias).toHaveLength(0);
  });

  it('recusa quantidade inválida', () => {
    expect(() =>
      validarExecucaoReparo(
        itensOficiais,
        [],
        [{ itemId: 'peca-1', quantidade: 0 }],
      ),
    ).toThrow(QuantidadeUtilizadaInvalidaError);
  });
});
