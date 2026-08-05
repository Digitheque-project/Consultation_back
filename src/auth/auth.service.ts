import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

// Variables validées au démarrage (voir config/assert-env.ts) : jamais de fallback codé en dur.
const AUTH_USER_SERVICE_URL = process.env.AUTH_USER_SERVICE_URL as string;
const CONSULTATION_EXTERNE_SERVICE_ID = process.env.CONSULTATION_EXTERNE_SERVICE_ID as string;
// Permet au personnel d'accueil (token perso, jamais un compte admin ou un
// secret partagé) de gérer le planning des médecins — ils orchestrent
// réellement le planning de tous les services dans le parcours CHU. Un
// médecin d'un AUTRE service (Pédiatrie, EEG...) n'a lui aucune entrée pour
// ACCUEIL_SERVICE_ID et reste donc limité à son propre planning.
const ACCUEIL_SERVICE_ID = process.env.ACCUEIL_SERVICE_ID as string;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type OtherService = {
  serviceId: string;
  serviceName?: string;
  baseUrl?: string;
  roleName?: string;
};

export type ValidatedUser = {
  userId: string;
  medecinId: string;
  email: string;
  nom: string;
  prenom: string;
  specialite?: string;
  role: string;
  chuId?: string;
  chuNom?: string;
  chuLogoUrl?: string;
  otherServices: OtherService[];
};

