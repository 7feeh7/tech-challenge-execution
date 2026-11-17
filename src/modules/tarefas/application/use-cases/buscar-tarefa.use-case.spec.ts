import { TarefaNaoEncontradaError } from '../../domain/errors/tarefa.errors';
import { BuscarTarefaUseCase } from './buscar-tarefa.use-case';
import { criarTarefaFake, criarTarefaGatewayMock } from './test-doubles';

describe('BuscarTarefaUseCase', () => {
  it('devolve a tarefa mapeada para saída', async () => {
    const tarefas = criarTarefaGatewayMock();
    tarefas.consultarPorId.mockResolvedValue(criarTarefaFake());

    const saida = await new BuscarTarefaUseCase(tarefas).execute(
      'os-1#1#DIAGNOSTICO',
    );

    expect(saida).toMatchObject({
      id: 'os-1#1#DIAGNOSTICO',
      situacao: 'PENDENTE',
      criadoEm: '2026-11-15T10:00:00.000Z',
      iniciadoEm: null,
    });
  });

  it('falha quando a tarefa não existe', async () => {
    const tarefas = criarTarefaGatewayMock();
    tarefas.consultarPorId.mockResolvedValue(null);

    await expect(
      new BuscarTarefaUseCase(tarefas).execute('x'),
    ).rejects.toBeInstanceOf(TarefaNaoEncontradaError);
  });
});
