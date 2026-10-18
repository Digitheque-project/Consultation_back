import * as jwt from 'jsonwebtoken';

// Appels serveur-à-serveur sans médecin connecté (notifications du service,
// historique...) : un JWT de très courte durée signé avec le JWT_SECRET déjà
// partagé par tous les services du CHU, reconnu par la passerelle comme par
// les autres backends. Remplace l'ancien secret statique SERVICE_API_TOKEN,
// qu'il fallait recopier à l'identique dans chaque service.
export const SERVICE_ROLE = 'SERVICE';

export function signServiceToken(): string {
  return jwt.sign({ userId: 'service-consultation-externe', role: SERVICE_ROLE }, process.env.JWT_SECRET as string, {
    expiresIn: '2m',
  });
}

export function serviceAuthorization(): string {
  return `Bearer ${signServiceToken()}`;
}
