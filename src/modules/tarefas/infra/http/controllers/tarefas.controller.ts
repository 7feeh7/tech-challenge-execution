import {
  BadRequestException,
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
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { UsuarioAutenticado } from '@/modules/auth/decorators/usuario-autenticado.decorator';
import { TarefaResponsavelGuard } from '@/modules/auth/guards/tarefa-responsavel.guard';
import type { JwtPayload } from '@/modules/auth/jwt-payload';
import { PerfilUsuario } from '@/modules/auth/perfil-usuario';
import { BuscarTarefaUseCase } from '../../../application/use-cases/buscar-tarefa.use-case';
import { ConcluirTarefaDiagnosticoUseCase } from '../../../application/use-cases/concluir-tarefa-diagnostico.use-case';
import { ConcluirTarefaReparoUseCase } from '../../../application/use-cases/concluir-tarefa-reparo.use-case';
import { DevolverTarefaDiagnosticoUseCase } from '../../../application/use-cases/devolver-tarefa-diagnostico.use-case';
import { FalharTarefaReparoUseCase } from '../../../application/use-cases/falhar-tarefa-reparo.use-case';
import { IniciarTarefaDiagnosticoUseCase } from '../../../application/use-cases/iniciar-tarefa-diagnostico.use-case';
import { IniciarTarefaReparoUseCase } from '../../../application/use-cases/iniciar-tarefa-reparo.use-case';
import { ListarTarefasUseCase } from '../../../application/use-cases/listar-tarefas.use-case';
import { extrairTipoTarefaId } from '../../../domain/tarefa-id';
import { TipoTarefa } from '../../../domain/tipo-tarefa.enum';
import { ConcluirDiagnosticoDto } from '../dtos/concluir-diagnostico.dto';
import {
  ConcluirReparoDto,
  FalharReparoDto,
} from '../dtos/concluir-reparo.dto';
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
    private readonly iniciarDiagnostico: IniciarTarefaDiagnosticoUseCase,
    private readonly iniciarReparo: IniciarTarefaReparoUseCase,
    private readonly devolverTarefa: DevolverTarefaDiagnosticoUseCase,
    private readonly concluirDiagnostico: ConcluirTarefaDiagnosticoUseCase,
    private readonly concluirReparo: ConcluirTarefaReparoUseCase,
    private readonly falharReparo: FalharTarefaReparoUseCase,
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
    summary: 'Inicia a tarefa e publica DiagnosticoIniciado ou ReparoIniciado',
  })
  @ApiResponse({ status: 200, description: 'Tarefa iniciada.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({ status: 409, description: 'Tarefa não está pendente.' })
  async iniciar(
    @Param('id') id: string,
    @UsuarioAutenticado() usuario: JwtPayload,
  ) {
    if (extrairTipoTarefaId(id) === TipoTarefa.REPARO) {
      return await this.iniciarReparo.execute(id, usuario.sub);
    }
    return await this.iniciarDiagnostico.execute(id, usuario.sub);
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
    summary:
      'Conclui diagnóstico (com confirmação do OS) ou reparo (serviços e peças utilizadas)',
  })
  @ApiResponse({ status: 200, description: 'Conclusão registrada.' })
  @ApiResponse({ status: 403, description: 'Tarefa de outro mecânico.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({
    status: 409,
    description: 'Situação inválida ou conflito informado pelo OS.',
  })
  @ApiResponse({ status: 422, description: 'Conteúdo recusado.' })
  @ApiResponse({
    status: 503,
    description:
      'OS sem resposta definitiva; a conclusão do diagnóstico segue pendente.',
  })
  async concluir(@Param('id') id: string, @Body() body: unknown) {
    if (extrairTipoTarefaId(id) === TipoTarefa.REPARO) {
      const dto = await this.validarCorpo(ConcluirReparoDto, body);
      return await this.concluirReparo.execute(id, {
        servicosRealizados: dto.servicosRealizados,
        pecasUtilizadas: dto.pecasUtilizadas,
      });
    }
    const dto = await this.validarCorpo(ConcluirDiagnosticoDto, body);
    return await this.concluirDiagnostico.execute(id, {
      laudo: dto.laudo,
      itens: dto.itens.map(({ tipo, itemId, quantidade }) => ({
        tipo,
        itemId,
        quantidade,
      })),
    });
  }

  @Post(':id/falha')
  @HttpCode(200)
  @UseGuards(TarefaResponsavelGuard)
  @ApiParam(PARAMETRO_ID)
  @ApiOperation({
    summary: 'Registra falha do reparo e publica ReparoFalhou',
  })
  @ApiResponse({ status: 200, description: 'Falha registrada.' })
  @ApiResponse({ status: 403, description: 'Tarefa de outro mecânico.' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada.' })
  @ApiResponse({ status: 409, description: 'Situação inválida.' })
  @ApiResponse({ status: 422, description: 'Conteúdo recusado.' })
  async falhar(@Param('id') id: string, @Body() body: unknown) {
    const dto = await this.validarCorpo(FalharReparoDto, body);
    return await this.falharReparo.execute(id, {
      motivo: dto.motivo,
      servicosRealizados: dto.servicosRealizados,
      pecasUtilizadas: dto.pecasUtilizadas,
    });
  }

  private async validarCorpo<T extends object>(
    tipo: new () => T,
    body: unknown,
  ): Promise<T> {
    const dto = plainToInstance(tipo, body);
    try {
      await validateOrReject(dto, { forbidUnknownValues: false });
    } catch (erros) {
      throw new BadRequestException(erros);
    }
    return dto;
  }
}
