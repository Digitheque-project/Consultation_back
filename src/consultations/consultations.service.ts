import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CreateControleExterneDto } from './dto/create-controle-externe.dto';

// Variables validées au démarrage (voir config/assert-env.ts) : jamais de fallback
// codé en dur ici — une URL obsolète silencieuse a déjà causé une perte de données.
// Accueil, clinique, CHU et services (registre) passent tous par la passerelle
// unique du CHU — une seule variable au lieu d'une par service (cf. GATEWAY_URL).
const GATEWAY_URL = process.env.GATEWAY_URL as string;
const NOTIFICATION_URL = process.env.NOTIFICATION_URL as string;
const CONSULTATION_EXTERNE_SERVICE_ID = process.env.CONSULTATION_EXTERNE_SERVICE_ID as string;
// Filet de secours pour les appels sans chuId dans le token (rôle SERVICE, tâches internes).
// En usage normal, le chuId vient du JWT de l'utilisateur connecté — jamais d'une valeur figée.
const FALLBACK_CHU_ID = process.env.CHU_ID as string;
const PATIENTS_CACHE_TTL_MS = 5000;
const CLINICAL_SERVICES_CACHE_TTL_MS = 60_000;

type ClinicalService = { id: string; name: string };

type AccueilPatient = {
  id: string;
  nom: string;
  prenom: string;
  sexe?: string;
  dateNaissance?: string;
  cin?: string | null;
  profession?: string | null;
  adresse?: string;
  telephone?: string;
  contactUrgence?: string | null;
  priseEnChargeId?: string | null;
};

