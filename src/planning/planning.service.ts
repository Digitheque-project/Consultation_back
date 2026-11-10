import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Planning, Prisma } from '@prisma/client';
import { CreateRecurringPlanningDto } from './dto/create-recurring-planning.dto';
import { CreateUnavailabilityDto } from './dto/create-unavailability.dto';

// Variables validées au démarrage (voir config/assert-env.ts) : jamais de fallback codé en dur.
// Passe par la passerelle unique du CHU — voir GATEWAY_URL dans .env.example.
const GATEWAY_URL = process.env.GATEWAY_URL as string;
const FALLBACK_CHU_ID = process.env.CHU_ID as string;
const CLINICAL_SERVICES_CACHE_TTL_MS = 60_000;
const SERVICE_DOCTORS_CACHE_TTL_MS = 60_000;

type ClinicalService = { id: string; name: string };
type ServiceDoctor = { id: string; nom: string; prenom: string; email: string; specialite: string | null };

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);
  // Départements médicaux (registre service-service, type=CLINIQUE) pour la
  // "Vue par service" — jamais créés localement, toujours lus depuis ce registre.
  private clinicalServicesCacheByChu = new Map<string, { data: ClinicalService[]; fetchedAt: number }>();
  // Passthrough volontairement NON persisté en Postgres (contrairement à medecinCache,
  // spécifique à consultation-externe) : couvre des services arbitraires du CHU.
  private doctorsCacheByService = new Map<string, { data: ServiceDoctor[]; fetchedAt: number }>();

  constructor(private prisma: PrismaService) {}

  async getServices(chuId?: string, token?: string): Promise<ClinicalService[]> {
    const effectiveChuId = chuId || FALLBACK_CHU_ID;
    const cached = this.clinicalServicesCacheByChu.get(effectiveChuId);
    if (cached && Date.now() - cached.fetchedAt < CLINICAL_SERVICES_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await fetch(`${GATEWAY_URL}/services?chuId=${effectiveChuId}`, {
        signal: AbortSignal.timeout(15000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        return cached?.data ?? [];
      }

      const services: Array<{ id: string; name: string; type?: string; isActive?: boolean }> = await response.json();
      const data = services
        .filter((s) => s.type === 'CLINIQUE' && s.isActive !== false)
        .map((s) => ({ id: s.id, name: s.name }));
      this.clinicalServicesCacheByChu.set(effectiveChuId, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      this.logger.warn(`getServices: service-service injoignable — ${(err as Error).message}`);
      return cached?.data ?? [];
    }
  }

  async getServiceDoctors(serviceId: string, token?: string): Promise<ServiceDoctor[]> {
    const cached = this.doctorsCacheByService.get(serviceId);
    if (cached && Date.now() - cached.fetchedAt < SERVICE_DOCTORS_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${GATEWAY_URL}/users?search=&roleId=&serviceId=${serviceId}&isActive=true&page=1&limit=200`,
        { signal: AbortSignal.timeout(15000), headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      if (!response.ok) {
        return cached?.data ?? [];
      }

      const body = await response.json();
      const users: Array<{ id: string; name: string; firstname?: string; email: string; job?: string }> =
        Array.isArray(body) ? body : (body.users ?? []);
      const data = users.map((u) => ({ id: u.id, nom: u.name ?? '', prenom: u.firstname ?? '', email: u.email, specialite: u.job ?? null }));
      this.doctorsCacheByService.set(serviceId, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      this.logger.warn(`getServiceDoctors: user-service injoignable pour serviceId=${serviceId} — ${(err as Error).message}`);
      return cached?.data ?? [];
    }
  }

  private validateTimeRange(heureDebut: string, heureFin: string) {
    const [startHour, startMinute] = heureDebut.split(':').map(Number);
    const [endHour, endMinute] = heureFin.split(':').map(Number);

    const startTotal = startHour * 60 + startMinute;
    const endTotal = endHour * 60 + endMinute;

    if (startTotal >= endTotal) {
      throw new BadRequestException('La heure de fin doit être supérieure à l\'heure de début.');
    }
  }

  private validateQuota(quota: number | undefined) {
    if (typeof quota !== 'undefined' && quota < 1) {
      throw new BadRequestException('Le quota doit être au minimum de 1 patient.');
    }
  }

  private normalizeDate(date: string | Date): Date {
    const parsed = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('La date du créneau est invalide.');
    }
    return parsed;
  }

  // Un médecin ne peut pas avoir deux créneaux qui se recouvrent le même jour :
  // l'accueil en voyait deux sur la même heure, chacun avec son propre quota.
  // Les indisponibilités (disponible:false) ne sont pas concernées.
  private async assertSansChevauchement(
    medecinId: string,
    dates: Date[],
    heureDebut: string,
    heureFin: string,
    exclure: { id?: number; seriesId?: string } = {},
  ): Promise<void> {
    if (dates.length === 0) return;
    const jour = (d: Date) => d.toISOString().slice(0, 10);
    const jours = new Set(dates.map(jour));
    const debut = new Date(Math.min(...dates.map((d) => d.getTime())));
    const fin = new Date(Math.max(...dates.map((d) => d.getTime())) + 24 * 60 * 60 * 1000);
    const existants = await this.prisma.planning.findMany({
      where: {
        medecinId,
        disponible: true,
        date: { gte: debut, lt: fin },
        heureDebut: { lt: heureFin },
        heureFin: { gt: heureDebut },
        ...(exclure.id ? { id: { not: exclure.id } } : {}),
        ...(exclure.seriesId ? { NOT: { seriesId: exclure.seriesId } } : {}),
      },
      orderBy: { date: 'asc' },
    });
    const conflits = existants.filter((s) => jours.has(jour(s.date)));
    if (conflits.length > 0) {
      const detail = conflits
        .slice(0, 5)
        .map((s) => `${jour(s.date)} ${s.heureDebut}-${s.heureFin}`)
        .join(', ');
      throw new BadRequestException(
        `Ce créneau chevauche un créneau déjà planifié pour ce médecin (${detail}${conflits.length > 5 ? '…' : ''}).`,
      );
    }
  }

  // Défense en profondeur : le frontend bloque déjà l'édition des créneaux
  // passés (isPastSlotDate), mais rien n'empêchait un appel API direct.
  private isPastDate(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  }

  async create(data: Prisma.PlanningUncheckedCreateInput): Promise<Planning> {
    const preparedData = {
      ...data,
      date: this.normalizeDate(data.date),
    } as Prisma.PlanningUncheckedCreateInput;

    this.validateTimeRange(String(preparedData.heureDebut), String(preparedData.heureFin));
    this.validateQuota(Number(preparedData.quota));

    if (preparedData.disponible) {
      const unavailability = await this.prisma.planning.findFirst({
        where: {
          medecinId: String(preparedData.medecinId),
          date: preparedData.date,
          disponible: false,
        },
      });
      if (unavailability) {
        throw new BadRequestException(
          'Impossible de créer un créneau pour cette date : le médecin est indisponible.',
        );
      }
      await this.assertSansChevauchement(
        String(preparedData.medecinId),
        [preparedData.date as Date],
        String(preparedData.heureDebut),
        String(preparedData.heureFin),
      );
    }

    return this.prisma.planning.create({ data: preparedData });
  }

  async findAll(): Promise<Planning[]> {
    return this.prisma.planning.findMany({
      orderBy: {
        date: 'asc',
      },
    });
  }

  async findByMedecin(medecinId: string): Promise<Planning[]> {
    return this.prisma.planning.findMany({
      where: { medecinId },
      orderBy: {
        date: 'asc',
      },
    });
  }

  async findByDateRange(medecinId: string, startDate: Date, endDate: Date): Promise<Planning[]> {
    // Normaliser et valider les dates
    const normalizedStartDate = this.normalizeDate(startDate);
    const normalizedEndDate = this.normalizeDate(endDate);

    // Vérifier que startDate < endDate
    if (normalizedStartDate >= normalizedEndDate) {
      throw new BadRequestException('La date de fin doit être supérieure à la date de début.');
    }

    return this.prisma.planning.findMany({
      where: {
        medecinId,
        date: {
          gte: normalizedStartDate,
          lte: normalizedEndDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  async findOne(id: number): Promise<Planning | null> {
    return this.prisma.planning.findUnique({
      where: { id },
    });
  }

  async update(id: number, data: Prisma.PlanningUpdateInput): Promise<Planning> {
    const current = await this.prisma.planning.findUnique({ where: { id } });
    if (!current) {
      throw new BadRequestException('Créneau introuvable.');
    }
    if (this.isPastDate(current.date)) {
      throw new BadRequestException('Impossible de modifier un créneau passé.');
    }

    // La date arrive au format YYYY-MM-DD : Prisma exige une date complète et
    // répondait 500, si bien qu'aucune modification d'un créneau seul n'aboutissait.
    const date = data.date ? this.normalizeDate(data.date as string | Date) : undefined;
    if (date && this.isPastDate(date)) {
      throw new BadRequestException('Impossible de déplacer un créneau à une date passée.');
    }
    // Même règle qu'à la création : pas de créneau un jour d'indisponibilité.
    const disponible = typeof data.disponible === 'boolean' ? data.disponible : current.disponible;
    if (date && disponible) {
      const unavailability = await this.prisma.planning.findFirst({
        where: { id: { not: id }, medecinId: current.medecinId, date, disponible: false },
      });
      if (unavailability) {
        throw new BadRequestException(
          'Impossible de déplacer le créneau à cette date : le médecin est indisponible.',
        );
      }
    }

    if (data.heureDebut && data.heureFin) {
      this.validateTimeRange(String(data.heureDebut), String(data.heureFin));
    } else if (data.heureDebut && current.heureFin) {
      this.validateTimeRange(String(data.heureDebut), current.heureFin);
    } else if (data.heureFin && current.heureDebut) {
      this.validateTimeRange(current.heureDebut, String(data.heureFin));
    }

    if (typeof data.quota !== 'undefined') {
      this.validateQuota(Number(data.quota));
    }

    if (disponible && (date || data.heureDebut || data.heureFin)) {
      await this.assertSansChevauchement(
        current.medecinId,
        [date ?? current.date],
        String(data.heureDebut ?? current.heureDebut),
        String(data.heureFin ?? current.heureFin),
        { id },
      );
    }

    return this.prisma.planning.update({
      where: { id },
      data: date ? { ...data, date } : data,
    });
  }

  async remove(id: number): Promise<Planning> {
    const current = await this.prisma.planning.findUnique({ where: { id } });
    if (!current) {
      throw new BadRequestException('Créneau introuvable.');
    }
    if (this.isPastDate(current.date)) {
      throw new BadRequestException('Impossible de supprimer un créneau passé.');
    }

    return this.prisma.planning.delete({
      where: { id },
    });
  }

  async removeByMedecin(medecinId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.planning.deleteMany({
      where: { medecinId },
    });
  }

  // Dates d'une plage retenues selon les jours de la semaine demandés, en
  // écartant celles explicitement exclues. Partagé par la génération des
  // créneaux récurrents et celle des jours d'indisponibilité.
  private buildDateRange(start: Date, end: Date, daysOfWeek: number[], skipDates: Set<string>): Date[] {
    const dates: Date[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const isoDay = ((cursor.getDay() + 6) % 7) + 1; // 1=Lundi ... 7=Dimanche
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (daysOfWeek.includes(isoDay) && !skipDates.has(key)) {
        dates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  // Pas de moteur RRULE : chaque occurrence est générée comme une ligne
  // Planning indépendante, taguée du même seriesId. Annuler/modifier une
  // seule occurrence fonctionne alors avec remove()/update() existants,
  // sans aucun changement — seule la génération en masse est nouvelle ici.
  async createRecurring(dto: CreateRecurringPlanningDto & { medecinId: string }): Promise<{ seriesId: string; slots: Planning[] }> {
    this.validateTimeRange(dto.heureDebut, dto.heureFin);
    this.validateQuota(dto.quota);

    const start = this.normalizeDate(dto.startDate);
    const end = this.normalizeDate(dto.endDate);
    if (start > end) {
      throw new BadRequestException('La date de fin doit être postérieure à la date de début.');
    }

    const seriesId = randomUUID();
    const dates = this.buildDateRange(start, end, dto.daysOfWeek, new Set(dto.skipDates ?? []));

    if (dates.length === 0) {
      throw new BadRequestException('Aucune date ne correspond aux jours sélectionnés dans cette période.');
    }
    if (dates.length > 260) {
      throw new BadRequestException('Trop de créneaux générés (max 260) — réduisez la période.');
    }
    if (dto.disponible !== false) {
      await this.assertSansChevauchement(dto.medecinId, dates, dto.heureDebut, dto.heureFin);
    }

    const rows: Prisma.PlanningCreateManyInput[] = dates.map((date) => ({
      medecinId: dto.medecinId,
      date,
      heureDebut: dto.heureDebut,
      heureFin: dto.heureFin,
      quota: dto.quota,
      disponible: dto.disponible,
      notes: dto.notes,
      seriesId,
    }));

    await this.prisma.planning.createMany({ data: rows });
    const slots = await this.prisma.planning.findMany({ where: { seriesId }, orderBy: { date: 'asc' } });
    return { seriesId, slots };
  }

  // Créneaux disponibles déjà planifiés dans une période — sert à prévenir
  // l'admin avant d'enregistrer une indisponibilité, et à les supprimer s'il
  // choisit "remplacer".
  async findConflictingSlots(medecinId: string, startDate: string, endDate: string): Promise<Planning[]> {
    return this.prisma.planning.findMany({
      where: {
        medecinId,
        disponible: true,
        date: { gte: this.normalizeDate(startDate), lte: this.normalizeDate(endDate) },
      },
      orderBy: { date: 'asc' },
    });
  }

  // Une indisponibilité = un jour Planning par date de la plage, disponible:false,
  // journée entière (00:00-23:59) et sans quota. Aucune table dédiée : le
  // calendrier, la vue par service et l'édition par série marchent tels quels.
  async createUnavailability(
    dto: CreateUnavailabilityDto & { medecinId: string },
  ): Promise<{ seriesId: string; slots: Planning[]; deletedCount: number }> {
    const start = this.normalizeDate(dto.startDate);
    const end = this.normalizeDate(dto.endDate);
    if (start > end) {
      throw new BadRequestException('La date de fin doit être postérieure à la date de début.');
    }

    const dates = this.buildDateRange(start, end, [1, 2, 3, 4, 5, 6, 7], new Set());
    if (dates.length > 366) {
      throw new BadRequestException('Période trop longue (max 366 jours).');
    }

    const seriesId = randomUUID();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Suppression + création dans une transaction : jamais d'état intermédiaire
    // où les créneaux sont supprimés sans que l'absence soit enregistrée.
    return this.prisma.$transaction(async (tx) => {
      let deletedCount = 0;
      if (dto.conflictStrategy === 'replace') {
        // Les créneaux passés restent intouchables (même règle que remove()).
        const effectiveStart = today > start ? today : start;

        // Vérifier s'il y a des consultations dans cette période pour ce médecin
        const consultationsInPeriod = await tx.consultation.findFirst({
          where: {
            medecinId: dto.medecinId,
            date: { gte: effectiveStart, lte: end },
          },
        });

        if (consultationsInPeriod) {
          throw new BadRequestException(
            'Impossible de marquer cette période comme indisponible : des consultations sont déjà planifiées. Veuillez d\'abord transférer les patients à un autre médecin ou une autre date.',
          );
        }

        const deleted = await tx.planning.deleteMany({
          where: {
            medecinId: dto.medecinId,
            disponible: true,
            date: { gte: effectiveStart, lte: end },
          },
        });
        deletedCount = deleted.count;
      }

      await tx.planning.createMany({
        data: dates.map((date) => ({
          medecinId: dto.medecinId,
          date,
          heureDebut: '00:00',
          heureFin: '23:59',
          quota: 0,
          disponible: false,
          notes: dto.notes,
          seriesId,
        })),
      });

      const slots = await tx.planning.findMany({ where: { seriesId }, orderBy: { date: 'asc' } });
      return { seriesId, slots, deletedCount };
    });
  }

  async findOneBySeriesId(seriesId: string): Promise<Planning | null> {
    return this.prisma.planning.findFirst({ where: { seriesId } });
  }

  async updateSeriesFromDate(
    seriesId: string,
    fromDate: string,
    data: Prisma.PlanningUpdateManyMutationInput,
  ): Promise<{ count: number; slots: Planning[] }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = this.normalizeDate(fromDate);
    const effectiveFrom = from < today ? today : from; // ne touche jamais le passé, même si fromDate l'est

    if (data.heureDebut && data.heureFin) {
      this.validateTimeRange(String(data.heureDebut), String(data.heureFin));
    }
    if (typeof data.quota !== 'undefined') {
      this.validateQuota(Number(data.quota));
    }

    // Nouvelles heures : elles ne doivent recouvrir aucun autre créneau du médecin.
    if (data.heureDebut || data.heureFin) {
      const occurrences = await this.prisma.planning.findMany({
        where: { seriesId, date: { gte: effectiveFrom }, disponible: true },
      });
      if (occurrences.length > 0) {
        await this.assertSansChevauchement(
          occurrences[0].medecinId,
          occurrences.map((o) => o.date),
          String(data.heureDebut ?? occurrences[0].heureDebut),
          String(data.heureFin ?? occurrences[0].heureFin),
          { seriesId },
        );
      }
    }

    await this.prisma.planning.updateMany({
      where: { seriesId, date: { gte: effectiveFrom } },
      data,
    });
    const slots = await this.prisma.planning.findMany({
      where: { seriesId, date: { gte: effectiveFrom } },
      orderBy: { date: 'asc' },
    });
    return { count: slots.length, slots };
  }
}
