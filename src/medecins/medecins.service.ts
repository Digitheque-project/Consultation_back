import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Variables validées au démarrage (voir config/assert-env.ts) : jamais de fallback codé en dur.
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL as string;
const AUTH_USER_SERVICE_URL = process.env.AUTH_USER_SERVICE_URL as string;
const CONSULTATION_EXTERNE_SERVICE_ID = process.env.CONSULTATION_EXTERNE_SERVICE_ID as string;
const SYNC_TTL_MS = 5 * 60 * 1000;

const MEDECIN_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  email: true,
  specialite: true,
  telephone: true,
  role: true,
} as const;

// medecin_cache sert uniquement à afficher la liste rapidement et à survivre
// aux coupures du service auth — ce n'est jamais une source de vérité : aucune
// relation/clé étrangère ne pointe dessus (voir Consultation/Planning, dont
// medecinId reste une simple chaîne externe, comme patientId). L'authentification
// (auth.service.ts) ne dépend pas de cette table non plus.
//
// La synchronisation utilise le token de la requête entrante elle-même — plus
// de login admin séparé (AUTH_ADMIN_EMAIL/PASSWORD) : vérifié empiriquement
// que GET /users et GET /roles côté service utilisateur acceptent n'importe
// quel token valide, sans filtrage par rôle. Ça élimine toute dépendance à un
// compte admin dont les identifiants peuvent changer (ex: lors d'un
// déploiement sur un nouveau serveur hospitalier) sans que ce service le sache.
@Injectable()
export class MedecinsService {
  private readonly logger = new Logger(MedecinsService.name);
  private lastSyncAt = 0;

  constructor(private prisma: PrismaService) {}

  private async syncFromAuthService(token?: string): Promise<void> {
    if (Date.now() - this.lastSyncAt < SYNC_TTL_MS) return;

    if (!token) {
      this.logger.warn('syncFromAuthService: aucun token fourni sur la requête, synchronisation ignorée');
      return;
    }

    try {
      const res = await fetch(
        // isActive doit être explicite : une valeur vide fait filtrer sur les
        // comptes INACTIFS côté service auth et renvoie une liste vide.
        `${AUTH_USER_SERVICE_URL}/users?search=&roleId=&serviceId=${CONSULTATION_EXTERNE_SERVICE_ID}&isActive=true&page=1&limit=200`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(35000) },
      );
      if (!res.ok) return;

      const data = await res.json();
      const users: Array<{ id: string; name: string; firstname?: string; email: string; job?: string; telephone?: string; serviceRoles?: Array<{ roleId: string }> }> =
        Array.isArray(data) ? data : (data.users ?? []);

      const rolesRes = await fetch(`${AUTH_SERVICE_URL}/roles`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const roles: Array<{ id: string; name: string }> = rolesRes.ok ? await rolesRes.json() : [];
      const adminRoleIds = new Set(roles.filter((r) => r.name?.toLowerCase() === 'admin').map((r) => r.id));

      for (const user of users) {
        if (!user.email) continue;
        const isAdmin = user.serviceRoles?.some((sr) => adminRoleIds.has(sr.roleId)) ?? false;
        const role = isAdmin ? 'ADMIN' : 'MEDECIN';
        const data = {
          nom: user.name ?? '',
          prenom: user.firstname ?? '',
          email: user.email,
          specialite: user.job ?? null,
          telephone: user.telephone ?? null,
          role,
        };

        await this.prisma.medecinCache.upsert({
          where: { id: user.id },
          update: data,
          create: { id: user.id, ...data },
        });
      }

      this.lastSyncAt = Date.now();
    } catch (err) {
      this.logger.error(`syncFromAuthService: ${err}`);
    }
  }

  async findAll(token?: string) {
    await this.syncFromAuthService(token);
    return this.prisma.medecinCache.findMany({
      where: { role: 'MEDECIN' },
      select: MEDECIN_SELECT,
      orderBy: { nom: 'asc' },
    });
  }

  async findOne(id: string, token?: string) {
    await this.syncFromAuthService(token);
    return this.prisma.medecinCache.findUnique({
      where: { id },
      select: MEDECIN_SELECT,
    });
  }
}
