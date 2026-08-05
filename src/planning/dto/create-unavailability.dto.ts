import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUnavailabilityDto {
  @ApiPropertyOptional({
    example: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
    description: 'UUID du médecin concerné. Les administrateurs peuvent choisir un autre médecin.',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  medecinId?: string;

  @ApiProperty({ example: '2026-08-10', description: 'Premier jour d\'indisponibilité (YYYY-MM-DD).' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-08-15', description: 'Dernier jour d\'indisponibilité, inclus (YYYY-MM-DD).' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: 'Congés annuels', description: 'Motif de l\'absence.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    enum: ['keep', 'replace'],
    example: 'replace',
    description:
      "Que faire des créneaux déjà planifiés dans la période : 'keep' les conserve, 'replace' supprime ceux à venir (les créneaux passés ne sont jamais supprimés). Défaut : 'keep'.",
  })
  @IsOptional()
  @IsIn(['keep', 'replace'])
  conflictStrategy?: 'keep' | 'replace';
}
