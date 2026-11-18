import { BadRequestException } from '@nestjs/common';
import { PlanningService } from './planning.service';

// Tests du service Planning : règles de gestion RG03, RG07 et RG15 (cloisonnement par CHU).
describe('PlanningService', () => {
  let prisma: { planning: Record<string, jest.Mock> };
  let service: PlanningService;

  beforeEach(() => {
    prisma = {
      planning: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new PlanningService(prisma as any, {} as any);
  });

  it('RG15 : ne renvoie que les créneaux du CHU de l\'utilisateur (et les anciens créneaux sans CHU)', async () => {
    await service.findAll('chu-a');
    expect(prisma.planning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ chuId: 'chu-a' }, { chuId: null }] } }),
    );
  });

  it('RG15 : sans CHU connu (jeton de service interne), aucun filtre n\'est appliqué', async () => {
    await service.findAll();
    expect(prisma.planning.findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it('RG15 : enregistre le CHU sur chaque occurrence d\'une série récurrente', async () => {
    await service.createRecurring({
      medecinId: 'med-1', chuId: 'chu-a', startDate: '2030-01-07', endDate: '2030-01-11',
      daysOfWeek: [1, 3, 5], heureDebut: '08:00', heureFin: '11:00', quota: 10, disponible: true,
    } as any);
    const rows = prisma.planning.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3); // lundi, mercredi, vendredi (RG07)
    expect(rows.every((r: any) => r.chuId === 'chu-a' && r.seriesId === rows[0].seriesId)).toBe(true);
  });

  it('RG03 : refuse un créneau dont l\'heure de fin précède l\'heure de début', async () => {
    await expect(service.create({
      medecinId: 'med-1', date: '2030-01-07', heureDebut: '11:00', heureFin: '08:00', quota: 5, disponible: true,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.planning.create).not.toHaveBeenCalled();
  });

  it('RG07 : refuse une série de plus de 260 occurrences', async () => {
    await expect(service.createRecurring({
      medecinId: 'med-1', startDate: '2030-01-01', endDate: '2031-12-31',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], heureDebut: '08:00', heureFin: '11:00', quota: 10, disponible: true,
    } as any)).rejects.toThrow('max 260');
    expect(prisma.planning.createMany).not.toHaveBeenCalled();
  });
});