// Le token (ou, à défaut, l'appel réseau au service utilisateur) reste la
// seule source de vérité pour l'authentification — jamais une lecture depuis
// medecin_cache. On y écrit seulement, en fire-and-forget, à chaque connexion
// réussie : ça alimente le cache d'affichage sans dépendre uniquement du sync
// périodique en masse, et un échec d'écriture ne bloque jamais l'authentification.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cache = new Map<string, { user: ValidatedUser; expiry: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private cacheMedecin(user: ValidatedUser): void {
    this.prisma.medecinCache
      .upsert({
        where: { id: user.medecinId },
        update: {
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          specialite: user.specialite ?? null,
          role: user.role,
        },
        create: {
          id: user.medecinId,
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          specialite: user.specialite ?? null,
          role: user.role,
        },
      })
      .catch((err) => this.logger.warn(`cacheMedecin: ${(err as Error).message}`));
  }

  private decodeJwtPayload(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
      return JSON.parse(Buffer.from(padded, 'base64url').toString('utf-8'));
    } catch {
      return null;
    }
  }

  // Entrée "services[]" pertinente pour ce backend : celle de consultation-externe
  // pour un médecin, ou à défaut celle d'Accueil pour un agent d'accueil (qui n'a
  // jamais d'entrée consultation-externe dans son token — il gère le planning de
  // TOUS les médecins sans y être lui-même affecté).
  private findOurServiceEntry(
    payload: Record<string, any>,
  ): { serviceId: string; roleName?: string; chu?: { id: string; name?: string; logoUrl?: string } } | undefined {
    const services: Array<{ serviceId: string; roleName?: string; chu?: any }> = payload.services ?? [];
    return (
      services.find((s) => s.serviceId === CONSULTATION_EXTERNE_SERVICE_ID) ??
      services.find((s) => s.serviceId === ACCUEIL_SERVICE_ID)
    );
  }

  private resolveRole(payload: Record<string, any>): string {
    const services: Array<{ serviceId: string }> = payload.services ?? [];
    // Le personnel d'accueil orchestre le planning de tous les médecins — rôle
    // SERVICE (déjà autorisé partout où ADMIN l'est), jamais besoin de leur
    // accorder un rôle admin dédié à consultation-externe.
    if (services.some((s) => s.serviceId === ACCUEIL_SERVICE_ID)) {
      return 'SERVICE';
    }
    const ourService = services.find((s: any) => s.serviceId === CONSULTATION_EXTERNE_SERVICE_ID) as
      | { roleName?: string }
      | undefined;
    return ourService?.roleName?.toLowerCase() === 'admin' ? 'ADMIN' : 'MEDECIN';
  }

  private resolveChuId(payload: Record<string, any>): string | undefined {
    return this.findOurServiceEntry(payload)?.chu?.id ?? payload.chuId ?? undefined;
  }

  // Nom + logo du CHU tels que fournis par le token — jamais figés en dur, le
  // logo peut changer (cf. service-upload) donc on relit le token à chaque fois.
  private resolveChuInfo(payload: Record<string, any>): { chuNom?: string; chuLogoUrl?: string } {
    const ourService = this.findOurServiceEntry(payload);
    return {
      chuNom: ourService?.chu?.name ?? payload.chuNom ?? undefined,
      chuLogoUrl: ourService?.chu?.logoUrl ?? payload.chuLogoUrl ?? undefined,
    };
  }

  // Les autres services (cliniques, etc.) où ce médecin a aussi un rôle — sert
  // au changement de service depuis le front, sans repasser par une connexion.
  // Seuls les services avec un baseUrl connu sont exploitables pour une redirection.
  private resolveOtherServices(payload: Record<string, any>): OtherService[] {
    const services: Array<{ serviceId: string; serviceName?: string; baseUrl?: string; roleName?: string }> =
      payload.services ?? [];
    return services
      .filter((s) => s.serviceId !== CONSULTATION_EXTERNE_SERVICE_ID && s.serviceId !== ACCUEIL_SERVICE_ID && s.baseUrl)
      .map((s) => ({ serviceId: s.serviceId, serviceName: s.serviceName, baseUrl: s.baseUrl, roleName: s.roleName }));
  }

  private buildValidatedUser(payload: Record<string, any>, specialite?: string): ValidatedUser | null {
    const userId = payload.userId;
    if (!userId) return null;
    const user: ValidatedUser = {
      userId,
      medecinId: userId,
      email: payload.email ?? '',
      nom: payload.name ?? 'Médecin',
      prenom: payload.firstname ?? '',
      specialite: payload.job ?? specialite ?? undefined,
      role: this.resolveRole(payload),
      chuId: this.resolveChuId(payload),
      ...this.resolveChuInfo(payload),
      otherServices: this.resolveOtherServices(payload),
    };
    this.cacheMedecin(user);
    return user;
  }

  async validateToken(token: string): Promise<ValidatedUser | null> {
    const cached = this.cache.get(token);
    if (cached && cached.expiry > Date.now()) return cached.user;

    // Chemin rapide : vérification locale avec JWT_SECRET (pas d'appel réseau)
    try {
      const payload = this.jwtService.verify<Record<string, any>>(token);
      // Supporte les deux formats : { userId } (service auth externe) et { sub } (ancien format)
      const normalizedPayload = { ...payload, userId: payload.userId ?? String(payload.sub) };
      if (normalizedPayload.userId && normalizedPayload.userId !== 'undefined') {
        const user = this.buildValidatedUser(normalizedPayload);
        if (user) {
          this.cache.set(token, { user, expiry: Date.now() + CACHE_TTL_MS });
          return user;
        }
      }
    } catch {
      // JWT_SECRET incorrect ou non configuré — on tente le service auth
    }

    // Décoder le payload sans vérifier la signature (pour l'expiry et le userId)
    const decoded = this.decodeJwtPayload(token);
    // Supporte { userId } et { sub }
    if (decoded && !decoded.userId && decoded.sub) decoded.userId = String(decoded.sub);
    if (!decoded?.userId || !decoded?.exp) return null;
    if (decoded.exp * 1000 < Date.now()) return null; // JWT vraiment expiré → refus ferme

    // Fallback réseau : valider via le service utilisateur CHU
    try {
      const response = await fetch(`${AUTH_USER_SERVICE_URL}/users/${decoded.userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(35000), // 35s pour survivre aux cold starts Render
      });
      if (!response.ok) {
        this.logger.warn(`User service rejected token for userId=${decoded.userId}: HTTP ${response.status}`);
        // Service auth a répondu mais rejette le token → invalide (ne pas utiliser le cache)
        return null;
      }

      const userInfo: { job?: string } = await response.json().catch(() => ({}));
      const user = this.buildValidatedUser(decoded, userInfo.job ?? undefined);
      if (!user) return null;

      this.cache.set(token, { user, expiry: Date.now() + CACHE_TTL_MS });
      return user;
    } catch (err) {
      // Erreur réseau / timeout : service auth injoignable (cold start Render, réseau, etc.)
      this.logger.warn(`Auth service unreachable (${(err as Error).message}) — fallback cache pour userId=${decoded.userId}`);

      // Cache expiré mais JWT encore valide → réutiliser (stale-while-revalidate).
      // Pas de filet de secours en base de données : accepté en échange de la
      // suppression de toute copie locale des données médecin.
      if (cached) {
        this.logger.warn(`Réutilisation du cache expiré pour userId=${cached.user.userId}`);
        this.cache.set(token, { user: cached.user, expiry: Date.now() + CACHE_TTL_MS });
        return cached.user;
      }

      return null;
    }
  }
}
