import { ApiProperty } from '@nestjs/swagger';

export class PlanningResponseDto {
  @ApiProperty({ example: 1, description: 'Identifiant du créneau de planning' })
  id: number;

  @ApiProperty({ example: 'c2ded010-e37a-4ec1-bf93-4712393ba231', description: 'UUID du médecin lié au créneau' })
  medecinId: string;

  @ApiProperty({ example: '2026-06-22', description: 'Date du créneau' })
  date: string;

  @ApiProperty({ example: '08:00', description: 'Heure de début du créneau' })
  heureDebut: string;

  @ApiProperty({ example: '12:00', description: 'Heure de fin du créneau' })
  heureFin: string;

  @ApiProperty({ example: 8, description: 'Quota de patients attendus pour ce créneau' })
  quota: number;

  @ApiProperty({ example: true, description: 'Indique si le médecin est disponible' })
  disponible: boolean;

  @ApiProperty({ example: 'Consultations externes - salle 2', description: 'Libellé ou note du créneau', required: false })
  notes?: string | null;

  @ApiProperty({ example: 'a1b2c3d4-...', description: 'Identifiant de série si ce créneau fait partie d\'une récurrence (voir POST /planning/recurring)', required: false })
  seriesId?: string | null;

  @ApiProperty({ example: '2026-06-22T08:00:00.000Z', description: 'Date de création du créneau' })
  createdAt: string;

  @ApiProperty({ example: '2026-06-22T08:00:00.000Z', description: 'Date de dernière mise à jour du créneau' })
  updatedAt: string;
}
