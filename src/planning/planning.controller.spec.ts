import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { AuthService } from '../auth/auth.service';

describe('PlanningController', () => {
  let controller: PlanningController;
  let planningService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByMedecin: jest.Mock;
    findByDateRange: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    removeByMedecin: jest.Mock;
    getServices: jest.Mock;
    getServiceDoctors: jest.Mock;
    createRecurring: jest.Mock;
    findOneBySeriesId: jest.Mock;
    updateSeriesFromDate: jest.Mock;
    createUnavailability: jest.Mock;
    findConflictingSlots: jest.Mock;
  };

  beforeEach(async () => {
    planningService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByMedecin: jest.fn(),
      findByDateRange: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      removeByMedecin: jest.fn(),
      getServices: jest.fn(),
      getServiceDoctors: jest.fn(),
      createRecurring: jest.fn(),
      findOneBySeriesId: jest.fn(),
      updateSeriesFromDate: jest.fn(),
      createUnavailability: jest.fn(),
      findConflictingSlots: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanningController],
      providers: [
        { provide: PlanningService, useValue: planningService },
        // Le contrôleur est décoré @UseGuards(JwtGuard), et JwtGuard dépend de
        // AuthService : sans ce doublon, Nest échoue à instancier le module de
        // test avant même d'exécuter le moindre cas. Les tests appellent les
        // méthodes du contrôleur directement, le garde n'est jamais exécuté —
        // un doublon vide suffit donc à satisfaire l'injection.
        { provide: AuthService, useValue: { validateToken: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PlanningController>(PlanningController);
  });

  it('allows an admin to update a planning slot owned by another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    planningService.findOne.mockResolvedValue({ id: 1, medecinId: 99 });
    planningService.update.mockResolvedValue({ id: 1, medecinId: 99 });

    await expect(controller.update(req, '1', { disponible: false })).resolves.toEqual({ id: 1, medecinId: 99 });
    expect(planningService.update).toHaveBeenCalledWith(1, { disponible: false });
  });

  it('blocks a doctor from updating a planning slot owned by another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'MEDECIN' } } as any;
    planningService.findOne.mockResolvedValue({ id: 1, medecinId: 99 });

    await expect(controller.update(req, '1', { disponible: false })).rejects.toThrow(ForbiddenException);
    expect(planningService.update).not.toHaveBeenCalled();
  });

  it('allows an admin to list clinical services for the grid view', async () => {
    const req = { user: { role: 'ADMIN', chuId: 'chu-1' }, headers: { authorization: 'Bearer tok' } } as any;
    planningService.getServices.mockResolvedValue([{ id: 's1', name: 'Pédiatrie' }]);

    await expect(controller.getServices(req)).resolves.toEqual([{ id: 's1', name: 'Pédiatrie' }]);
    expect(planningService.getServices).toHaveBeenCalledWith('chu-1', 'tok');
  });

  it('blocks a non-admin from listing clinical services', async () => {
    const req = { user: { role: 'MEDECIN' }, headers: {} } as any;

    await expect(controller.getServices(req)).rejects.toThrow(ForbiddenException);
    expect(planningService.getServices).not.toHaveBeenCalled();
  });

  it('allows the SERVICE role (cross-service token, e.g. accueil) to list clinical services', async () => {
    const req = { user: { role: 'SERVICE' }, headers: {} } as any;
    planningService.getServices.mockResolvedValue([{ id: 's1', name: 'Pédiatrie' }]);

    await expect(controller.getServices(req)).resolves.toEqual([{ id: 's1', name: 'Pédiatrie' }]);
  });

  it('allows an admin to list doctors of a given service', async () => {
    const req = { user: { role: 'ADMIN' }, headers: { authorization: 'Bearer tok' } } as any;
    planningService.getServiceDoctors.mockResolvedValue([{ id: 'd1', nom: 'Dupont', prenom: 'Jean', email: 'j@d.mg', specialite: null }]);

    await expect(controller.getServiceDoctors(req, 's1')).resolves.toEqual([{ id: 'd1', nom: 'Dupont', prenom: 'Jean', email: 'j@d.mg', specialite: null }]);
    expect(planningService.getServiceDoctors).toHaveBeenCalledWith('s1', 'tok');
  });

  it('blocks a non-admin from listing doctors of a service', async () => {
    const req = { user: { role: 'MEDECIN' }, headers: {} } as any;

    await expect(controller.getServiceDoctors(req, 's1')).rejects.toThrow(ForbiddenException);
    expect(planningService.getServiceDoctors).not.toHaveBeenCalled();
  });

  it('allows the SERVICE role (cross-service token, e.g. accueil) to list doctors of a service', async () => {
    const req = { user: { role: 'SERVICE' }, headers: {} } as any;
    planningService.getServiceDoctors.mockResolvedValue([{ id: 'd1', nom: 'Dupont', prenom: 'Jean', email: 'j@d.mg', specialite: null }]);

    await expect(controller.getServiceDoctors(req, 's1')).resolves.toEqual([{ id: 'd1', nom: 'Dupont', prenom: 'Jean', email: 'j@d.mg', specialite: null }]);
  });

  it('allows an admin to create a recurring series for another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    const dto = { medecinId: 'doc-1', startDate: '2026-08-03', endDate: '2026-08-14', daysOfWeek: [1, 3, 5], heureDebut: '08:00', heureFin: '11:00', quota: 10, disponible: true } as any;
    planningService.createRecurring.mockResolvedValue({ seriesId: 'series-1', slots: [] });

    await expect(controller.createRecurring(req, dto)).resolves.toEqual({ seriesId: 'series-1', slots: [] });
    expect(planningService.createRecurring).toHaveBeenCalledWith({ ...dto, medecinId: 'doc-1' });
  });

  it('blocks a doctor from creating a recurring series for another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'MEDECIN' } } as any;
    const dto = { medecinId: 'doc-1', startDate: '2026-08-03', endDate: '2026-08-14', daysOfWeek: [1], heureDebut: '08:00', heureFin: '11:00', quota: 10, disponible: true } as any;

    await expect(controller.createRecurring(req, dto)).rejects.toThrow(ForbiddenException);
    expect(planningService.createRecurring).not.toHaveBeenCalled();
  });

  it('allows an admin to update future occurrences of a series owned by another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    planningService.findOneBySeriesId.mockResolvedValue({ id: 5, medecinId: 99, seriesId: 'series-1' });
    planningService.updateSeriesFromDate.mockResolvedValue({ count: 2, slots: [] });

    await expect(controller.updateSeries(req, 'series-1', { fromDate: '2026-08-10', quota: 5 } as any)).resolves.toEqual({ count: 2, slots: [] });
    expect(planningService.updateSeriesFromDate).toHaveBeenCalledWith('series-1', '2026-08-10', { quota: 5 });
  });

  it('blocks a doctor from updating a series owned by another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'MEDECIN' } } as any;
    planningService.findOneBySeriesId.mockResolvedValue({ id: 5, medecinId: 99, seriesId: 'series-1' });

    await expect(controller.updateSeries(req, 'series-1', { fromDate: '2026-08-10' } as any)).rejects.toThrow(ForbiddenException);
    expect(planningService.updateSeriesFromDate).not.toHaveBeenCalled();
  });

  it('returns 404 when updating a non-existent series', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    planningService.findOneBySeriesId.mockResolvedValue(null);

    await expect(controller.updateSeries(req, 'missing', { fromDate: '2026-08-10' } as any)).rejects.toThrow(NotFoundException);
  });

  it('allows an admin to record an unavailability for another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    const dto = { medecinId: 'doc-1', startDate: '2026-08-10', endDate: '2026-08-15', conflictStrategy: 'replace' } as any;
    planningService.createUnavailability.mockResolvedValue({ seriesId: 'series-2', slots: [], deletedCount: 3 });

    await expect(controller.createUnavailability(req, dto)).resolves.toEqual({ seriesId: 'series-2', slots: [], deletedCount: 3 });
    expect(planningService.createUnavailability).toHaveBeenCalledWith({ ...dto, medecinId: 'doc-1' });
  });

  it('blocks a doctor from recording an unavailability for another doctor', async () => {
    const req = { user: { medecinId: 10, role: 'MEDECIN' } } as any;
    const dto = { medecinId: 'doc-1', startDate: '2026-08-10', endDate: '2026-08-15' } as any;

    await expect(controller.createUnavailability(req, dto)).rejects.toThrow(ForbiddenException);
    expect(planningService.createUnavailability).not.toHaveBeenCalled();
  });

  it('allows an admin to list conflicting slots for any doctor', async () => {
    const req = { user: { medecinId: 10, role: 'ADMIN' } } as any;
    planningService.findConflictingSlots.mockResolvedValue([{ id: 7 }]);

    await expect(controller.getConflicts(req, 'doc-1', '2026-08-10', '2026-08-15')).resolves.toEqual([{ id: 7 }]);
    expect(planningService.findConflictingSlots).toHaveBeenCalledWith('doc-1', '2026-08-10', '2026-08-15');
  });

  it("blocks a doctor from listing another doctor's conflicting slots", async () => {
    const req = { user: { medecinId: 'doc-9', role: 'MEDECIN' } } as any;

    await expect(controller.getConflicts(req, 'doc-1', '2026-08-10', '2026-08-15')).rejects.toThrow(ForbiddenException);
    expect(planningService.findConflictingSlots).not.toHaveBeenCalled();
  });
});
