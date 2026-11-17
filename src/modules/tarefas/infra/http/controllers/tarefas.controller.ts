import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UsuarioAutenticado } from '@/modules/auth/decorators/usuario-autenticado.decorator';
import { TarefaResponsavelGuard } from '@/modules/auth/guards/tarefa-responsavel.guard';
import type { JwtPayload } from '@/modules/auth/jwt-payload';
import { PerfilUsuario } from '@/modules/auth/perfil-usuario';
import { BuscarTarefaUseCase } from '../../../application/use-cases/buscar-tarefa.use-case';
import { ConcluirTarefaDiagnosticoUseCase } from '../../../application/use-cases/concluir-tarefa-diagnostico.use-case';
import { DevolverTarefaDiagnosticoUseCase } from '../../../application/use-cases/devolver-tarefa-diagnostico.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '../../../application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { ListarTarefasUseCase } from '../../../application/use-cases/listar-tarefas.use-case';
import { ConcluirDiagnosticoDto } from '../dtos/concluir-diagnostico.dto';
import { ListarTarefasQueryDto } from '../dtos/listar-tarefas-query.dto';

const PARAMETRO_ID = {
  name: 'id',
  description:
    'Identificador osId#rodada#tipo; o # deve ser enviado codificado (%23).',
  example: '550e8400-e29b-41d4-a716-446655440000%231%23DIAGNOSTICO',
};

@ApiTags('Tarefas')
@ApiBearerAuth()
@Roles(PerfilUsuario.MECANICO, PerfilUsuario.ADMINISTRADOR)
@Controller('tarefas')
export class TarefasController {
  constructor(
    private readonly listarTarefas: ListarTarefasUseCase,
    private readonly buscarTarefa: BuscarTarefaUseCase,
    private readonly iniciarTarefa: IniciarTarefaDiagnosticoUseCase,
    private readonly devolverTarefa: DevolverTarefaDiagnosticoUseCase,
    private readonly concluirTarefa: ConcluirTarefaDiagnosticoUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista a fila de tarefas pendentes em ordem de chegada',
  })
  @ApiResponse({ status: 200, description: 'Página da fila.' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido.' })
  @ApiResponse({ status: 403, description: 'Perfil sem permissão.' })
  async findAll(@Query() query: ListarTarefasQueryDto) {
    return await this.listarTarefas.execute({
      tipo: query.tipo,
      limite: query.limite,
      cursor: query.cursor,
    });
  }

  @Get(':id')
  @ApiParam(PARAMETRO_ID)
  @ApiOperation({ summary: 'Busca uma tarefa pelo identificador' })
  @ApiResponse({ status: 200, description: 'Tarefa encontrada.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  async findOne(@Param('id') id: string) {
    return await this.buscarTarefa.execute(id);
  }

  @Post(':id/inicio')
  @HttpCode(200)
  @ApiParam(PARAMETRO_ID)
  @ApiOperation({
    summary: 'Inicia o diagnóstico e publica DiagnosticoIniciado',
  })
  @ApiResponse({ status: 200, description: 'Diagnóstico iniciado.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({ status: 409, description: 'Tarefa não está pendente.' })
  async iniciar(
    @Param('id') id: string,
    @UsuarioAutenticado() usuario: JwtPayload,
  ) {
    return await this.iniciarTarefa.execute(id, usuario.sub);
  }

  @Post(':id/devolucao')
  @HttpCode(200)
  @UseGuards(TarefaResponsavelGuard)
  @ApiParam(PARAMETRO_ID)
  @ApiOperation({
    summary: 'Devolve o diagnóstico da rodada 1 à fila (antes da conclusão)',
  })
  @ApiResponse({ status: 200, description: 'Tarefa devolvida à fila.' })
  @ApiResponse({ status: 403, description: 'Tarefa de outro mecânico.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({
    status: 409,
    description: 'Situação ou rodada não permite a devolução.',
  })
  async devolver(@Param('id') id: string) {
    return await this.devolverTarefa.execute(id);
  }

  @Post(':id/conclusao')
  @HttpCode(200)
  @UseGuards(TarefaResponsavelGuard)
  @ApiParam(PARAMETRO_ID)
  @ApiOperation({
    summary: 'Conclui o diagnóstico com confirmação síncrona do OS',
  })
  @ApiResponse({ status: 200, description: 'Diagnóstico concluído no OS.' })
  @ApiResponse({ status: 403, description: 'Tarefa de outro mecânico.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({
    status: 409,
    description: 'Situação inválida ou conflito informado pelo OS.',
  })
  @ApiResponse({ status: 422, description: 'Conteúdo recusado pelo OS.' })
  @ApiResponse({
    status: 503,
    description:
      'OS sem resposta definitiva; a conclusão segue pendente e deve ser repetida.',
  })
  async concluir(@Param('id') id: string, @Body() dto: ConcluirDiagnosticoDto) {
    return await this.concluirTarefa.execute(id, {
      laudo: dto.laudo,
      itens: dto.itens.map(({ tipo, itemId, quantidade }) => ({
        tipo,
        itemId,
        quantidade,
      })),
    });
  }
}
