import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('app')
@Controller()
export class AppController {
  /** Doit rester inférieur au --timeout du HEALTHCHECK Docker (10 s). */
  private static readonly HEALTH_TIMEOUT_MS = 5000;

  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sonde de santé sans authentification : indispensable pour le HEALTHCHECK
   * Docker et la supervision du réseau local du CHU, qui n'ont pas de token à
   * présenter. Vérifie aussi la base — un conteneur qui répond mais dont la
   * base est injoignable doit être signalé comme dégradé, pas comme sain.
   */
  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Sonde de santé (sans authentification)',
    description: 'Retourne 200 si le service et sa base de données répondent, 503 sinon. Destiné au HEALTHCHECK Docker et à la supervision.',
  })
  @ApiResponse({ status: 200, description: 'Service et base de données opérationnels' })
  @ApiResponse({ status: 503, description: 'Base de données injoignable' })
  async health() {
    try {
      // Délai borné : quand la base est injoignable, Prisma attend son propre
      // délai de connexion (mesuré à plus de 90 s en production). Une sonde qui
      // pend au lieu de répondre 503 est inexploitable — la supervision ne
      // distingue plus « base morte » de « service figé », et le diagnostic à
      // distance redevient impossible.
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Délai de la sonde dépassé')), AppController.HEALTH_TIMEOUT_MS),
        ),
      ]);
      return { status: 'ok', database: 'up' };
    } catch {
      // Exception, pas un simple objet : un "statusCode" dans le corps
      // laisserait le HTTP à 200 et l'orchestrateur croirait le service sain
      // alors que sa base est injoignable.
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
  }

  /**
   * Identité de ce déploiement, résolue dynamiquement au démarrage (voir
   * config/resolve-identity.ts) — exposée pour que le frontend n'ait plus
   * besoin de sa propre copie figée en NEXT_PUBLIC_CONSULTATION_EXTERNE_SERVICE_ID
   * (même donnée dupliquée dans deux dépôts, même risque de désynchronisation
   * qu'une URL codée en dur). Sans authentification : ce ne sont pas des
   * données sensibles, juste l'identité publique de ce service dans le
   * registre du CHU (déjà visible via GET /services sur la passerelle).
   */
  @Public()
  @Get('identity')
  @ApiOperation({
    summary: 'Identité de ce déploiement (sans authentification)',
    description:
      "CHU_ID et CONSULTATION_EXTERNE_SERVICE_ID tels que résolus au démarrage depuis le registre service-service de la passerelle.",
  })
  @ApiResponse({ status: 200, description: 'Identité résolue' })
  getIdentity() {
    return {
      chuId: process.env.CHU_ID,
      consultationExterneServiceId: process.env.CONSULTATION_EXTERNE_SERVICE_ID,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Point d\'entrée de l\'API',
    description: 'Retourne un message de bienvenue pour l\'API du CHU Andrainjato Fianarantsoa'
  })
  @ApiResponse({
    status: 200,
    description: 'Message de bienvenue',
    schema: {
      type: 'string',
      example: 'Bienvenue sur l\'API du CHU Andrainjato Fianarantsoa'
    }
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
