import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateRecurringPlanningDto {
  @ApiProperty({
    example: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
    required: false,
    description: 'UUID du médecin propriétaire des créneaux. Les administrateurs peuvent choisir un autre médecin.',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  medecinId?: string;

  @ApiProperty({ example: '2026-08-03', description: 'Première date possible de la récurrence (YYYY-MM-DD).' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-09-30', description: 'Dernière date possible de la récurrence, incluse (YYYY-MM-DD).' })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    example: [1, 3, 5],
    description: 'Jours de la semaine où répéter le créneau — 1=Lundi ... 7=Dimanche.',
    type: [Number],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek: number[];

  @ApiProperty({ example: '08:00', description: 'Heure de début du créneau au format HH:mm.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureDebut doit être au format HH:mm' })
  heureDebut: string;

  @ApiProperty({ example: '11:00', description: 'Heure de fin du créneau au format HH:mm.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heureFin doit être au format HH:mm' })
  heureFin: string;

  @ApiProperty({ example: 10, description: 'Quota de patients que le médecin peut recevoir par occurrence.' })
  @IsInt()
  @Min(1)
  quota: number;

  @ApiProperty({ example: true, description: 'Indique si le médecin est disponible sur ces créneaux.' })
  @IsBoolean()
  disponible: boolean;

  @ApiProperty({ example: 'Consultations pédiatriques', required: false, description: 'Note optionnelle appliquée à chaque occurrence.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: ['2026-08-12'],
    required: false,
    type: [String],
    description:
      "Dates (YYYY-MM-DD) à ne pas générer — sert à écarter les occurrences tombant sur une indisponibilité déjà enregistrée.",
  })
  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  skipDates?: string[];
}
