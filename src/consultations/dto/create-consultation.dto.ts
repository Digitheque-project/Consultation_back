import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class CreateConsultationDto {
  @ApiProperty({ example: 'CHU-2026-00012' })
  @IsString()
  @IsNotEmpty()
  patientId: string;

  @ApiProperty({ example: 'c2ded010-e37a-4ec1-bf93-4712393ba231', description: 'UUID du médecin (identifiant du service auth CHU).' })
  @IsString()
  @IsUUID()
  medecinId: string;

  @ApiProperty({ example: '2026-06-26' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:30' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/, { message: 'heure doit être au format HH:mm' })
  heure: string;

  @ApiProperty({ example: 'Douleur thoracique' })
  @IsString()
  @IsNotEmpty()
  motif: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  urgence?: boolean;

  @ApiPropertyOptional({
    example: 'CONTROLE',
    enum: ['INITIAL', 'CONTROLE'],
    description: 'Type de visite. CONTROLE pour les contrôles post-hospitalisation envoyés par le service clinique.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['INITIAL', 'CONTROLE'])
  typeVisite?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Ordre du contrôle (1 = premier contrôle, 2 = deuxième, etc.). Requis si typeVisite=CONTROLE.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  ordreControle?: number;

  @ApiPropertyOptional({
    example: 42,
    description: 'ID de la consultation initiale (dans ce service) dont ce contrôle est le suivi. Optionnel.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  consultationParenteId?: number;
}
