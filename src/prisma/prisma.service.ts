import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    // Volontairement non bloquant : une erreur ici remonterait jusqu'à
    // NestFactory et tuerait le processus AVANT que le serveur HTTP n'écoute.
    // Conséquence observée en production : base injoignable au démarrage =
    // service totalement mort (même /health inaccessible), impossible à
    // diagnostiquer à distance, et aucun redémarrage ne le répare tant que la
    // base n'est pas revenue.
    //
    // On démarre donc en mode dégradé : le serveur écoute, /health répond 503
    // (l'orchestrateur voit "unhealthy" et peut agir), et Prisma se reconnecte
    // tout seul au premier appel réussi — pas besoin de redéployer.
    try {
      await this.$connect();
      this.logger.log('Connexion à la base de données établie.');
    } catch (err) {
      this.logger.error(
        `Base de données injoignable au démarrage (${(err as Error).message}). ` +
          'Le service démarre en mode dégradé : /health renverra 503 tant que la ' +
          'base ne répond pas. La reconnexion est automatique.',
      );
    }
  }

  async onModuleDestroy() {
    // Ne jamais faire échouer l'arrêt : si la connexion n'a jamais été établie,
    // $disconnect peut lever et masquer la vraie cause de l'arrêt.
    await this.$disconnect().catch(() => undefined);
  }
}
