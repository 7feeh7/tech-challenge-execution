import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload, RequisicaoAutenticada } from '../jwt-payload';

export const UsuarioAutenticado = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): JwtPayload | undefined =>
    contexto.switchToHttp().getRequest<RequisicaoAutenticada>().user,
);
