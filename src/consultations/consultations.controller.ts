import { Controller, Get, Post, Body, Param, Req, UseGuards, Query, Sse, MessageEvent, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery, ApiPropertyOptional, ApiBearerAuth } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Public } from '../auth/public.decorator';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CreateControleExterneDto } from './dto/create-controle-externe.dto';

class ConsultationArrivalDto {
  @ApiPropertyOptional({ description: 'Indique si le patient est arriv� � l�accueil', example: true })
  arriveeAccueil?: boolean;

  @ApiPropertyOptional({ description: 'Horodatage de confirmation d�arriv�e', example: '2026-06-25T08:30:00.000Z' })
  arriveeAccueilAt?: string | Date | null;
}

class ReportConsultationDto {
  @ApiPropertyOptional({ description: 'Nouvelle date du rendez-vous (ISO 8601)', example: '2026-07-25' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Nouvelle heure du rendez-vous — reprend celle d\'origine si absente', example: '10:00' })
  @IsOptional()
  @IsString()
  heure?: string;

  @ApiPropertyOptional({ description: 'Changer de médecin pour le rendez-vous reporté — reprend le médecin d\'origine si absent', example: 'c2ded010-e37a-4ec1-bf93-4712393ba231' })
  @IsOptional()
  @IsUUID()
  medecinId?: string;
}

