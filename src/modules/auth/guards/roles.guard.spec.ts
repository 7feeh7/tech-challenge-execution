import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PerfilUsuario } from '../perfil-usuario';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const criarContexto = (user?: { perfil: string }) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  const configurar = (publica: boolean, perfis?: PerfilUsuario[]) => {
    reflector.getAllAndOverride.mockImplementation((chave: string) =>
      chave === 'isPublic' ? publica : perfis,
    );
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('libera rota pública', () => {
    configurar(true, [PerfilUsuario.ADMINISTRADOR]);

    expect(guard.canActivate(criarContexto())).toBe(true);
  });

  it('libera rota sem perfis exigidos', () => {
    configurar(false, undefined);

    expect(guard.canActivate(criarContexto({ perfil: 'MECANICO' }))).toBe(true);
  });

  it('libera usuário com perfil exigido', () => {
    configurar(false, [PerfilUsuario.MECANICO, PerfilUsuario.ADMINISTRADOR]);

    expect(guard.canActivate(criarContexto({ perfil: 'MECANICO' }))).toBe(true);
  });

  it('recusa perfil fora da lista, como cliente ou atendente', () => {
    configurar(false, [PerfilUsuario.MECANICO, PerfilUsuario.ADMINISTRADOR]);

    expect(() =>
      guard.canActivate(criarContexto({ perfil: 'CLIENTE' })),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(criarContexto({ perfil: 'ATENDENTE' })),
    ).toThrow(ForbiddenException);
  });

  it('recusa quando não há usuário autenticado', () => {
    configurar(false, [PerfilUsuario.MECANICO]);

    expect(() => guard.canActivate(criarContexto())).toThrow(
      ForbiddenException,
    );
  });
});
