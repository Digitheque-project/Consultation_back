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
