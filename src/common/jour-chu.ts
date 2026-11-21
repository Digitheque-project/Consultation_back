/**
 * Jour calendaire de l'hôpital (« AAAA-MM-JJ »), à l'heure du CHU.
 *
 * Le serveur tourne en UTC : `new Date().toISOString().split('T')[0]` y donne
 * encore la veille entre minuit et 3 h à Madagascar (UTC+3). Le fuseau vient
 * de CHU_TIMEZONE (docker-compose : CHU_FUSEAU_HORAIRE).
 */
export function jourDuChu(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', {
    timeZone: process.env.CHU_TIMEZONE || 'Indian/Antananarivo',
  });
}
