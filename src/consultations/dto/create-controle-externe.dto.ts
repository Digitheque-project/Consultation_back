import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreateControleExterneDto {
  @ApiProperty({
    example: 'CHU-2026-00042',
    description: 'Identifiant du patient dans le SIH CHU (format CHU-AAAA-XXXXX).',
  })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({
    example: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
    description: 'UUID du médecin de consultation externe (identifiant du service auth CHU).',
  })
  @IsString()
  @IsUUID()
  medecinId: string;

  @ApiProperty({ example: '2026-07-20', description: 'Date souhaitée du rendez-vous (YYYY-MM-DD).' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '10:00', description: 'Heure du rendez-vous (HH:mm).' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heure doit être au format HH:mm' })
  heure: string;

  @ApiProperty({
    example: 'Contrôle post-opératoire à J+30 — appendicectomie',
    description: 'Motif du contrôle transmis par le service clinique.',
  })
  @IsString()
  @IsNotEmpty()
  motif: string;

  @ApiProperty({
    example: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394',
    description: 'Identifiant UUID du CHU source (établissement dont est issu le patient).',
  })
  @IsString()
  @IsNotEmpty()
  chuId: string;

  @ApiProperty({
    example: 'CHIRURGIE_DIGESTIVE',
    description: 'Code ou nom du service hospitalier d\'origine (ex: CHIRURGIE_DIGESTIVE, CARDIOLOGIE, PEDIATRIE).',
  })
  @IsString()
  @IsNotEmpty()
  serviceSource: string;

  @ApiPropertyOptional({ example: false, description: 'Marquer comme urgence.' })
  @IsOptional()
  @IsBoolean()
  urgence?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: 'Numéro d\'ordre du contrôle (1 = premier contrôle post-hospit, 2 = deuxième, etc.).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  ordreControle?: number;

  @ApiPropertyOptional({
    example: 123,
    description: 'ID de la consultation initiale dans CE service (si le patient a déjà consulté ici).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  consultationParenteId?: number;
}