@ApiTags('consultations')
@ApiBearerAuth('access-token')
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  /** Le service accueil (token de service) a une vue globale ; un m�decin connect� reste limit� � ses propres consultations. */
  private getEffectiveMedecinId(req: Request): string | undefined {
    const user = req.user as any;
    if (user?.role === 'SERVICE') return undefined;
    return user?.medecinId ? String(user.medecinId) : undefined;
  }

  /** Le chuId vient du token de l'utilisateur connect� : jamais d'une valeur fig�e, pour rester multi-CHU. */
  private getChuId(req: Request): string | undefined {
    const user = req.user as any;
    return user?.chuId ? String(user.chuId) : undefined;
  }

  /** JWT brut de la requ�te entrante, transmis tel quel au service accueil (m�me token partag�). */
  private getRawToken(req: Request): string | undefined {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice('Bearer '.length).trim() || undefined;
  }

  @Get('waiting-prescription')
  @ApiOperation({
    summary: 'Obtenir les consultations en attente de prescription',
    description: 'R�cup�re toutes les consultations qui sont termin�es et en attente de prescription m�dicale'
  })
  @ApiResponse({
    status: 200,
    description: 'Liste des consultations en attente de prescription',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', example: 1 },
          date: { type: 'string', format: 'date-time', example: '2026-05-13T13:28:32.930Z' },
          heure: { type: 'string', example: '09:30' },
          patientId: { type: 'string', example: 'CHU-2026-00012' },
          medecinId: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
          statut: { type: 'string', example: 'TERMIN�' },
          urgence: { type: 'boolean', example: true },
          termine: { type: 'boolean', example: true },
          motif: { type: 'string', example: 'Toux persistante' },
          observation: {
            type: 'object',
            properties: {
              diagnostic: { type: 'string', example: 'Suspicion d\'infection urinaire' },
              notes: { type: 'string', example: 'Patient avec fi�vre � 39�C depuis 2 jours' }
            }
          }
        }
      }
    }
  })
  async getWaitingPrescription(@Req() req: Request) {
    return this.consultationsService.getConsultationsWaitingPrescription(this.getEffectiveMedecinId(req), this.getChuId(req), this.getRawToken(req));
  }

  @Get('controls')
  @ApiOperation({
    summary: 'Obtenir les consultations � contr�ler',
    description: 'R�cup�re les consultations d�j� finalis�es pour le m�decin connect� afin de pr�parer un suivi ou un contr�le'
  })
  async getControlConsultations(@Req() req: Request) {
    return this.consultationsService.getControlConsultations(this.getEffectiveMedecinId(req), this.getChuId(req), this.getRawToken(req));
  }

  @Get()
  @ApiOperation({
    summary: 'Obtenir toutes les consultations',
    description: 'R�cup�re la liste compl�te de toutes les consultations'
  })
  @ApiResponse({
    status: 200,
    description: 'Liste de toutes les consultations',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', example: 1 },
          date: { type: 'string', format: 'date-time' },
          heure: { type: 'string', example: '09:30' },
          patientId: { type: 'string', example: 'CHU-2026-00012' },
          medecinId: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
          statut: { type: 'string', example: 'TERMIN�' },
          urgence: { type: 'boolean', example: false },
          termine: { type: 'boolean', example: true },
          motif: { type: 'string', example: 'Bilan de sant�' }
        }
      }
    }
  })
  @ApiQuery({ name: 'arrived', required: false, description: 'Filtrer sur les consultations déjà confirmées comme arrivées à l\'accueil', type: Boolean })
  @ApiQuery({ name: 'date', required: false, description: 'Filtrer sur les consultations planifiées à une date donnée', example: '2026-06-25' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Filtrer sur les consultations dont la date est postérieure ou égale à cette date', example: '2026-06-20' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Filtrer sur les consultations dont la date est antérieure ou égale à cette date', example: '2026-06-30' })
  @ApiQuery({ name: 'archived', required: false, description: 'true = consultations terminées (archive), false/absent = consultations actives', type: Boolean })
  async getAll(
    @Req() req: Request,
    @Query('arrived') arrived?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
  ) {
    const medecinId = this.getEffectiveMedecinId(req);
    const arrivedFilter = arrived === undefined ? undefined : arrived === 'true';
    const archivedFilter = archived === 'true';
    return this.consultationsService.getAllConsultations(medecinId, { arrived: arrivedFilter, date, dateFrom, dateTo, archived: archivedFilter }, this.getChuId(req), this.getRawToken(req));
  }

  @Public()
  @Post()
  @ApiTags('accueil')
  @ApiOperation({
    summary: "Creer une consultation CONTROLE ou INITIAL � endpoint public service externe",
    description: "Endpoint sans authentification. Le service clinique peut poster un CONTROLE post-hospitalisation. Le quota du creneau est verifie cote serveur. Si la date est aujourd�hui, l�arrivee est confirmee automatiquement.",
  })
  @ApiBody({ type: CreateConsultationDto })
  @ApiResponse({
    status: 201,
    description: 'Consultation cr��e avec succ�s.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        consultation: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 51 },
            patientId: { type: 'string', example: 'CHU-2026-00012' },
            medecinId: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
            date: { type: 'string', format: 'date-time' },
            heure: { type: 'string', example: '09:30' },
            statut: { type: 'string', example: 'EN_ATTENTE' },
            arriveeAccueil: { type: 'boolean', example: true },
            arriveeAccueilAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'M�decin introuvable.' })
  @ApiResponse({ status: 400, description: 'Donn�es invalides (champ manquant ou mal format�).' })
  async createConsultation(@Body() data: CreateConsultationDto) {
    return this.consultationsService.createConsultation(data);
  }

  @Get('patient/:patientId/history')
  @ApiOperation({
    summary: 'Obtenir l�historique des consultations d�un patient',
    description: 'R�cup�re les consultations ant�rieures d�un patient avec diagnostics, observations et prescriptions.'
  })
  async getPatientHistory(@Req() req: Request, @Param('patientId') patientId: string) {
    return this.consultationsService.getPatientConsultationHistory(patientId, this.getEffectiveMedecinId(req));
  }

  // IMPORTANT : cette route SSE doit rester déclarée avant "@Get(':id')" ci-dessous.
  // Express/Nest matche les routes dans leur ordre de déclaration : ":id" capture
  // n'importe quel segment unique (y compris le littéral "events"), donc si ":id"
  // est déclaré en premier, GET /consultations/events est intercepté par getById
  // (qui exige un token) au lieu du flux SSE public — c'est exactement ce qui
  // cassait la réception temps réel des événements (arrivée, nouvelle consultation...).
  @Public()
  @Sse('events')
  @ApiOperation({
    summary: 'Flux temps réel des événements de consultation',
    description: 'Permet au front de s’abonner (Server-Sent Events) aux mises à jour, notamment l’arrivée d’un patient à l’accueil, sans polling.',
  })
  consultationEvents(): Observable<MessageEvent> {
    return this.consultationsService.consultationEvents$.pipe(
      map((event) => ({ data: event })),
    );
  }

  // Même contrainte d'ordre que ci-dessus : route à segment unique, doit précéder ":id".
  @Get('hospitalisation-services')
  @ApiOperation({
    summary: 'Lister les services cliniques disponibles pour une hospitalisation',
    description: 'Liste dynamique issue du registre service-service, filtrée sur type=CLINIQUE et isActive=true pour le CHU du médecin connecté.',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste des services cliniques actifs',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '7ca23205-820f-4f66-abec-59c8d2a6e878' },
          name: { type: 'string', example: 'Chirurgie' },
        },
      },
    },
  })
  async getHospitalisationServices(@Req() req: Request) {
    return this.consultationsService.getHospitalisationServices(this.getChuId(req), this.getRawToken(req));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtenir une consultation par ID',
    description: 'R�cup�re les d�tails complets d\'une consultation sp�cifique'
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la consultation',
    type: 'number',
    example: 1
  })
  @ApiResponse({
    status: 200,
    description: 'D�tails de la consultation',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'number', example: 1 },
        date: { type: 'string', format: 'date-time' },
        heure: { type: 'string', example: '09:30' },
        patientId: { type: 'string', example: 'CHU-2026-00012' },
        medecinId: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
        statut: { type: 'string', example: 'TERMIN�' },
        urgence: { type: 'boolean', example: true },
        termine: { type: 'boolean', example: true },
        motif: { type: 'string', example: 'Toux persistante' },
        observation: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 1 },
            consultationId: { type: 'number', example: 1 },
            diagnostic: { type: 'string', example: 'Suspicion d\'infection urinaire' },
            notes: { type: 'string', example: 'Patient avec fi�vre � 39�C depuis 2 jours' }
          }
        },
        nonMedicamentPrescriptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              recommandationsNotes: { type: 'string', example: 'Reposer 3 jours' },
              rdvMotif: { type: 'string', example: 'Contr�le post-traitement' },
              rdvNiveau: { type: 'string', enum: ['NIVEAU_1', 'NIVEAU_2', 'NIVEAU_3', 'NIVEAU_4'], example: 'NIVEAU_1' },
              rdvDate: { type: 'string', format: 'date', example: '2026-05-20' },
              examenService: { type: 'string', example: 'Laboratoire' },
              examenMotif: { type: 'string', example: 'Bilan sanguin' },
              examenPriorite: { type: 'string', enum: ['STAT', 'URGENTE', 'NORMALE'], example: 'NORMALE' },
              hospitalisationMotif: { type: 'string', example: 'Surveillance post-op�ratoire' },
              hospitalisationService: { type: 'string', example: 'Chirurgie' },
              hospitalisationStatus: { type: 'string', enum: ['EN_ATTENTE', 'VALIDE', 'REFUSE'], example: 'EN_ATTENTE' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Consultation non trouv�e'
  })
  async getById(@Req() req: Request, @Param('id') id: string) {
    return this.consultationsService.getConsultationById(+id, this.getEffectiveMedecinId(req), this.getChuId(req), this.getRawToken(req));
  }

  @Post(':id/finalize')
  @ApiOperation({
    summary: 'Finaliser une consultation',
    description: 'Finalise une consultation en ajoutant l\'observation, les param�tres cliniques et les prescriptions non-m�dicamenteuses (les prescriptions m�dicamenteuses sont envoy�es directement au service prescription)'
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la consultation � finaliser',
    type: 'number',
    example: 1
  })
  @ApiResponse({
    status: 200,
    description: 'Consultation finalis�e avec succ�s',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Consultation finalis�e avec succ�s' },
        consultation: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 1 },
            statut: { type: 'string', example: 'TERMIN�' },
            termine: { type: 'boolean', example: true }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Donn�es invalides'
  })
  @ApiResponse({
    status: 404,
    description: 'Consultation non trouv�e'
  })
  async finalizeConsultation(@Req() req: Request, @Param('id') id: string, @Body() data: any) {
    return this.consultationsService.finalizeConsultation(+id, data, this.getEffectiveMedecinId(req), this.getRawToken(req), this.getChuId(req));
  }

  @Post(':id/prescriptions')
  @ApiOperation({
    summary: 'Enregistrer les prescriptions d�une consultation',
    description: 'Permet de modifier ou de compl�ter les prescriptions non m�dicamenteuses lors d�un contr�le'
  })
  async saveConsultationPrescriptions(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() data: { nonMedicaments?: any | null },
  ) {
    return this.consultationsService.saveConsultationPrescriptions(+id, data, this.getEffectiveMedecinId(req));
  }

  @Post(':id/control-note')
  @ApiOperation({
    summary: 'Ajouter ou mettre � jour la note de contr�le',
    description: 'Enregistre ou met � jour la note de contr�le d\'une consultation d�j� finalis�e (champ facultatif)'
  })
  async saveControlNote(@Req() req: Request, @Param('id') id: string, @Body() data: { noteControle?: string }) {
    return this.consultationsService.saveControlNote(+id, data, this.getEffectiveMedecinId(req));
  }

  @Public()
  @Get('accueil/rendez-vous')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Lister tous les rendez-vous du CHU pour l\'accueil',
    description:
      'Endpoint **public** utilisé par le service accueil pour consulter l\'ensemble des rendez-vous enregistrés dans le module consultation externe.\n\n' +
      '**Accès :**\n' +
      '- Avec un **JWT valide** (Bearer token) → accès direct, aucun paramètre supplémentaire requis.\n' +
      '- Sans JWT (service accueil) → `?chuId=` requis et doit correspondre à `process.env.CHU_ID` côté serveur.\n\n' +
      '**Paramètres :**\n' +
      '- `chuId` (optionnel si JWT fourni) — identifiant du CHU pour les services sans token.\n' +
      '- `date` (optionnel) — filtrer sur une date précise (`YYYY-MM-DD`)\n' +
      '- `dateFrom` / `dateTo` (optionnel) — filtrer sur une plage de dates\n' +
      '- `archived` (optionnel, défaut `false`) — `true` pour voir les consultations terminées\n\n' +
      '**Utilisation typique :** `GET /consultations/accueil/rendez-vous?chuId=1e5bbbb7-...&date=2026-07-14`',
  })
  @ApiQuery({ name: 'chuId', required: false, description: 'Identifiant du CHU — optionnel si un Bearer JWT contenant chuId est fourni', example: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394' })
  @ApiQuery({ name: 'date', required: false, description: 'Filtrer sur une date précise (YYYY-MM-DD)', example: '2026-07-14' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Date de début de plage (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Date de fin de plage (YYYY-MM-DD)' })
  @ApiQuery({ name: 'archived', required: false, description: 'true = consultations terminées, false/absent = consultations actives', type: Boolean })
  @ApiResponse({
    status: 200,
    description: 'Liste des rendez-vous du CHU',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', example: 74 },
          date: { type: 'string', format: 'date-time', example: '2026-07-14T00:00:00.000Z' },
          heure: { type: 'string', example: '09:30' },
          patientId: { type: 'string', example: 'CHU-2026-00012' },
          medecinId: { type: 'string', format: 'uuid', example: 'c2ded010-e37a-4ec1-bf93-4712393ba231' },
          statut: { type: 'string', example: 'EN_ATTENTE' },
          urgence: { type: 'boolean', example: false },
          arriveeAccueil: { type: 'boolean', example: false },
          arriveeAccueilAt: { type: 'string', format: 'date-time', nullable: true, example: null },
          motif: { type: 'string', nullable: true, example: 'Douleurs abdominales' },
          typeVisite: { type: 'string', example: 'INITIAL' },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'chuId invalide ou non autorisé.' })
  async getRendezVousAccueil(
    @Req() req: Request,
    @Query('chuId') chuIdParam?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
  ) {
    const user = (req as any).user;

    // Accès autorisé si :
    // 1. JWT valide présent (médecin authentifié ou token de service)
    // 2. OU le ?chuId= correspond à process.env.CHU_ID (service accueil sans JWT)
    const hasValidJwt = !!user?.userId || user?.role === 'SERVICE';
    if (!hasValidJwt) {
      const expectedChuId = process.env.CHU_ID;
      if (!expectedChuId || !chuIdParam || chuIdParam.trim() !== expectedChuId) {
        throw new ForbiddenException('chuId invalide ou non autorisé pour ce service.');
      }
    }

    const archivedFilter = archived === 'true';
    const chuId = chuIdParam?.trim() || (user?.chuId ? String(user.chuId) : undefined);
    return this.consultationsService.getAllConsultations(undefined, { date, dateFrom, dateTo, archived: archivedFilter }, chuId, this.getRawToken(req));
  }

  @Public()
  @Post(':id/arrival')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Confirmer l\'arrivée d\'un patient à l\'accueil',
    description:
      'Marque une consultation comme **arrivée à l\'accueil**. À appeler dès que le patient se présente physiquement.\n\n' +
      'Le médecin voit ensuite ce patient dans son fil de travail avec le statut "Arrivé".\n\n' +
      '**Corps de la requête :**\n' +
      '- `arriveeAccueil` (booléen) — `true` pour confirmer l\'arrivée, `false` pour annuler\n' +
      '- `arriveeAccueilAt` (optionnel) — horodatage de l\'arrivée (ISO 8601). Si absent, l\'heure courante est utilisée.',
  })
  @ApiParam({ name: 'id', description: 'ID de la consultation', type: 'number', example: 74 })
  @ApiBody({ type: ConsultationArrivalDto })
  @ApiResponse({
    status: 200,
    description: 'Arrivée confirmée',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'number', example: 74 },
        arriveeAccueil: { type: 'boolean', example: true },
        arriveeAccueilAt: { type: 'string', format: 'date-time', example: '2026-07-14T08:32:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Consultation introuvable.' })
  async markConsultationArrival(@Param('id') id: string, @Body() data: { arriveeAccueil?: boolean; arriveeAccueilAt?: string | Date | null }) {
    return this.consultationsService.markConsultationArrival(+id, data);
  }

  @Public()
  @Post(':id/report')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Reporter un rendez-vous (patient non présenté)',
    description:
      'À utiliser quand le patient ne s\'est pas présenté le jour du rendez-vous : crée un nouveau rendez-vous ' +
      '(en attente, prioritaire) à la date choisie, et clôt l\'ancien (statut "REPORTEE").\n\n' +
      '**Corps de la requête :**\n' +
      '- `date` (requis) — nouvelle date du rendez-vous (ISO 8601)\n' +
      '- `heure` (optionnel) — nouvelle heure, reprend celle d\'origine si absente\n' +
      '- `medecinId` (optionnel) — pour changer de médecin au passage, reprend le médecin d\'origine si absent',
  })
  @ApiParam({ name: 'id', description: 'ID de la consultation à reporter', type: 'number', example: 74 })
  @ApiBody({ type: ReportConsultationDto })
  @ApiResponse({
    status: 200,
    description: 'Rendez-vous reporté avec succès — retourne le nouveau rendez-vous créé.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        action: { type: 'string', example: 'reporter' },
        consultation: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 88, description: 'ID du nouveau rendez-vous créé' },
            statut: { type: 'string', example: 'EN_ATTENTE' },
            date: { type: 'string', format: 'date-time' },
            heure: { type: 'string', example: '10:00' },
            medecinId: { type: 'string', format: 'uuid' },
            estReport: { type: 'boolean', example: true },
            consultationParenteId: { type: 'number', example: 74 },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Date manquante ou consultation déjà terminée.' })
  @ApiResponse({ status: 404, description: 'Consultation introuvable.' })
  async reportConsultation(@Req() req: Request, @Param('id') id: string, @Body() data: ReportConsultationDto) {
    return this.consultationsService.traiterConsultation(
      +id,
      { action: 'reporter', ...data },
      this.getEffectiveMedecinId(req),
      this.getRawToken(req),
      this.getChuId(req),
    );
  }

  @Public()
  @Get('accueil/requests')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Lister les demandes d�examen ou d�hospitalisation � suivre depuis l�accueil',
    description: 'Expose les demandes envoy�es depuis le parcours m�decin pour que l�accueil affiche leur statut en temps r�el.',
  })
  async getAccueilRequests() {
    return this.consultationsService.getAccueilRequests();
  }

  @Public()
  @Post('accueil/requests/:id/reponse')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Mettre � jour la r�ponse d�une demande envoy�e � l�accueil',
    description: 'Permet � l�accueil de signaler une r�ponse VALIDE ou REFUSE sur une demande de paraclinique ou d�hospitalisation.',
  })
  async updateAccueilRequestResponse(@Param('id') id: string, @Body() data: { status?: string; notes?: string }) {
    return this.consultationsService.updateAccueilRequestResponse(+id, data);
  }

  @Post(':id/traiter')
  @ApiOperation({
    summary: 'Traiter une consultation avec l�une des actions m�tier',
    description: 'Actions disponibles : "ouvrir" (le m�decin commence la consultation, statut ? EN_COURS), "annuler" (le m�decin revient en arri�re sans finaliser, statut ? EN_ATTENTE), "terminer", "controle", "examen", "hospitalisation", "reporter" (le patient �tait arriv� mais n�a pas pu �tre vu ; cr�e une nouvelle consultation prioritaire � une date/m�decin choisis, body: { date, heure?, medecinId? }).',
  })
  async traiterConsultation(@Req() req: Request, @Param('id') id: string, @Body() data: any) {
    return this.consultationsService.traiterConsultation(+id, data, this.getEffectiveMedecinId(req), this.getRawToken(req), this.getChuId(req));
  }

  @Public()
  @Post('externe/controle')
  @ApiTags('service-clinique')
  @ApiOperation({
    summary: 'Creer un controle post-hospitalisation (service clinique)',
    description: 'Endpoint dedie au service clinique. Permet de programmer un rendez-vous de controle pour un patient sortant de lhopital. Aucun token requis. Fournir chuId et serviceSource pour tracer lorigine du patient.',
  })
  @ApiBody({ type: CreateControleExterneDto })
  @ApiResponse({
    status: 201,
    description: 'Controle cree avec succes.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        consultation: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 87 },
            patientId: { type: 'string', example: 'CHU-2026-00042' },
            medecinId: { type: 'string', format: 'uuid', example: 'bb2ff11e-0e8b-4ea5-a120-ed4c55d07909' },
            date: { type: 'string', format: 'date-time' },
            heure: { type: 'string', example: '10:00' },
            statut: { type: 'string', example: 'EN_ATTENTE_CONTROLE' },
            typeVisite: { type: 'string', example: 'CONTROLE' },
            ordreControle: { type: 'number', example: 1 },
            chuSource: { type: 'string', example: '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394' },
            serviceSource: { type: 'string', example: 'CHIRURGIE_DIGESTIVE' },
            arriveeAccueil: { type: 'boolean', example: false },
            arriveeAccueilAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Medecin introuvable.' })
  @ApiResponse({ status: 400, description: 'Quota du creneau atteint ou donnees invalides.' })
  async createControleExterne(@Body() data: CreateControleExterneDto) {
    return this.consultationsService.createControleExterne(data);
  }
}
