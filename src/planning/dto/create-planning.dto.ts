import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreatePlanningDto {
  @ApiProperty({
    example: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
    required: false,
    description: 'UUID du médecin propriétaire du créneau (identifiant du service auth CHU). Les administrateurs peuvent choisir un autre médecin.',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  medecinId?: string;

  @ApiProperty({
    example: '2026-06-22',
    description: 'Date du créneau de disponibilité au format YYYY-MM-DD.',
  })
  @IsDateString()
  date: string;

  @ApiProperty({
    example: '08:00',
    description: 'Heure de début du créneau au format HH:mm.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureDebut doit être au format HH:mm' })
  heureDebut: string;

  @ApiProperty({
    example: '12:00',
    description: 'Heure de fin du créneau au format HH:mm.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureFin doit être au format HH:mm' })
  heureFin: string;

  @ApiProperty({
    example: 8,
    description: 'Quota de patients que le médecin peut recevoir pendant ce créneau.',
  })
  @IsInt()
  @Min(1)
  quota: number;

  @ApiProperty({
    example: true,
    description: 'Indique si le médecin est disponible pendant ce créneau.',
  })
  @IsBoolean()
  disponible: boolean;

  @ApiProperty({
    example: 'Consultations externes - salle 2',
    required: false,
    description: 'Note optionnelle ou libellé du créneau.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
