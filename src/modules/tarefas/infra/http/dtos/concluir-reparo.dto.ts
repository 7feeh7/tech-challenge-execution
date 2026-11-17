import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO } from '../../../domain/aplicar-justificativa-divergencia';

class QuantidadeItemUtilizadoDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt({ message: 'A quantidade deve ser um número inteiro.' })
  @Min(1, { message: 'A quantidade mínima é 1.' })
  @Max(10000, { message: 'A quantidade máxima é 10000.' })
  quantidade!: number;
}

export class ItemServicoUtilizadoDto extends QuantidadeItemUtilizadoDto {
  @ApiProperty({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  @IsString({ message: 'O itemId deve ser texto.' })
  @IsNotEmpty({ message: 'O itemId é obrigatório.' })
  @MaxLength(100, { message: 'O itemId excede 100 caracteres.' })
  itemId!: string;
}

export class ItemPecaUtilizadoDto extends QuantidadeItemUtilizadoDto {
  @ApiProperty({
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'O itemId de peça deve ser um UUID válido.' })
  itemId!: string;
}

export class ConcluirReparoDto {
  @ApiProperty({
    required: false,
    maxLength: JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO,
    description:
      'Justificativa da divergência; obrigatória quando há consumo acima do autorizado ou peça fora da lista.',
  })
  @IsOptional()
  @IsString({ message: 'A justificativa da divergência deve ser texto.' })
  @MaxLength(JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO, {
    message: `A justificativa da divergência excede ${JUSTIFICATIVA_DIVERGENCIA_TAMANHO_MAXIMO} caracteres.`,
  })
  justificativaDivergencia?: string;

  @ApiProperty({ type: [ItemServicoUtilizadoDto] })
  @IsArray({ message: 'servicosRealizados deve ser uma lista.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemServicoUtilizadoDto)
  servicosRealizados!: ItemServicoUtilizadoDto[];

  @ApiProperty({ type: [ItemPecaUtilizadoDto] })
  @IsArray({ message: 'pecasUtilizadas deve ser uma lista.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemPecaUtilizadoDto)
  pecasUtilizadas!: ItemPecaUtilizadoDto[];
}

export class FalharReparoDto extends ConcluirReparoDto {
  @ApiProperty({ example: 'Peça incompatível com o veículo.' })
  @IsString({ message: 'O motivo deve ser texto.' })
  @IsNotEmpty({ message: 'O motivo é obrigatório.' })
  @MaxLength(500, { message: 'O motivo excede 500 caracteres.' })
  motivo!: string;
}
