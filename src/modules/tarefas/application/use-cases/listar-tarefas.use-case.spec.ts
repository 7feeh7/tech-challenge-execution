import { TipoTarefa } from '../../domain/tipo-tarefa.enum';
import { ListarTarefasUseCase } from './listar-tarefas.use-case';
import { criarTarefaFake, criarTarefaGatewayMock } from './test-doubles';

describe('ListarTarefasUseCase', () => {
  it('lista a fila de diagnóstico com limite padrão e devolve o cursor', async () => {
    const tarefas = criarTarefaGatewayMock();
    tarefas.listarFila.mockResolvedValue({
      tarefas: [criarTarefaFake()],
      proximoCursor: 'cursor-2',
    });

    const saida = await new ListarTarefasUseCase(tarefas).execute({});

    expect(tarefas.listarFila).toHaveBeenCalledWith({
      tipo: TipoTarefa.DIAGNOSTICO,
      limite: 50,
      cursor: undefined,
    });
    expect(saida.itens).toHaveLength(1);
    expect(saida.itens[0].id).toBe('os-1#1#DIAGNOSTICO');
    expect(saida.proximoCursor).toBe('cursor-2');
  });

  it('repassa tipo, limite e cursor informados', async () => {
    const tarefas = criarTarefaGatewayMock();
    tarefas.listarFila.mockResolvedValue({ tarefas: [], proximoCursor: null });

    await new ListarTarefasUseCase(tarefas).execute({
      tipo: TipoTarefa.REPARO,
      limite: 10,
      cursor: 'c',
    });

    expect(tarefas.listarFila).toHaveBeenCalledWith({
      tipo: TipoTarefa.REPARO,
      limite: 10,
      cursor: 'c',
    });
  });
});
