import { Injectable, Logger } from '@nestjs/common';

// GATEWAY_URL est obligatoire au démarrage (voir config/assert-env.ts) — le
// contrôle ci-dessous est un filet de sécurité TypeScript, jamais atteint en
// pratique. Passe par la passerelle (requiresAuth sur /pharmacie, /articles),
// donc transmet toujours le JWT du médecin connecté (voir controller).
const GATEWAY_URL = process.env.GATEWAY_URL;

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
  async getArticlesStockSalePrices(chuId?: string, token?: string): Promise<unknown[]> {
    if (!GATEWAY_URL) {
      this.logger.warn('GATEWAY_URL non configurée — catalogue pharmacie indisponible.');
      return [];
    }

    const params = new URLSearchParams({ level: 'DETAIL' });
    if (chuId) params.set('chuId', chuId);

    try {
      const response = await fetch(`${GATEWAY_URL}/articles/stock-sale-prices?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
