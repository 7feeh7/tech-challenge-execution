import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ItemUtilizadoDto {
  @ApiProperty({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  @IsString({ message: 'O itemId deve ser texto.' })
  @IsNotEmpty({ message: 'O itemId é obrigatório.' })
  @MaxLength(100, { message: 'O itemId excede 100 caracteres.' })
  itemId!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt({ message: 'A quantidade deve ser um número inteiro.' })
  @Min(1, { message: 'A quantidade mínima é 1.' })
  @Max(10000, { message: 'A quantidade máxima é 10000.' })
  quantidade!: number;
}

export class ConcluirReparoDto {
  @ApiProperty({ type: [ItemUtilizadoDto] })
  @IsArray({ message: 'servicosRealizados deve ser uma lista.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemUtilizadoDto)
  servicosRealizados!: ItemUtilizadoDto[];

  @ApiProperty({ type: [ItemUtilizadoDto] })
  @IsArray({ message: 'pecasUtilizadas deve ser uma lista.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemUtilizadoDto)
  pecasUtilizadas!: ItemUtilizadoDto[];
}

export class FalharReparoDto extends ConcluirReparoDto {
  @ApiProperty({ example: 'Peça incompatível com o veículo.' })
  @IsString({ message: 'O motivo deve ser texto.' })
  @IsNotEmpty({ message: 'O motivo é obrigatório.' })
  @MaxLength(500, { message: 'O motivo excede 500 caracteres.' })
  motivo!: string;
}
