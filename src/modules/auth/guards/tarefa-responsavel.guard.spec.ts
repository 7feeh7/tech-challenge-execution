import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ResponsavelTarefaGateway } from '../ports/responsavel-tarefa.gateway';
import { TarefaResponsavelGuard } from './tarefa-responsavel.guard';

describe('TarefaResponsavelGuard', () => {
  let responsaveis: jest.Mocked<ResponsavelTarefaGateway>;
  let guard: TarefaResponsavelGuard;

  const criarContexto = (
    user?: { sub: string; perfil: string },
    id: string | undefined = 'os#1#DIAGNOSTICO',
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, params: id ? { id } : {} }),
      }),
    }) as never;

  beforeEach(() => {
    responsaveis = { buscarResponsavel: jest.fn() };
    guard = new TarefaResponsavelGuard(responsaveis);
  });

  it('libera o mecânico responsável pela tarefa', async () => {
    responsaveis.buscarResponsavel.mockResolvedValue({
      existe: true,
      responsavelId: 'mec-1',
    });

    await expect(
      guard.canActivate(criarContexto({ sub: 'mec-1', perfil: 'MECANICO' })),
    ).resolves.toBe(true);
  });

  it('recusa mecânico que não é o responsável', async () => {
    responsaveis.buscarResponsavel.mockResolvedValue({
      existe: true,
      responsavelId: 'mec-2',
    });

    await expect(
      guard.canActivate(criarContexto({ sub: 'mec-1', perfil: 'MECANICO' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('libera tarefa sem responsável para o caso de uso recusar pelo estado', async () => {
    responsaveis.buscarResponsavel.mockResolvedValue({
      existe: true,
      responsavelId: null,
    });

    await expect(
      guard.canActivate(criarContexto({ sub: 'mec-1', perfil: 'MECANICO' })),
    ).resolves.toBe(true);
  });

  it('libera o administrador sem consultar a tarefa', async () => {
    await expect(
      guard.canActivate(criarContexto({ sub: 'adm', perfil: 'ADMINISTRADOR' })),
    ).resolves.toBe(true);
    expect(responsaveis.buscarResponsavel).not.toHaveBeenCalled();
  });

  it('responde não encontrada quando a tarefa não existe', async () => {
    responsaveis.buscarResponsavel.mockResolvedValue({
      existe: false,
      responsavelId: null,
    });

    await expect(
      guard.canActivate(criarContexto({ sub: 'mec-1', perfil: 'MECANICO' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responde não encontrada quando a rota não traz o id', async () => {
    await expect(
      guard.canActivate(
        criarContexto({ sub: 'mec-1', perfil: 'MECANICO' }, ''),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa quando não há usuário autenticado', async () => {
    await expect(guard.canActivate(criarContexto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
