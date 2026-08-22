import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

// Optionnelle comme PHARMACIE_URL (voir pharmacie.service.ts) : son absence
// ne doit jamais empêcher le backend de démarrer.
const PRESCRIPTION_URL = process.env.PRESCRIPTION_URL;

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);

  /**
   * Relais transparent (reverse proxy) serveur-à-serveur vers le service
   * prescription — 21 endpoints différents (services, prescriptions par
   * type paraclinique, ordonnance, historique...), tous avec la même forme :
   * méthode, chemin, requête et corps transmis tels quels, réponse (statut +
   * JSON) retournée telle quelle. Un seul relais générique plutôt que 21
   * méthodes qui dupliqueraient chacune le contrat de l'API amont — rien à
   * maintenir en double si le service prescription ajoute une route.
   *
   * Même raison que pour la pharmacie : le service prescription passe par la
   * passerelle du CHU en 404 (bug de préfixe, ses routes ne portent aucun
   * segment "/prescriptions" en interne pour la plupart), donc un appel
   * direct depuis le navigateur reste la seule alternative — sauf qu'ici on
   * profite de l'occasion pour consolider une variable d'environnement de
   * plus derrière notre propre API.
   */
  async forward(req: Request, res: Response): Promise<void> {
    if (!PRESCRIPTION_URL) {
      res.status(503).json({ statusCode: 503, message: 'Service prescription non configuré.' });
      return;
    }

    const rawPath = req.params.path;
    const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath ?? '');
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    const url = `${PRESCRIPTION_URL.replace(/\/+$/, '')}/${path}${query}`;

    const headers: Record<string, string> = {};
    const contentType = req.headers['content-type'];
    if (contentType) headers['Content-Type'] = String(contentType);
    const authorization = req.headers['authorization'];
    if (authorization) headers['Authorization'] = String(authorization);

    const hasBody = !['GET', 'HEAD'].includes(req.method);

    try {
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(20000),
      });

      const text = await upstream.text();
      const upstreamContentType = upstream.headers.get('content-type');
      if (upstreamContentType) res.setHeader('Content-Type', upstreamContentType);
      res.status(upstream.status).send(text);
    } catch (err) {
      this.logger.warn(`Prescription injoignable (${(err as Error).message}) — relais de ${req.method} ${path}.`);
      res.status(502).json({ statusCode: 502, message: 'Service prescription injoignable.' });
    }
  }
}
