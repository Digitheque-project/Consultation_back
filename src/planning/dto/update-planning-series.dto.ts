import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class UpdatePlanningSeriesDto {
  @ApiProperty({
    example: '2026-08-17',
    description: 'Applique la modification à cette occurrence et à toutes celles de la série à partir de cette date (les occurrences passées ne sont jamais modifiées).',
  })
  @IsDateString()
  fromDate: string;

  @ApiPropertyOptional({ example: '08:00', description: 'Nouvelle heure de début au format HH:mm.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureDebut doit être au format HH:mm' })
  heureDebut?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Nouvelle heure de fin au format HH:mm.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureFin doit être au format HH:mm' })
  heureFin?: string;

  @ApiPropertyOptional({ example: 8, description: 'Nouveau quota de patients par occurrence.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quota?: number;

  @ApiPropertyOptional({ example: true, description: 'Nouvelle disponibilité pour ces occurrences.' })
  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @ApiPropertyOptional({ example: 'Notes mises à jour', description: 'Nouvelle note pour ces occurrences.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
