import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ItemDiagnosticoDto {
  @ApiProperty({ enum: ['PECA', 'SERVICO'], example: 'PECA' })
  @IsIn(['PECA', 'SERVICO'], {
    message: 'Tipo do item deve ser PECA ou SERVICO.',
  })
  tipo!: 'PECA' | 'SERVICO';

  @ApiProperty({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  @IsString({ message: 'O itemId deve ser texto.' })
  @IsNotEmpty({ message: 'O itemId é obrigatório.' })
  @MaxLength(100, { message: 'O itemId excede 100 caracteres.' })
  itemId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt({ message: 'A quantidade deve ser um número inteiro.' })
  @Min(1, { message: 'A quantidade mínima é 1.' })
  @Max(10000, { message: 'A quantidade máxima é 10000.' })
  quantidade!: number;
}

export class ConcluirDiagnosticoDto {
  @ApiProperty({ example: 'Pastilhas de freio desgastadas; troca necessária.' })
  @IsString({ message: 'O laudo deve ser texto.' })
  @IsNotEmpty({ message: 'O laudo é obrigatório.' })
  @MaxLength(4000, { message: 'O laudo excede 4000 caracteres.' })
  laudo!: string;

  @ApiProperty({ type: [ItemDiagnosticoDto] })
  @IsArray({ message: 'Os itens devem ser uma lista.' })
  @ArrayMaxSize(100, { message: 'No máximo 100 itens na proposta.' })
  @ValidateNested({ each: true })
  @Type(() => ItemDiagnosticoDto)
  itens!: ItemDiagnosticoDto[];
}
