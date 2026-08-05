import { ApiProperty } from '@nestjs/swagger';

class MedecinInfoDto {
  @ApiProperty({ example: 16, description: 'Identifiant du médecin' })
  id: number;

  @ApiProperty({ example: 'ADMIN', description: 'Rôle temporaire de l’utilisateur' })
  role: string;

  @ApiProperty({ example: 'Test', description: 'Nom du médecin' })
  nom: string;

  @ApiProperty({ example: 'Médecin 1', description: 'Prénom du médecin' })
  prenom: string;

  @ApiProperty({ example: 'medecin1@chu.mg', description: 'Email du médecin' })
  email: string;

  @ApiProperty({ example: 'Cardiologie', description: 'Spécialité du médecin' })
  specialite: string;
}

export class LoginResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNiIsImVtYWlsIjoibWVkaWNpbjFAY2h1Lm1nIiwicm9sZSI6IkFETUlOIiwibWVkaWNpbklkIjoxNiwiaWF0IjoxNzA5OTI4NDAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token JWT complet à utiliser pour les appels authentifiés',
  })
  access_token: string;

  @ApiProperty({ example: 'ADMIN', description: 'Rôle temporaire de l’utilisateur connecté' })
  role: string;

  @ApiProperty({ type: MedecinInfoDto, description: 'Informations du médecin connecté' })
  medecin: MedecinInfoDto;
}
