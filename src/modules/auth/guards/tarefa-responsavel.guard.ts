import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequisicaoAutenticada } from '../jwt-payload';
import { PerfilUsuario } from '../perfil-usuario';
import type { ResponsavelTarefaGateway } from '../ports/responsavel-tarefa.gateway';
import { RESPONSAVEL_TAREFA_GATEWAY } from '../ports/tokens';

/**
 * Devolução e conclusão só valem para o mecânico que iniciou a tarefa.
 * O administrador pode intervir em qualquer tarefa.
 */
@Injectable()
export class TarefaResponsavelGuard implements CanActivate {
  constructor(
    @Inject(RESPONSAVEL_TAREFA_GATEWAY)
    private readonly responsaveis: ResponsavelTarefaGateway,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    const usuario = request.user;
    if (!usuario) {
      throw new ForbiddenException('Usuário não identificado.');
    }
    if (usuario.perfil === PerfilUsuario.ADMINISTRADOR) return true;

    const tarefaId = request.params?.id;
    if (!tarefaId) {
      throw new NotFoundException('Tarefa não identificada.');
    }

    const { existe, responsavelId } =
      await this.responsaveis.buscarResponsavel(tarefaId);
    if (!existe) {
      throw new NotFoundException(`Tarefa "${tarefaId}" não encontrada.`);
    }
    // Sem responsável (tarefa na fila): o caso de uso recusa pelo estado.
    if (responsavelId !== null && responsavelId !== usuario.sub) {
      throw new ForbiddenException(
        'A tarefa está sob responsabilidade de outro mecânico.',
      );
    }
    return true;
  }
}
