import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

// @nestjs/jwt v12 é ESM puro e o Jest roda em CommonJS: o guard só usa o token de injeção aqui.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

describe('JwtAuthGuard', () => {
  let jwtService: { verifyAsync: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let config: Record<string, string | undefined>;
  let guard: JwtAuthGuard;

  const criarContexto = (authorization?: string, request = {} as any) => {
    request.headers = authorization ? { authorization } : {};
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    config = {};
    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      reflector as unknown as Reflector,
      { get: (chave: string) => config[chave] } as unknown as ConfigService,
    );
  });

  it('aceita token RS256 válido e anexa o usuário à requisição', async () => {
    const request = {} as any;
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'mecanico-1',
      email: 'mec@oficina.com',
      perfil: 'MECANICO',
    });

    await expect(
      guard.canActivate(criarContexto('Bearer token', request)),
    ).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
      algorithms: ['RS256'],
    });
    expect(request.user.sub).toBe('mecanico-1');
  });

  it('libera rota pública sem token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(criarContexto())).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejeita requisição sem token', async () => {
    await expect(guard.canActivate(criarContexto())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita esquema diferente de Bearer', async () => {
    await expect(
      guard.canActivate(criarContexto('Basic abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita token com assinatura inválida ou expirado', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita token sem sub ou sem perfil', async () => {
    jwtService.verifyAsync.mockResolvedValue({ perfil: 'MECANICO' });

    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita issuer divergente quando configurado', async () => {
    config.JWT_ISSUER = 'tech-challenge-auth';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'u1',
      perfil: 'MECANICO',
      iss: 'outro',
    });

    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita audience ausente quando configurada', async () => {
    config.JWT_AUDIENCE = 'tech-challenge-api';
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', perfil: 'MECANICO' });

    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita issuer e audience (texto ou lista) corretos', async () => {
    config.JWT_ISSUER = 'tech-challenge-auth';
    config.JWT_AUDIENCE = 'tech-challenge-api';
    jwtService.verifyAsync
      .mockResolvedValueOnce({
        sub: 'u1',
        perfil: 'MECANICO',
        iss: 'tech-challenge-auth',
        aud: 'tech-challenge-api',
      })
      .mockResolvedValueOnce({
        sub: 'u1',
        perfil: 'MECANICO',
        iss: 'tech-challenge-auth',
        aud: ['outra', 'tech-challenge-api'],
      });

    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(criarContexto('Bearer token')),
    ).resolves.toBe(true);
  });
});
