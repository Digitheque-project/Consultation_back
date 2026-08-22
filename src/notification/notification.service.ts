import { Injectable, Logger } from '@nestjs/common';

// Optionnelle comme PHARMACIE_URL/PRESCRIPTION_URL : son absence ne doit
// jamais empêcher le backend de démarrer.
const NOTIFICATION_URL = process.env.NOTIFICATION_URL;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async getUserNotifications(userId: string): Promise<unknown[]> {
    if (!NOTIFICATION_URL) {
      this.logger.warn('NOTIFICATION_URL non configurée — historique des notifications indisponible.');
      return [];
    }

    try {
      const response = await fetch(`${NOTIFICATION_URL}/notifications/user/${encodeURIComponent(userId)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return [];
      return response.json();
    } catch (err) {
      this.logger.warn(`Notification injoignable (${(err as Error).message}) — historique retourné vide.`);
      return [];
    }
  }
}
