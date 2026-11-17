import type { BuscarTarefaUseCase } from '../../../application/use-cases/buscar-tarefa.use-case';
import type { ConcluirTarefaDiagnosticoUseCase } from '../../../application/use-cases/concluir-tarefa-diagnostico.use-case';
import type { DevolverTarefaDiagnosticoUseCase } from '../../../application/use-cases/devolver-tarefa-diagnostico.use-case';
import type { IniciarTarefaDiagnosticoUseCase } from '../../../application/use-cases/iniciar-tarefa-diagnostico.use-case';
import type { ListarTarefasUseCase } from '../../../application/use-cases/listar-tarefas.use-case';
import { TipoTarefa } from '../../../domain/tipo-tarefa.enum';
import { TarefasController } from './tarefas.controller';

describe('TarefasController', () => {
  const listar = { execute: jest.fn() };
  const buscar = { execute: jest.fn() };
  const iniciar = { execute: jest.fn() };
  const devolver = { execute: jest.fn() };
  const concluir = { execute: jest.fn() };
  const controller = new TarefasController(
    listar as unknown as ListarTarefasUseCase,
    buscar as unknown as BuscarTarefaUseCase,
    iniciar as unknown as IniciarTarefaDiagnosticoUseCase,
    devolver as unknown as DevolverTarefaDiagnosticoUseCase,
    concluir as unknown as ConcluirTarefaDiagnosticoUseCase,
  );

  beforeEach(() => jest.clearAllMocks());

  it('lista a fila repassando os filtros da query', async () => {
    listar.execute.mockResolvedValue({ itens: [], proximoCursor: null });

    await controller.findAll({
      tipo: TipoTarefa.DIAGNOSTICO,
      limite: 5,
      cursor: 'c',
    });

    expect(listar.execute).toHaveBeenCalledWith({
      tipo: TipoTarefa.DIAGNOSTICO,
      limite: 5,
      cursor: 'c',
    });
  });

  it('busca a tarefa pelo id', async () => {
    buscar.execute.mockResolvedValue({ id: 'os#1#DIAGNOSTICO' });

    await expect(controller.findOne('os#1#DIAGNOSTICO')).resolves.toEqual({
      id: 'os#1#DIAGNOSTICO',
    });
  });

  it('inicia a tarefa em nome do usuário autenticado', async () => {
    iniciar.execute.mockResolvedValue({ situacao: 'EM_ANDAMENTO' });

    await controller.iniciar('os#1#DIAGNOSTICO', {
      sub: 'mec-1',
      perfil: 'MECANICO',
    });

    expect(iniciar.execute).toHaveBeenCalledWith('os#1#DIAGNOSTICO', 'mec-1');
  });

  it('devolve a tarefa à fila', async () => {
    devolver.execute.mockResolvedValue({ situacao: 'PENDENTE' });

    await controller.devolver('os#1#DIAGNOSTICO');

    expect(devolver.execute).toHaveBeenCalledWith('os#1#DIAGNOSTICO');
  });

  it('conclui o diagnóstico com laudo e itens do corpo', async () => {
    concluir.execute.mockResolvedValue({});
    const itens = [{ tipo: 'PECA' as const, itemId: 'p', quantidade: 1 }];

    await controller.concluir('os#1#DIAGNOSTICO', { laudo: 'L', itens });

    expect(concluir.execute).toHaveBeenCalledWith('os#1#DIAGNOSTICO', {
      laudo: 'L',
      itens,
    });
  });
});
