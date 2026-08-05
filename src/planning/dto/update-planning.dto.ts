import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class UpdatePlanningDto {
  @ApiPropertyOptional({
    example: '2026-06-22',
    description: 'Nouvelle date du créneau au format YYYY-MM-DD.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Nouvelle heure de début au format HH:mm.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureDebut doit être au format HH:mm' })
  heureDebut?: string;

  @ApiPropertyOptional({
    example: '12:00',
    description: 'Nouvelle heure de fin au format HH:mm.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureFin doit être au format HH:mm' })
  heureFin?: string;

  @ApiPropertyOptional({
    example: 8,
    description: 'Nouveau quota de patients pour ce créneau.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quota?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Indique si le médecin est disponible pendant ce créneau.',
  })
  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @ApiPropertyOptional({
    example: 'Notes mises à jour',
    required: false,
    description: 'Note optionnelle pour décrire le créneau.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
