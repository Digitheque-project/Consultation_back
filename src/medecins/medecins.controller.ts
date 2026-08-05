import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { MedecinsService } from './medecins.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';

@ApiTags('medecins')
@ApiBearerAuth('access-token')
@Controller('medecins')
export class MedecinsController {
  constructor(private readonly medecinsService: MedecinsService) {}

  private getRawToken(req: Request): string | undefined {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice('Bearer '.length).trim() || undefined;
  }

  @UseGuards(JwtGuard)
  @Get()
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Lister les médecins du service consultation externe',
    description:
      "Retourne tous les médecins enregistrés dans le service 'Consultation externe' du service auth CHU. " +
      "Nécessite un token valide (n'importe quel compte du CHU, aucun rôle particulier requis) — utilisé " +
      "par l'accueil pour choisir le médecin lors de l'orientation d'un patient. " +
      'Les données sont synchronisées depuis le service auth toutes les 5 minutes, en utilisant le token ' +
      'de la requête elle-même (aucun compte de service séparé à maintenir).',
  })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909', description: 'UUID du médecin (identique à son ID dans le service auth) — à utiliser dans medecinId de POST /consultations' },
          nom: { type: 'string', example: 'Dupont' },
          prenom: { type: 'string', example: 'Jean' },
          email: { type: 'string', example: 'j.dupont@chu.mg' },
          specialite: { type: 'string', nullable: true, example: 'Cardiologie' },
          telephone: { type: 'string', nullable: true, example: '+261 34 00 000 00' },
          role: { type: 'string', example: 'MEDECIN' },
        },
      },
    },
  })
  findAll(@Req() req: Request) {
    return this.medecinsService.findAll(this.getRawToken(req));
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Récupérer un médecin par UUID' })
  @ApiParam({ name: 'id', description: 'UUID du médecin (identifiant du service auth CHU)', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  @ApiResponse({ status: 200, description: 'Médecin trouvé' })
  @ApiResponse({ status: 404, description: 'Médecin non trouvé' })
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.medecinsService.findOne(id, this.getRawToken(req));
  }
}