type PriseEnCharge = {
  id: string;
  companyName: string;
  isActive: boolean;
};

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(private prisma: PrismaService) {}

  private readonly consultationEvents = new Subject<{ type: string; consultationId: number }>();
  readonly consultationEvents$ = this.consultationEvents.asObservable();

  // Un cache par chuId : le service est multi-CHU, chaque tenant a sa propre liste de patients.
  private patientsCacheByChu = new Map<string, { data: Map<string, AccueilPatient>; fetchedAt: number }>();

  private async fetchPatientsMap(chuId?: string, token?: string): Promise<Map<string, AccueilPatient>> {
    const effectiveChuId = chuId || FALLBACK_CHU_ID;
    const cached = this.patientsCacheByChu.get(effectiveChuId);
    if (cached && Date.now() - cached.fetchedAt < PATIENTS_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      // Le service accueil exige désormais le JWT du médecin connecté (même token
      // partagé que celui accepté par le service prescription).
      const response = await fetch(`${GATEWAY_URL}/accueil/patients?chuId=${effectiveChuId}`, {
        signal: AbortSignal.timeout(8000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        return cached?.data ?? new Map();
      }

      const patients: AccueilPatient[] = await response.json();
      const data = new Map(patients.map((patient) => [patient.id, patient]));
      this.patientsCacheByChu.set(effectiveChuId, { data, fetchedAt: Date.now() });
      return data;
    } catch {
      return cached?.data ?? new Map();
    }
  }

  // Un cache par chuId : chaque tenant a ses propres entreprises partenaires.
  private priseEnChargeCacheByChu = new Map<string, { data: Map<string, PriseEnCharge>; fetchedAt: number }>();

  private async fetchPriseEnChargeMap(chuId?: string, token?: string): Promise<Map<string, PriseEnCharge>> {
    const effectiveChuId = chuId || FALLBACK_CHU_ID;
    const cached = this.priseEnChargeCacheByChu.get(effectiveChuId);
    if (cached && Date.now() - cached.fetchedAt < PATIENTS_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await fetch(`${GATEWAY_URL}/prise-en-charge`, {
        signal: AbortSignal.timeout(8000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        return cached?.data ?? new Map();
      }

      const entries: PriseEnCharge[] = await response.json();
      const data = new Map(entries.map((entry) => [entry.id, entry]));
      this.priseEnChargeCacheByChu.set(effectiveChuId, { data, fetchedAt: Date.now() });
      return data;
    } catch {
      return cached?.data ?? new Map();
    }
  }

  // Un cache par chuId : liste des services cliniques (registre service-service), utilisée
  // pour le choix d'hospitalisation. Aucune valeur figée ici — un service créé/désactivé
  // dans le registre doit apparaître/disparaître automatiquement de notre liste.
  private clinicalServicesCacheByChu = new Map<string, { data: ClinicalService[]; fetchedAt: number }>();

  private async fetchClinicalServices(chuId?: string, token?: string): Promise<ClinicalService[]> {
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
      this.logger.warn(`fetchClinicalServices: service-service injoignable — ${(err as Error).message}`);
      return cached?.data ?? [];
    }
  }

  async getHospitalisationServices(chuId?: string, token?: string): Promise<ClinicalService[]> {
    return this.fetchClinicalServices(chuId, token);
  }

  private enrichPatient<T extends { patientId: string }>(
    record: T,
    patientsMap: Map<string, AccueilPatient>,
    pecMap: Map<string, PriseEnCharge> = new Map(),
  ) {
    const patient = patientsMap.get(record.patientId);
    // Ne jamais exposer le patientId brut comme nom : un patient introuvable
    // (ancien CHU, désync accueil) doit rester anonyme côté UI. Mais un patient
    // trouvé sans prénom enregistré ne doit pas afficher "Patient" en guise de
    // prénom — juste son nom seul.
    const prenom = patient ? (patient.prenom ?? '') : 'Patient';
    const nom = patient?.nom ?? 'introuvable';
    const pec = patient?.priseEnChargeId ? pecMap.get(patient.priseEnChargeId) : undefined;

    return {
      ...record,
      patient: {
        id: record.patientId,
        prenom,
        nom,
        displayName: `${prenom} ${nom}`.trim(),
        dossier: record.patientId,
        sexe: patient?.sexe ?? null,
        dateNaissance: patient?.dateNaissance ?? null,
        cin: patient?.cin ?? null,
        telephone: patient?.telephone ?? null,
        adresse: patient?.adresse ?? null,
        profession: patient?.profession ?? null,
        contactUrgence: patient?.contactUrgence ?? null,
        priseEnChargeId: patient?.priseEnChargeId ?? null,
        priseEnCharge: pec ? { id: pec.id, companyName: pec.companyName, isActive: pec.isActive } : null,
      },
    };
  }

  private getControlLabel(ordreControle?: number | null) {
    if (!ordreControle || ordreControle <= 1) {
      return '1er contrôle';
    }

    const suffixes = ['er', 'e', 'e', 'e'];
    const suffix = suffixes[Math.min(ordreControle - 1, suffixes.length - 1)] ?? 'e';
    return `${ordreControle}${suffix} contrôle`;
  }

  private async createControlFollowUp(consultation: any, medecinId: string | undefined, data: any) {
    const followUpDate = data?.rdvDate ? new Date(data.rdvDate) : null;
    if (!followUpDate) {
      return null;
    }

    const nextOrder = (consultation.ordreControle ?? 0) + 1;
    const followUp = await this.prisma.consultation.create({
      data: {
        patientId: consultation.patientId,
        medecinId: medecinId ?? consultation.medecinId,
        date: followUpDate,
        heure: consultation.heure,
        statut: 'EN_ATTENTE_CONTROLE',
        termine: false,
        typeVisite: 'CONTROLE',
        ordreControle: nextOrder,
        consultationParenteId: consultation.id,
        motif: data?.rdvMotif ?? `Contrôle ${this.getControlLabel(nextOrder)}`,
        urgence: consultation.urgence,
      },
    });

    return followUp;
  }

  private async registerNonMedicalAction(consultationId: number, data: any) {
    await this.prisma.prescriptionNonMedicamenteuse.deleteMany({ where: { consultationId } });

    return this.prisma.prescriptionNonMedicamenteuse.create({
      data: {
        consultationId,
        recommandationsNotes: data?.notes ?? null,
        rdvMotif: data?.rdvMotif ?? null,
        rdvNiveau: data?.rdvNiveau ?? null,
        rdvDate: data?.rdvDate ? new Date(data.rdvDate) : null,
        examenService: data?.examenService ?? null,
        examenType: data?.examenType ?? null,
        examenMotif: data?.examenMotif ?? null,
        examenPriorite: data?.examenPriorite ?? 'NORMALE',
        hospitalisationMotif: data?.hospitalisationMotif ?? null,
        hospitalisationService: data?.hospitalisationService ?? null,
        hospitalisationStatus: data?.hospitalisationStatus ?? 'EN_ATTENTE',
      },
    });
  }

  // Le token porte déjà les rôles/services du médecin (posés par le service auth) —
  // pas besoin de vérifier la signature ici, JwtGuard l'a déjà fait plus haut dans la
  // requête. On ne fait que relire la revendication "services" pour savoir à quels
  // services le médecin appartient.
  private decodeJwtServiceIds(token?: string): Set<string> {
    if (!token) return new Set();
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return new Set();
      const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(padded, 'base64url').toString('utf-8'));
      const services: Array<{ serviceId?: string }> = Array.isArray(payload.services) ? payload.services : [];
      return new Set(services.map((s) => s.serviceId).filter((sid): sid is string => Boolean(sid)));
    } catch {
      return new Set();
    }
  }

  // Si le médecin appartient lui-même au service d'hospitalisation destinataire (un
  // rôle dans ce service, présent dans son token), sa décision vaut admission directe.
  // Sinon, il ne peut pas créer l'épisode dans un service qui n'est pas le sien —
  // clinique-back refuse d'ailleurs ce cas avec un 403 ("Aucun CHU associé au service
  // ... dans le token") — donc on crée une demande que ce service devra valider.
  // Best-effort dans les deux cas : une erreur ici ne doit jamais bloquer la
  // consultation externe (elle reste enregistrée localement même si clinique-back est
  // injoignable). Partagé entre la confirmation instantanée ('hospitalisation') et la
  // finalisation de consultation, pour ne créer l'épisode/la demande qu'une seule fois
  // quel que soit le chemin emprunté par le médecin.
  private async admitOrRequestHospitalisation(
    consultation: any,
    hospitalisationService: string,
    motifAdmission: string,
    medecinId: string | undefined,
    token?: string,
    chuId?: string,
  ): Promise<'VALIDE' | 'EN_ATTENTE'> {
    const clinicalServices = await this.fetchClinicalServices(chuId, token);
    const normalized = hospitalisationService.trim().toLowerCase();
    const service = clinicalServices.find((s) => s.name.trim().toLowerCase() === normalized);
    const serviceId = service?.id;
    if (!serviceId) {
      this.logger.warn(`admitOrRequestHospitalisation: service "${hospitalisationService}" introuvable dans le registre (CLINIQUE, chuId=${chuId ?? FALLBACK_CHU_ID}) — aucune action effectuée.`);
      return 'EN_ATTENTE';
    }

    const createdBy = medecinId ?? consultation.medecinId;
    const callerServiceIds = this.decodeJwtServiceIds(token);

    if (callerServiceIds.has(serviceId)) {
      try {
        const response = await fetch(`${GATEWAY_URL}/clinique/hospitalisations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          // Champ renommé côté clinique-back (serviceId -> serviceIdDest) — confirmé
          // en comparant leur Swagger en direct après des épisodes silencieusement
          // rejetés (400 "property serviceId should not exist"). chuId manquait ici
          // (present sur la branche "demande" juste en dessous, oublié sur celle-ci) —
          // trouvé via un vrai test de bout en bout, clinique-back le rend obligatoire.
          body: JSON.stringify({ patientId: consultation.patientId, serviceIdDest: serviceId, motifAdmission, createdBy, chuId: chuId || FALLBACK_CHU_ID }),
          signal: AbortSignal.timeout(8000),
        });

        // fetch() ne lève pas d'exception sur un statut d'erreur HTTP (400/404/...) —
        // sans cette vérification, un échec passait silencieusement, y compris dans les logs.
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          this.logger.warn(
            `admitOrRequestHospitalisation: clinique-back a refusé l'admission directe (HTTP ${response.status}) pour serviceIdDest=${serviceId} (${hospitalisationService}), patientId=${consultation.patientId} — ${body}`,
          );
        }
      } catch (err) {
        this.logger.warn(`admitOrRequestHospitalisation: clinique-back injoignable (admission directe) — ${(err as Error).message}`);
      }
      return 'VALIDE';
    }

    try {
      const response = await fetch(`${GATEWAY_URL}/clinique/demandes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          motif: motifAdmission,
          patientId: consultation.patientId,
          serviceIdSource: CONSULTATION_EXTERNE_SERVICE_ID,
          serviceIdDest: serviceId,
          chuId: chuId || FALLBACK_CHU_ID,
          createdBy,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `admitOrRequestHospitalisation: clinique-back a refusé la demande (HTTP ${response.status}) pour serviceIdDest=${serviceId} (${hospitalisationService}), patientId=${consultation.patientId} — ${body}`,
        );
      }
    } catch (err) {
      this.logger.warn(`admitOrRequestHospitalisation: clinique-back injoignable (demande) — ${(err as Error).message}`);
    }
    return 'EN_ATTENTE';
  }

  private async notifyAccueil(payload: any, endpoint: string, token?: string) {
    const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => 'Erreur inconnue');
      throw new BadRequestException(`Échec de l’envoi vers l’accueil: ${message}`);
    }

    return response.json().catch(() => ({ success: true }));
  }

  /**
   * Quand un service externe (accueil, service clinique...) POST une donnée vers NOTRE
   * backend, c'est à NOUS de prévenir nos propres utilisateurs — l'expéditeur ne le fait
   * pas à notre place. Notifie tout le service "Consultation externe" via le service de
   * notification CHU, reçu en temps réel par le frontend déjà connecté en WebSocket.
   * Best-effort : une erreur ici ne doit jamais faire échouer la création qui l'a déclenchée.
   */
  private async notifyOurService(title: string, message: string, type: string, data?: Record<string, unknown>) {
    try {
      await fetch(`${NOTIFICATION_URL}/notifications/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: CONSULTATION_EXTERNE_SERVICE_ID,
          title,
          message,
          type,
          source: 'consultation-externe-back',
          data,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Non-bloquant.
    }
  }

  async getAccueilRequests() {
    const requests = await this.prisma.prescriptionNonMedicamenteuse.findMany({
      where: {
        OR: [
          { examenService: { not: null } },
          { hospitalisationService: { not: null } },
        ],
      },
      include: {
        consultation: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return requests.map((request) => {
      const isHospitalisation = Boolean(request.hospitalisationService);
      return {
        id: request.id,
        consultationId: request.consultationId,
        patientId: request.consultation.patientId,
        type: isHospitalisation ? 'HOSPITALISATION' : 'EXAMEN',
        title: isHospitalisation ? 'Demande d’hospitalisation' : 'Demande de paraclinique',
        status: 'EN_ATTENTE',
        service: request.examenService ?? request.hospitalisationService,
        motif: request.examenMotif ?? request.hospitalisationMotif,
        notes: request.recommandationsNotes,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        responseDate: null,
      };
    });
  }

  async updateAccueilRequestResponse(consultationId: number, data: { status?: string; notes?: string }) {
    const prescription = await this.prisma.prescriptionNonMedicamenteuse.findFirst({
      where: { consultationId },
    });

    if (!prescription) {
      throw new NotFoundException('Demande d’accueil introuvable');
    }

    const status = String(data?.status ?? '').toUpperCase();
    if (!['EN_ATTENTE', 'VALIDE', 'REFUSE'].includes(status)) {
      throw new BadRequestException('Statut de réponse invalide');
    }

    const updated = await this.prisma.prescriptionNonMedicamenteuse.update({
      where: { id: prescription.id },
      data: {
        hospitalisationStatus: status === 'VALIDE' || status === 'REFUSE' ? status : 'EN_ATTENTE',
        recommandationsNotes: data?.notes ?? null,
      },
    });

    return {
      success: true,
      request: {
        id: updated.id,
        consultationId,
        status: updated.hospitalisationStatus ?? 'EN_ATTENTE',
        responseDate: new Date(),
        notes: updated.recommandationsNotes,
      },
    };
  }

  async markConsultationArrival(id: number, data: { arriveeAccueil?: boolean; arriveeAccueilAt?: string | Date | null }) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id } });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }

    const arriveeAccueil = Boolean(data?.arriveeAccueil ?? false);
    const arriveeAccueilAt = data?.arriveeAccueilAt === undefined
      ? (arriveeAccueil ? new Date() : null)
      : data.arriveeAccueilAt
        ? new Date(data.arriveeAccueilAt)
        : null;

    const updated = await this.prisma.consultation.update({
      where: { id },
      data: {
        arriveeAccueil,
        arriveeAccueilAt,
      },
    });

    this.consultationEvents.next({ type: 'arrival', consultationId: updated.id });
    if (arriveeAccueil) {
      void this.notifyOurService(
        'Patient arrivé',
        `Le patient de la consultation #${updated.id} est arrivé à l'accueil.`,
        'arrival',
        { consultationId: updated.id, patientId: updated.patientId },
      );
    }

    return {
      success: true,
      consultation: {
        id: updated.id,
        arriveeAccueil: updated.arriveeAccueil,
        arriveeAccueilAt: updated.arriveeAccueilAt,
      },
    };
  }

  private async ensureMedecinQuota(medecinId: string, date: Date, heure: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const slots = await this.prisma.planning.findMany({
      where: {
        medecinId,
        disponible: true,
        date: { gte: startOfDay, lte: endOfDay },
      },
    });

    const slot = slots.find((s) => heure >= s.heureDebut && heure < s.heureFin);
    if (!slot) {
      throw new BadRequestException('Le médecin n’a pas de créneau disponible à cette date et heure.');
    }

    const existingCount = await this.prisma.consultation.count({
      where: {
        medecinId,
        date: { gte: startOfDay, lte: endOfDay },
        heure: { gte: slot.heureDebut, lt: slot.heureFin },
      },
    });

    if (existingCount >= slot.quota) {
      throw new BadRequestException(
        `Quota atteint pour ce créneau (${slot.heureDebut}-${slot.heureFin} : ${existingCount}/${slot.quota} patients). Choisissez un autre médecin ou une autre date.`,
      );
    }
  }

  async createConsultation(data: CreateConsultationDto) {
    const consultationDate = new Date(data.date);
    await this.ensureMedecinQuota(data.medecinId, consultationDate, data.heure);

    const todayKey = new Date().toISOString().slice(0, 10);
    const isToday = data.date.slice(0, 10) === todayKey;

    const typeVisite = data.typeVisite ?? 'INITIAL';
    const isControle = typeVisite === 'CONTROLE';

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId: data.patientId,
        medecinId: data.medecinId,
        date: consultationDate,
        heure: data.heure,
        motif: data.motif,
        urgence: data.urgence ?? false,
        statut: isControle ? 'EN_ATTENTE_CONTROLE' : 'EN_ATTENTE',
        termine: false,
        typeVisite,
        ordreControle: data.ordreControle ?? null,
        consultationParenteId: data.consultationParenteId ?? null,
        arriveeAccueil: isToday,
        arriveeAccueilAt: isToday ? new Date() : null,
      },
    });

    this.consultationEvents.next({ type: 'new-consultation', consultationId: consultation.id });
    void this.notifyOurService(
      isControle ? 'Nouveau contrôle programmé' : 'Nouvelle consultation programmée',
      `${data.motif} — ${data.heure}`,
      'new-consultation',
      { consultationId: consultation.id, patientId: consultation.patientId, urgence: data.urgence ? 'URGENT' : 'NORMAL' },
    );

    return {
      success: true,
      consultation: {
        id: consultation.id,
        patientId: consultation.patientId,
        medecinId: consultation.medecinId,
        date: consultation.date,
        heure: consultation.heure,
        statut: consultation.statut,
        arriveeAccueil: consultation.arriveeAccueil,
        arriveeAccueilAt: consultation.arriveeAccueilAt,
      },
    };
  }

  async createControleExterne(data: CreateControleExterneDto) {
    const consultationDate = new Date(data.date);
    await this.ensureMedecinQuota(data.medecinId, consultationDate, data.heure);

    const todayKey = new Date().toISOString().slice(0, 10);
    const isToday = data.date.slice(0, 10) === todayKey;

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId: data.patientId,
        medecinId: data.medecinId,
        date: consultationDate,
        heure: data.heure,
        motif: data.motif,
        urgence: data.urgence ?? false,
        statut: 'EN_ATTENTE_CONTROLE',
        termine: false,
        typeVisite: 'CONTROLE',
        ordreControle: data.ordreControle ?? 1,
        consultationParenteId: data.consultationParenteId ?? null,
        chuSource: data.chuId,
        serviceSource: data.serviceSource,
        arriveeAccueil: isToday,
        arriveeAccueilAt: isToday ? new Date() : null,
      },
    });

    this.consultationEvents.next({ type: 'new-consultation', consultationId: consultation.id });
    void this.notifyOurService(
      'Nouvelle demande de contrôle',
      `${data.serviceSource} — ${data.motif}`,
      'new-consultation',
      { consultationId: consultation.id, patientId: consultation.patientId, urgence: data.urgence ? 'URGENT' : 'NORMAL' },
    );

    return {
      success: true,
      consultation: {
        id: consultation.id,
        patientId: consultation.patientId,
        medecinId: consultation.medecinId,
        date: consultation.date,
        heure: consultation.heure,
        statut: consultation.statut,
        typeVisite: consultation.typeVisite,
        ordreControle: consultation.ordreControle,
        chuSource: consultation.chuSource,
        serviceSource: consultation.serviceSource,
        arriveeAccueil: consultation.arriveeAccueil,
        arriveeAccueilAt: consultation.arriveeAccueilAt,
      },
    };
  }

  async getConsultationsWaitingPrescription(medecinId?: string, chuId?: string, token?: string) {
    // Récupère les consultations du médecin connecté sans prescriptions (ou de tous si vue globale)
    const consultations = await this.prisma.consultation.findMany({
      where: {
        ...(medecinId !== undefined ? { medecinId } : {}),
        nonMedicamentPrescriptions: { none: {} },
      },
      include: {
        observation: true,
        parametresCliniques: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    const [patientsMap, pecMap] = await Promise.all([
      this.fetchPatientsMap(chuId, token),
      this.fetchPriseEnChargeMap(chuId, token),
    ]);
    return consultations.map((consultation) => this.enrichPatient(consultation, patientsMap, pecMap));
  }

  async getPatientConsultationHistory(patientId: string, medecinId: string | undefined) {
    const consultations = await this.prisma.consultation.findMany({
      where: {
        patientId,
        medecinId,
        // L'historique ne montre que les consultations réellement conclues — jamais la
        // consultation en cours (encore vide) ni les rendez-vous futurs pas encore tenus.
        termine: true,
      },
      include: {
        observation: true,
        nonMedicamentPrescriptions: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    return consultations.map((consultation) => ({
      id: consultation.id,
      date: consultation.date,
      heure: consultation.heure,
      statut: consultation.statut,
      typeVisite: consultation.typeVisite,
      ordreControle: consultation.ordreControle,
      diagnostic: consultation.observation?.diagnostic ?? '',
      observations: consultation.observation?.notes ?? '',
      nonMedicamentPrescriptions: consultation.nonMedicamentPrescriptions.map((item) => ({
        rdvMotif: item.rdvMotif,
        rdvDate: item.rdvDate,
        examenService: item.examenService,
        hospitalisationService: item.hospitalisationService,
      })),
    }));
  }

  async getConsultationById(id: number, medecinId: string | undefined, chuId?: string, token?: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id },
      include: {
        observation: true,
        parametresCliniques: true,
        nonMedicamentPrescriptions: true,
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }

    if (medecinId && consultation.medecinId !== medecinId) {
      throw new ForbiddenException('Accès refusé à cette consultation');
    }

    const [patientsMap, pecMap] = await Promise.all([
      this.fetchPatientsMap(chuId, token),
      this.fetchPriseEnChargeMap(chuId, token),
    ]);
    return this.enrichPatient(consultation, patientsMap, pecMap);
  }

  async finalizeConsultation(id: number, data: any, medecinId: string | undefined, token?: string, chuId?: string) {
    const { observation, nonMedicaments, parametres } = data;

    const consultation = await this.prisma.consultation.findUnique({ where: { id } });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }
    if (medecinId && consultation.medecinId !== medecinId) {
      throw new ForbiddenException('Accès refusé à cette consultation');
    }

    // Créer ou mettre à jour l'observation si fournie
    if (observation) {
      const diagnosticRetenu = observation.diagnosticRetenu ?? observation.diagnostic ?? '';
      const diagnosticSuspicion = observation.diagnosticSuspicion ?? '';
      const notes = observation.notes ?? '';

      await this.prisma.observationMedicale.upsert({
        where: { consultationId: id },
        update: {
          diagnostic: diagnosticRetenu || diagnosticSuspicion || notes,
          diagnosticSuspicion,
          diagnosticRetenu,
          notes,
        },
        create: {
          consultationId: id,
          diagnostic: diagnosticRetenu || diagnosticSuspicion || notes,
          diagnosticSuspicion,
          diagnosticRetenu,
          notes,
        },
      });
    }

    if (Array.isArray(parametres)) {
      await this.prisma.parametreClinique.deleteMany({ where: { consultationId: id } });
      if (parametres.length > 0) {
        await this.prisma.parametreClinique.createMany({
          data: parametres
            .filter((item: any) => item && item.nom)
            .map((item: any) => ({
              consultationId: id,
              nom: item.nom,
              valeur: item.valeur ?? '',
              unite: item.unite ?? null,
            })),
        });
      }
    }

    // Si le médecin a rempli le motif d'hospitalisation sans cliquer sur "Confirmer
    // l'hospitalisation" pendant la consultation, on crée/demande quand même l'épisode
    // ici — la finalisation doit prendre en compte tout ce qui a été rempli, même non
    // sauvegardé individuellement. Le frontend n'envoie pas ces champs si déjà confirmés
    // individuellement (évite un doublon). Fait avant l'enregistrement ci-dessous pour
    // connaître le vrai statut (admission directe ou demande en attente).
    let hospitalisationStatus = nonMedicaments?.hospitalisationStatus;
    if (nonMedicaments?.hospitalisationMotif?.trim()) {
      hospitalisationStatus = await this.admitOrRequestHospitalisation(
        consultation,
        nonMedicaments.hospitalisationService || 'SERVICE_HOSPITALISATION',
        nonMedicaments.hospitalisationMotif,
        medecinId,
        token,
        chuId,
      );
    }

    // Supprimer la prescription non médicamenteuse existante et en créer une nouvelle
    if (nonMedicaments) {
      await this.prisma.prescriptionNonMedicamenteuse.deleteMany({
        where: { consultationId: id },
      });
      await this.prisma.prescriptionNonMedicamenteuse.create({
        data: {
          consultationId: id,
          recommandationsNotes: nonMedicaments.recommandationsNotes,
          rdvMotif: nonMedicaments.rdvMotif,
          rdvNiveau: nonMedicaments.rdvNiveau,
          rdvDate: nonMedicaments.rdvDate ? new Date(nonMedicaments.rdvDate) : null,
          examenService: nonMedicaments.examenService,
          examenType: nonMedicaments.examenType,
          examenMotif: nonMedicaments.examenMotif,
          examenPriorite: nonMedicaments.examenPriorite,
          hospitalisationMotif: nonMedicaments.hospitalisationMotif,
          hospitalisationService: nonMedicaments.hospitalisationService,
          hospitalisationStatus,
        },
      });
    }

    const followUp = await this.createControlFollowUp(consultation, medecinId, nonMedicaments);

    // Marquer la consultation comme terminée
    await this.prisma.consultation.update({
      where: { id },
      data: { termine: true, statut: 'TERMINÉ' },
    });

    return {
      success: true,
      followUp: followUp
        ? {
            id: followUp.id,
            statut: followUp.statut,
            date: followUp.date,
            motif: followUp.motif,
          }
        : null,
    };
  }

  async getControlConsultations(medecinId?: string, chuId?: string, token?: string) {
    const consultations = await this.prisma.consultation.findMany({
      where: {
        ...(medecinId !== undefined ? { medecinId } : {}),
        termine: false,
        OR: [
          { typeVisite: 'CONTROLE' },
          { ordreControle: { not: null } },
          { consultationParenteId: { not: null } },
        ],
      },
      include: {
        observation: true,
        nonMedicamentPrescriptions: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    const [patientsMap, pecMap] = await Promise.all([
      this.fetchPatientsMap(chuId, token),
      this.fetchPriseEnChargeMap(chuId, token),
    ]);
    return consultations.map((consultation) => this.enrichPatient(consultation, patientsMap, pecMap));
  }

  async traiterConsultation(id: number, data: any, medecinId: string | undefined, token?: string, chuId?: string) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id } });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }
    if (medecinId && consultation.medecinId !== medecinId) {
      throw new ForbiddenException('Accès refusé à cette consultation');
    }

    const action = String(data?.action ?? '').toLowerCase();

    if (action === 'ouvrir') {
      if (consultation.termine) {
        throw new BadRequestException('Consultation déjà terminée');
      }

      await this.prisma.consultation.update({
        where: { id },
        data: { statut: 'EN_COURS' },
      });

      this.consultationEvents.next({ type: 'status-change', consultationId: id });

      return {
        success: true,
        action: 'ouvrir',
        consultation: { id, statut: 'EN_COURS', termine: false },
      };
    }

    if (action === 'annuler') {
      if (consultation.termine) {
        throw new BadRequestException('Consultation déjà terminée');
      }

      // Une consultation de contrôle doit revenir dans la file "attente de contrôle",
      // pas dans la file générale — sinon un simple "Retour" la fait disparaître de
      // l'écran de contrôle et réapparaître comme une consultation initiale ordinaire.
      const isControl = consultation.typeVisite === 'CONTROLE'
        || consultation.ordreControle != null
        || consultation.consultationParenteId != null;
      const statutAttente = isControl ? 'EN_ATTENTE_CONTROLE' : 'EN_ATTENTE';

      await this.prisma.consultation.update({
        where: { id },
        data: { statut: statutAttente },
      });

      this.consultationEvents.next({ type: 'status-change', consultationId: id });

      return {
        success: true,
        action: 'annuler',
        consultation: { id, statut: statutAttente, termine: false },
      };
    }

    if (action === 'terminer') {
      await this.prisma.consultation.update({
        where: { id },
        data: { termine: true, statut: 'TERMINE' },
      });

      return {
        success: true,
        action: 'terminer',
        consultation: { id, statut: 'TERMINE', termine: true },
      };
    }

    if (action === 'reporter') {
      if (consultation.termine) {
        throw new BadRequestException('Consultation déjà terminée');
      }

      const newDate = data?.date ? new Date(data.date) : null;
      if (!newDate) {
        throw new BadRequestException('Une nouvelle date est requise pour reporter la consultation');
      }

      const newMedecinId: string = data?.medecinId ? String(data.medecinId) : (medecinId ?? consultation.medecinId);

      const reported = await this.prisma.consultation.create({
        data: {
          patientId: consultation.patientId,
          medecinId: newMedecinId,
          date: newDate,
          heure: data?.heure ?? consultation.heure,
          statut: 'EN_ATTENTE',
          termine: false,
          typeVisite: consultation.typeVisite,
          consultationParenteId: id,
          motif: consultation.motif,
          urgence: consultation.urgence,
          estReport: true,
        },
      });

      await this.prisma.consultation.update({
        where: { id },
        data: { statut: 'REPORTEE', termine: true },
      });

      this.consultationEvents.next({ type: 'report', consultationId: reported.id });

      return {
        success: true,
        action: 'reporter',
        consultation: {
          id: reported.id,
          statut: 'EN_ATTENTE',
          date: reported.date,
          heure: reported.heure,
          medecinId: reported.medecinId,
          estReport: true,
          consultationParenteId: id,
        },
      };
    }

    if (action === 'controle') {
      const nextOrder = (consultation.ordreControle ?? 0) + 1;
      const followUpDate = data?.date ? new Date(data.date) : new Date(consultation.date);
      const followUp = await this.prisma.consultation.create({
        data: {
          patientId: consultation.patientId,
          medecinId: medecinId ?? consultation.medecinId,
          date: followUpDate,
          heure: data?.heure ?? consultation.heure,
          statut: 'EN_ATTENTE_CONTROLE',
          termine: false,
          typeVisite: 'CONTROLE',
          ordreControle: nextOrder,
          consultationParenteId: id,
          motif: data?.motif ?? `Contrôle ${this.getControlLabel(nextOrder)}`,
          urgence: consultation.urgence,
        },
      });

      await this.prisma.consultation.update({
        where: { id },
        data: {
          statut: 'EN_ATTENTE_CONTROLE',
          termine: false,
          ordreControle: nextOrder,
        },
      });

      return {
        success: true,
        action: 'controle',
        consultation: {
          id: followUp.id,
          statut: 'EN_ATTENTE_CONTROLE',
          termine: false,
          ordreControle: nextOrder,
          controleLabel: this.getControlLabel(nextOrder),
          consultationParenteId: id,
        },
      };
    }

    if (action === 'examen') {
      await this.registerNonMedicalAction(id, {
        notes: data?.notes ?? 'Demande de paraclinique envoyée vers l’accueil',
        examenService: data?.service ?? data?.examenService ?? 'PARACLINIQUE',
        examenType: data?.type ?? data?.examenType ?? 'EXAMEN',
        examenMotif: data?.motif ?? data?.examenMotif ?? 'Examen demandé',
        examenPriorite: data?.priorite ?? data?.examenPriorite ?? 'NORMALE',
      });

      await this.notifyAccueil({
        patientId: consultation.patientId,
        specialiteId: 1,
        medecinId: consultation.medecinId,
        dateDebutSemaine: new Date().toISOString().slice(0, 10),
        rendezVousPropose: new Date().toISOString(),
        priorite: 'NORMALE',
        motif: data?.motif ?? data?.examenMotif ?? 'Examen demandé',
        createdBy: `consultation-${id}`,
      }, '/accueil/triage/consultation-externe', token);

      await this.prisma.consultation.update({
        where: { id },
        data: { statut: 'EN_ATTENTE_PARACLINIQUE', termine: false },
      });

      return {
        success: true,
        action: 'examen',
        redirect: 'ACCUEIL',
        consultation: { id, statut: 'EN_ATTENTE_PARACLINIQUE', termine: false },
      };
    }

    if (action === 'hospitalisation') {
      // Si le médecin appartient lui-même au service destinataire, sa décision vaut
      // admission directe ; sinon c'est une demande que ce service devra valider (voir
      // admitOrRequestHospitalisation).
      const hospitalisationService = data?.service ?? data?.hospitalisationService ?? 'SERVICE_HOSPITALISATION';
      const motifAdmission = data?.motif ?? data?.hospitalisationMotif ?? 'Hospitalisation confirmée';

      const hospitalisationStatus = await this.admitOrRequestHospitalisation(consultation, hospitalisationService, motifAdmission, medecinId, token, chuId);

      await this.registerNonMedicalAction(id, {
        notes: data?.notes ?? (hospitalisationStatus === 'VALIDE'
          ? 'Hospitalisation confirmée par le médecin prescripteur'
          : 'Demande d\'hospitalisation envoyée au service concerné, en attente de validation'),
        hospitalisationMotif: motifAdmission,
        hospitalisationService,
        hospitalisationStatus,
      });

      // Confirmer/demander l'hospitalisation ne termine PAS la consultation : le médecin
      // peut continuer à renseigner le traitement, les paracliniques, etc. Seule l'action
      // explicite "terminer" (bouton "Terminer la consultation") clôt la consultation.
      await this.prisma.consultation.update({
        where: { id },
        data: { statut: 'HOSPITALISE' },
      });

      return {
        success: true,
        action: 'hospitalisation',
        redirect: 'ACCUEIL',
        consultation: { id, statut: 'HOSPITALISE', termine: false, hospitalisationStatus },
      };
    }

    throw new Error('Action de traitement non supportée');
  }

  async saveConsultationPrescriptions(
    id: number,
    data: {
      nonMedicaments?: any | null;
    },
    medecinId: string | undefined,
  ) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id } });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }
    if (medecinId && consultation.medecinId !== medecinId) {
      throw new ForbiddenException('Accès refusé à cette consultation');
    }

    if (data.nonMedicaments === null) {
      await this.prisma.prescriptionNonMedicamenteuse.deleteMany({
        where: { consultationId: id },
      });
    } else if (data.nonMedicaments) {
      await this.prisma.prescriptionNonMedicamenteuse.deleteMany({
        where: { consultationId: id },
      });
      await this.prisma.prescriptionNonMedicamenteuse.create({
        data: {
          consultationId: id,
          recommandationsNotes: data.nonMedicaments.recommandationsNotes,
          rdvMotif: data.nonMedicaments.rdvMotif,
          rdvNiveau: data.nonMedicaments.rdvNiveau,
          rdvDate: data.nonMedicaments.rdvDate ? new Date(data.nonMedicaments.rdvDate) : null,
          examenService: data.nonMedicaments.examenService,
          examenType: data.nonMedicaments.examenType,
          examenMotif: data.nonMedicaments.examenMotif,
          examenPriorite: data.nonMedicaments.examenPriorite,
          hospitalisationMotif: data.nonMedicaments.hospitalisationMotif,
          hospitalisationService: data.nonMedicaments.hospitalisationService,
          hospitalisationStatus: data.nonMedicaments.hospitalisationStatus,
        },
      });
    }

    return { success: true };
  }

  async saveControlNote(id: number, data: { noteControle?: string }, medecinId: string | undefined) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id } });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }
    if (medecinId && consultation.medecinId !== medecinId) {
      throw new ForbiddenException('Accès refusé à cette consultation');
    }

    const noteControle = data.noteControle?.trim() ?? '';

    await this.prisma.observationMedicale.upsert({
      where: { consultationId: id },
      update: {
        noteControle: noteControle || null,
      },
      create: {
        consultationId: id,
        diagnostic: '',
        notes: '',
        noteControle: noteControle || null,
      },
    });

    return { success: true };
  }

  async getAllConsultations(medecinId: string | undefined, options?: { arrived?: boolean; date?: string | Date; dateFrom?: string | Date; dateTo?: string | Date; archived?: boolean }, chuId?: string, token?: string) {
    const where: Record<string, any> = { termine: options?.archived === true ? true : false };
    if (medecinId !== undefined) {
      where.medecinId = medecinId;
    }

    if (typeof options?.arrived === 'boolean') {
      where.arriveeAccueil = options.arrived;
    }

    if (options?.date) {
      const selectedDate = new Date(options.date);
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      where.date = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (options?.dateFrom || options?.dateTo) {
      const range: Record<string, Date> = {};

      if (options.dateFrom) {
        const from = new Date(options.dateFrom);
        from.setHours(0, 0, 0, 0);
        range.gte = from;
      }

      if (options.dateTo) {
        const to = new Date(options.dateTo);
        to.setHours(23, 59, 59, 999);
        range.lte = to;
      }

      where.date = range;
    }

    const consultations = await this.prisma.consultation.findMany({
      where,
      include: {
        observation: true,
        nonMedicamentPrescriptions: true,
        parametresCliniques: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    const [patientsMap, pecMap] = await Promise.all([
      this.fetchPatientsMap(chuId, token),
      this.fetchPriseEnChargeMap(chuId, token),
    ]);
    return consultations.map((consultation) => {
      const enriched = this.enrichPatient(consultation, patientsMap, pecMap);
      const isControl = consultation.typeVisite === 'CONTROLE' || consultation.ordreControle !== null || consultation.consultationParenteId !== null;
      return {
        ...enriched,
        isControl,
        controleLabel: isControl ? this.getControlLabel(consultation.ordreControle) : null,
      };
    });
  }
}
