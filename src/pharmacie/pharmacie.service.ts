import { Injectable, Logger } from '@nestjs/common';

// Variable validée au démarrage optionnelle (voir pharmacie.controller.ts) :
// contrairement aux autres services externes, l'absence de PHARMACIE_URL ne
// doit pas empêcher le backend de démarrer — le catalogue pharmacie reste une
// fonctionnalité dégradable (le frontend traite déjà une liste vide comme
// "indisponible", jamais comme une erreur bloquante).
const PHARMACIE_URL = process.env.PHARMACIE_URL;

@Injectable()
export class PharmacieService {
  private readonly logger = new Logger(PharmacieService.name);

  /**
   * Relais serveur-à-serveur vers le catalogue pharmacie (stock + prix).
   *
   * Pourquoi ce relais et pas un appel direct du navigateur : le backend
   * pharmacie ne renvoie aucun en-tête CORS (Access-Control-Allow-Origin
   * absent, confirmé), donc tout appel direct depuis le frontend est bloqué
   * silencieusement par le navigateur — pas par le réseau. Un appel
   * serveur-à-serveur (nous → pharmacie) n'est lui jamais soumis à CORS,
   * qui est une politique appliquée uniquement par les navigateurs.
   *
   * Bénéfice secondaire : le frontend n'a plus besoin de connaître l'URL du
   * service pharmacie du tout — un appel de plus consolidé derrière notre
   * propre API (elle-même déjà accessible via la passerelle du CHU).
   */
  async getArticlesStockSalePrices(chuId?: string): Promise<unknown[]> {
    if (!PHARMACIE_URL) {
      this.logger.warn('PHARMACIE_URL non configurée — catalogue pharmacie indisponible.');
      return [];
    }

    const params = new URLSearchParams({ level: 'DETAIL' });
    if (chuId) params.set('chuId', chuId);

    try {
      const response = await fetch(`${PHARMACIE_URL}/articles/stock-sale-prices?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.warn(`Pharmacie a répondu ${response.status} — catalogue retourné vide.`);
        return [];
      }

      return response.json();
    } catch (err) {
      // Dégradable, jamais bloquant : un médecin doit pouvoir continuer sa
      // prescription même si le service pharmacie est indisponible.
      this.logger.warn(`Pharmacie injoignable (${(err as Error).message}) — catalogue retourné vide.`);
      return [];
    }
  }
}
