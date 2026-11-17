import { SetMetadata } from '@nestjs/common';
import type { PerfilUsuario } from '../perfil-usuario';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: PerfilUsuario[]) =>
  SetMetadata(ROLES_KEY, roles);
