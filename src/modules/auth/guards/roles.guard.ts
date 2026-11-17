import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequisicaoAutenticada } from '../jwt-payload';
import type { PerfilUsuario } from '../perfil-usuario';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const alvos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvos)) {
      return true;
    }

    const perfisExigidos = this.reflector.getAllAndOverride<PerfilUsuario[]>(
      ROLES_KEY,
      alvos,
    );
    if (!perfisExigidos || perfisExigidos.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    if (!user || !perfisExigidos.includes(user.perfil as PerfilUsuario)) {
      throw new ForbiddenException(
        'Você não tem permissão para acessar este recurso.',
      );
    }
    return true;
  }
}
