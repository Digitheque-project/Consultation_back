import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PlanningService } from './planning.service';
import { CreatePlanningDto } from './dto/create-planning.dto';
import { UpdatePlanningDto } from './dto/update-planning.dto';
import { CreateRecurringPlanningDto } from './dto/create-recurring-planning.dto';
import { UpdatePlanningSeriesDto } from './dto/update-planning-series.dto';
import { CreateUnavailabilityDto } from './dto/create-unavailability.dto';
import { PlanningResponseDto } from './dto/planning-response.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { Public } from '../auth/public.decorator';

@ApiTags('planning')
@ApiBearerAuth('access-token')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  /** Le chuId vient du token de l'utilisateur connecté : jamais d'une valeur figée, pour rester multi-CHU. */
  private getChuId(req: Request): string | undefined {
    const user = req.user as any;
    return user?.chuId ? String(user.chuId) : undefined;
  }

  private getRawToken(req: Request): string | undefined {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice('Bearer '.length).trim() || undefined;
  }

  @Post()
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Créer un nouveau créneau de disponibilité pour le médecin connecté' })
  @ApiBody({ type: CreatePlanningDto })
  @ApiResponse({ status: 201, description: 'Créneau créé avec succès.', type: PlanningResponseDto })
  @ApiBadRequestResponse({ description: 'Données invalides ou plage horaire incorrecte.' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async create(@Req() req: Request, @Body() createPlanningDto: CreatePlanningDto) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    const requestedMedecinId: string = createPlanningDto.medecinId ?? currentMedecinId;

    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && requestedMedecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }

    const createdPlanning = await this.planningService.create({
      ...createPlanningDto,
      medecinId: requestedMedecinId,
    });
    return createdPlanning;
  }

  @Post('recurring')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Créer une série de créneaux récurrents (ex: Lundi/Mercredi/Vendredi sur plusieurs semaines)',
    description: 'Génère une ligne Planning indépendante par occurrence, toutes liées par un seriesId commun — chaque occurrence reste ensuite modifiable/supprimable individuellement via les endpoints existants.',
  })
  @ApiBody({ type: CreateRecurringPlanningDto })
  @ApiResponse({ status: 201, description: 'Série créée avec succès (seriesId + occurrences générées).' })
  @ApiBadRequestResponse({ description: 'Période invalide, aucune date correspondante, ou trop de créneaux générés (max 260).' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async createRecurring(@Req() req: Request, @Body() dto: CreateRecurringPlanningDto) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    const requestedMedecinId: string = dto.medecinId ?? currentMedecinId;

    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && requestedMedecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }

    return this.planningService.createRecurring({ ...dto, medecinId: requestedMedecinId });
  }

  @Post('unavailability')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Enregistrer une indisponibilité sur une plage de dates (congés, formation, absence)',
    description:
      "Crée un jour Planning indisponible (journée entière, sans quota) par date de la plage, tous liés par un seriesId commun. conflictStrategy='replace' supprime au passage les créneaux à venir déjà planifiés dans la période (les créneaux passés ne sont jamais supprimés).",
  })
  @ApiBody({ type: CreateUnavailabilityDto })
  @ApiResponse({ status: 201, description: 'Indisponibilité enregistrée (seriesId, jours créés, nombre de créneaux supprimés).' })
  @ApiBadRequestResponse({ description: 'Période invalide ou trop longue (max 366 jours).' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async createUnavailability(@Req() req: Request, @Body() dto: CreateUnavailabilityDto) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    const requestedMedecinId: string = dto.medecinId ?? currentMedecinId;

    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && requestedMedecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }

    return this.planningService.createUnavailability({ ...dto, medecinId: requestedMedecinId });
  }

  // Route à segment littéral déclarée avant ":id" — sinon Nest matche
  // "conflicts" comme un id de planning (bug déjà rencontré avec events/services).
  @Get('conflicts')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Lister les créneaux déjà planifiés dans une période (avant d\'enregistrer une indisponibilité)',
  })
  @ApiQuery({ name: 'medecinId', required: true, description: 'UUID du médecin' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Début de la période (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'Fin de la période, incluse (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Créneaux disponibles en conflit sur la période.' })
  async getConflicts(
    @Req() req: Request,
    @Query('medecinId') medecinId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();

    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && medecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }

    return this.planningService.findConflictingSlots(medecinId, startDate, endDate);
  }

  @Public()
  @Get()
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Récupérer les créneaux de planning visibles pour l’utilisateur courant' })
  @ApiResponse({ status: 200, description: 'Liste des créneaux disponibles.' })
  async findAll(@Req() req: Request) {
    const currentUser = req.user as any;
    const currentRole = String(currentUser?.role || '').toUpperCase();

    // SERVICE (token de service OU JWT d'un agent d'accueil, cf. auth.service.ts
    // resolveRole) doit voir la vue complète, comme ADMIN — cohérent avec TOUTES
    // les autres méthodes de ce contrôleur (create, getConflicts, update, remove…
    // testent déjà `role !== 'ADMIN' && role !== 'SERVICE'`). Avant ce correctif,
    // cette méthode se basait sur `!medecinId` à la place : ça fonctionnait par
    // accident avec le token de service statique (medecinId codé en dur à null),
    // mais un JWT d'agent d'accueil a un medecinId réel (= son propre userId, cf.
    // buildValidatedUser) — il retombait donc à tort sur findByMedecin(userId),
    // qui ne correspond à aucun médecin réel → liste vide.
    if (!currentUser?.medecinId || currentRole === 'ADMIN' || currentRole === 'SERVICE') {
      return this.planningService.findAll();
    }

    return this.planningService.findByMedecin(String(currentUser.medecinId));
  }

  @Public()
  @Get('medecin/:medecinId')
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Récupérer le planning d\'un médecin par ID (PUBLIC)' })
  @ApiParam({ name: 'medecinId', description: 'UUID du médecin' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Date de début (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Date de fin (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Planning du médecin demandé.' })
  async findByMedecin(
    @Param('medecinId') medecinId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (startDate && endDate) {
      return this.planningService.findByDateRange(
        medecinId,
        new Date(startDate),
        new Date(endDate),
      );
    }
    return this.planningService.findByMedecin(medecinId);
  }

  // Routes à segment littéral déclarées avant ":id" — sinon Nest matche
  // "services" comme un id de planning (même bug déjà rencontré ailleurs).
  @UseGuards(JwtGuard)
  @Get('services')
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Lister les services cliniques (Vue par service, admin)',
    description: 'Départements médicaux (registre service-service, type=CLINIQUE) du CHU du médecin connecté — jamais créés localement.',
  })
  @ApiResponse({ status: 200, description: 'Liste des services cliniques actifs.' })
  async getServices(@Req() req: Request) {
    const role = String((req.user as any)?.role || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SERVICE') {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
    return this.planningService.getServices(this.getChuId(req), this.getRawToken(req));
  }

  @UseGuards(JwtGuard)
  @Get('services/:serviceId/doctors')
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Lister les médecins d\'un service (Vue par service, admin)' })
  @ApiParam({ name: 'serviceId', description: 'UUID du service (registre service-service)' })
  @ApiResponse({ status: 200, description: 'Liste des médecins actifs du service.' })
  async getServiceDoctors(@Req() req: Request, @Param('serviceId') serviceId: string) {
    const role = String((req.user as any)?.role || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SERVICE') {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
    return this.planningService.getServiceDoctors(serviceId, this.getRawToken(req));
  }

  @Patch('series/:seriesId')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({
    summary: 'Modifier "ce créneau et les suivants" d\'une série récurrente',
    description: 'Met à jour toutes les occurrences de la série dont la date est postérieure ou égale à fromDate — ne touche jamais les occurrences passées, même si fromDate l\'est.',
  })
  @ApiParam({ name: 'seriesId', description: 'Identifiant de série (retourné par POST /planning/recurring)' })
  @ApiBody({ type: UpdatePlanningSeriesDto })
  @ApiResponse({ status: 200, description: 'Occurrences futures mises à jour.' })
  @ApiResponse({ status: 404, description: 'Série introuvable.' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async updateSeries(@Req() req: Request, @Param('seriesId') seriesId: string, @Body() dto: UpdatePlanningSeriesDto) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();

    const sample = await this.planningService.findOneBySeriesId(seriesId);
    if (!sample) {
      throw new NotFoundException('Série introuvable');
    }
    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && sample.medecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }

    const { fromDate, ...data } = dto;
    return this.planningService.updateSeriesFromDate(seriesId, fromDate, data);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Récupérer un créneau de planning par ID (PUBLIC)' })
  @ApiParam({ name: 'id', description: 'ID du planning' })
  @ApiResponse({ status: 200, description: 'Créneau trouvé.', type: PlanningResponseDto })
  @ApiResponse({ status: 404, description: 'Créneau non trouvé.' })
  async findOne(@Param('id') id: string) {
    const planning = await this.planningService.findOne(+id);
    if (!planning) {
      throw new NotFoundException('Planning non trouvé');
    }
    return planning;
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Mettre à jour un créneau de planning' })
  @ApiParam({ name: 'id', description: 'ID du planning' })
  @ApiBody({ type: UpdatePlanningDto })
  @ApiResponse({ status: 200, description: 'Créneau mis à jour.' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async update(@Req() req: Request, @Param('id') id: string, @Body() updatePlanningDto: UpdatePlanningDto) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    const planning = await this.planningService.findOne(+id);
    if (!planning) {
      throw new NotFoundException('Planning non trouvé');
    }
    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && planning.medecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }
    return this.planningService.update(+id, updatePlanningDto);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  @ApiTags('accueil')
  @ApiOperation({ summary: 'Supprimer un créneau de planning' })
  @ApiParam({ name: 'id', description: 'ID du planning' })
  @ApiResponse({ status: 200, description: 'Créneau supprimé.' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    const planning = await this.planningService.findOne(+id);
    if (!planning) {
      throw new NotFoundException('Planning non trouvé');
    }
    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && planning.medecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé à ce planning');
    }
    return this.planningService.remove(+id);
  }

  @Delete('medecin/:medecinId/all')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer tous les plannings d\'un médecin' })
  @ApiParam({ name: 'medecinId', description: 'UUID du médecin' })
  @ApiResponse({ status: 200, description: 'Tous les créneaux du médecin ont été supprimés.' })
  @ApiUnauthorizedResponse({ description: 'Token JWT manquant ou invalide.' })
  removeByMedecin(@Req() req: Request, @Param('medecinId') medecinId: string) {
    const currentUser = req.user as any;
    const currentMedecinId: string = String(currentUser?.medecinId);
    const currentRole = String(currentUser?.role || '').toUpperCase();
    if (currentRole !== 'ADMIN' && currentRole !== 'SERVICE' && medecinId !== currentMedecinId) {
      throw new ForbiddenException('Accès refusé');
    }
    return this.planningService.removeByMedecin(medecinId);
  }
}

