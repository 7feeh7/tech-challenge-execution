import { ConflitoTransacionalError } from './conflito-transacional.error';
import { executarComRetentativaConflito } from './executar-com-retentativa-conflito';

describe('executarComRetentativaConflito', () => {
  it('repete a operação após conflito e devolve o resultado', async () => {
    const operacao = jest
      .fn()
      .mockRejectedValueOnce(new ConflitoTransacionalError('conflito'))
      .mockResolvedValue('ok');

    await expect(executarComRetentativaConflito(operacao)).resolves.toBe('ok');
    expect(operacao).toHaveBeenCalledTimes(2);
  });

  it('propaga o conflito quando esgota as tentativas', async () => {
    const operacao = jest
      .fn()
      .mockRejectedValue(new ConflitoTransacionalError('conflito'));

    await expect(
      executarComRetentativaConflito(operacao, 2),
    ).rejects.toBeInstanceOf(ConflitoTransacionalError);
    expect(operacao).toHaveBeenCalledTimes(2);
  });

  it('não repete erros que não são conflito', async () => {
    const operacao = jest.fn().mockRejectedValue(new Error('falha'));

    await expect(executarComRetentativaConflito(operacao)).rejects.toThrow(
      'falha',
    );
    expect(operacao).toHaveBeenCalledTimes(1);
  });
});
