import { Injectable, Logger } from '@nestjs/common';

// GATEWAY_URL est obligatoire au démarrage (voir config/assert-env.ts) — le
// contrôle ci-dessous est un filet de sécurité TypeScript, jamais atteint en
// pratique.
const GATEWAY_URL = process.env.GATEWAY_URL;
// Route @Public() côté nous (voir notification.controller.ts) : aucun JWT
// médecin en scope ici, donc le token de service partagé, requis par la
// passerelle sur /notifications (requiresAuth).
const SERVICE_API_TOKEN = process.env.SERVICE_API_TOKEN as string;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async getUserNotifications(userId: string): Promise<unknown[]> {
    if (!GATEWAY_URL) {
      this.logger.warn('GATEWAY_URL non configurée — historique des notifications indisponible.');
      return [];
    }

    try {
      const response = await fetch(`${GATEWAY_URL}/notifications/user/${encodeURIComponent(userId)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${SERVICE_API_TOKEN}` },
      });
      if (!response.ok) return [];
      return response.json();
    } catch (err) {
      this.logger.warn(`Notification injoignable (${(err as Error).message}) — historique retourné vide.`);
      return [];
    }
  }
}
