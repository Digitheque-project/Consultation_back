import { Controller, Get, NotFoundException, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';

@ApiTags('Auth')
@ApiBearerAuth('access-token')
@Controller('auth')
export class AuthController {
  @Get('profile')
  @ApiOperation({ summary: 'Profil du médecin connecté (valide le token via le service auth)' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        medecinId: { type: 'string', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
        nom: { type: 'string', example: 'Dupont' },
        prenom: { type: 'string', example: 'Jean' },
        email: { type: 'string', example: 'j.dupont@chu.mg' },
        specialite: { type: 'string', nullable: true },
        role: { type: 'string', example: 'MEDECIN' },
        chuNom: { type: 'string', nullable: true, example: 'CHU Andrainjato Fianarantsoa' },
        chuLogoUrl: { type: 'string', nullable: true, example: 'https://service-upload-aem1.onrender.com/files/xxx.jpeg' },
        otherServices: {
          type: 'array',
          description: 'Autres services (ex: cliniques) où ce médecin a aussi un rôle, pour le changement de service.',
          items: {
            type: 'object',
            properties: {
              serviceId: { type: 'string' },
              serviceName: { type: 'string', nullable: true },
              baseUrl: { type: 'string', nullable: true },
              roleName: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token invalide.' })
  getProfile(@Req() req: Request) {
    const user = req.user as any;
    if (!user?.medecinId) throw new NotFoundException('Médecin introuvable');
    return {
      medecinId: user.medecinId,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      specialite: user.specialite ?? null,
      role: user.role ?? 'MEDECIN',
      chuId: user.chuId ?? null,
      chuNom: user.chuNom ?? null,
      chuLogoUrl: user.chuLogoUrl ?? null,
      otherServices: user.otherServices ?? [],
    };
  }
}
