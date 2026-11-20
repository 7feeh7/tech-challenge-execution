import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SituacaoTarefa } from '../../../domain/situacao-tarefa.enum';
import { TipoTarefa } from '../../../domain/tipo-tarefa.enum';

export class ListarTarefasQueryDto {
  @ApiPropertyOptional({ enum: TipoTarefa, default: TipoTarefa.DIAGNOSTICO })
  @IsOptional()
  @IsIn(Object.values(TipoTarefa), { message: 'Tipo de tarefa inválido.' })
  tipo?: TipoTarefa;

  @ApiPropertyOptional({
    enum: [SituacaoTarefa.PENDENTE],
    default: SituacaoTarefa.PENDENTE,
    description:
      'A fila só indexa tarefas PENDENTE; as demais situações são consultadas por id.',
  })
  @IsOptional()
  @IsIn([SituacaoTarefa.PENDENTE], {
    message: 'A listagem só aceita a situação PENDENTE.',
  })
  situacao?: SituacaoTarefa;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O limite deve ser um número inteiro.' })
  @Min(1, { message: 'O limite mínimo é 1.' })
  @Max(100, { message: 'O limite máximo é 100.' })
  limite?: number;

  @ApiPropertyOptional({ description: 'Cursor devolvido na página anterior.' })
  @IsOptional()
  @IsString({ message: 'O cursor deve ser texto.' })
  cursor?: string;
}
