import { ForbiddenException } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';

// Archive : le parcours complet (initiale + tous les contrôles) d'un patient.
describe('ConsultationsService.getParcours', () => {
  const base = { patientId: 'pat1', medecinId: 'doc1', typeVisite: 'INITIAL', ordreControle: null, consultationParenteId: null };
  const c1 = { ...base, id: 1, date: new Date('2026-11-01') };
  const c2 = { ...base, id: 2, date: new Date('2026-11-05'), typeVisite: 'CONTROLE', ordreControle: 1, consultationParenteId: 1 };
  const c3 = { ...base, id: 3, date: new Date('2026-11-11'), typeVisite: 'CONTROLE', ordreControle: 2, consultationParenteId: 2 };
  const parId: Record<number, any> = { 1: c1, 2: c2, 3: c3 };

  let prisma: any;
  let service: ConsultationsService;
  beforeEach(() => {
    prisma = {
      consultation: {
        findUnique: jest.fn(({ where }) => Promise.resolve(parId[where.id] ?? null)),
        findMany: jest.fn(({ where }) => {
          if (where.consultationParenteId) {
            const parents: number[] = where.consultationParenteId.in;
            const exclus: number[] = where.id.notIn;
            return Promise.resolve(
              Object.values(parId)
                .filter((c: any) => parents.includes(c.consultationParenteId) && !exclus.includes(c.id))
                .map((c: any) => ({ id: c.id })),
            );
          }
          return Promise.resolve(where.id.in.sort().map((i: number) => parId[i]));
        }),
      },
      medecinCache: { findMany: jest.fn().mockResolvedValue([{ id: 'doc1', prenom: 'Jean', nom: 'RAKOTO' }]) },
    };
    service = new ConsultationsService(prisma as any);
    jest.spyOn(service as any, 'fetchPatientsMap').mockResolvedValue(new Map());
    jest.spyOn(service as any, 'fetchPriseEnChargeMap').mockResolvedValue(new Map());
  });

  it("depuis le 2e contrôle, renvoie aussi l'initiale et le 1er contrôle", async () => {
    const r = await service.getParcours(3, 'doc1');
    expect(r.etapes.map((e: any) => e.id)).toEqual([1, 2, 3]);
    expect(r.etapes[0].medecinNom).toBe('Jean RAKOTO');
    expect(r.etapes[0].isControl).toBe(false);
    expect(r.etapes[2].isControl).toBe(true);
  });

  it("refuse le parcours d'un autre médecin", async () => {
    await expect(service.getParcours(3, 'autre')).rejects.toThrow(ForbiddenException);
  });
});

// Archive par patient : un patient revenu plusieurs fois a une seule archive.
describe('ConsultationsService.getParcoursPatient', () => {
  const base = { patientId: 'pat1', medecinId: 'doc1', typeVisite: 'INITIAL', ordreControle: null, consultationParenteId: null, termine: true };
  const liste = [
    { ...base, id: 1, date: new Date('2026-09-01') },
    { ...base, id: 2, date: new Date('2026-09-08'), typeVisite: 'CONTROLE', ordreControle: 1, consultationParenteId: 1 },
    { ...base, id: 5, date: new Date('2026-11-02') },
    { ...base, id: 6, date: new Date('2026-11-09'), typeVisite: 'CONTROLE', ordreControle: 1, consultationParenteId: 5, termine: false },
    { ...base, id: 9, date: new Date('2026-11-20'), termine: false },
    { ...base, id: 10, date: new Date('2026-10-01'), medecinId: 'autre' },
  ];
  let service: ConsultationsService;
  beforeEach(() => {
    const prisma: any = {
      consultation: { findMany: jest.fn().mockResolvedValue(liste) },
      medecinCache: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ConsultationsService(prisma);
    jest.spyOn(service as any, 'fetchPatientsMap').mockResolvedValue(new Map());
    jest.spyOn(service as any, 'fetchPriseEnChargeMap').mockResolvedValue(new Map());
  });

  it('regroupe chaque parcours, le plus récent en premier, sans les rendez-vous pas encore tenus', async () => {
    const r = await service.getParcoursPatient('pat1', undefined);
    expect(r.parcours.map((p: any) => p.etapes.map((e: any) => e.id))).toEqual([[5, 6], [10], [1, 2]]);
    expect(r.parcours[0].termine).toBe(false);
  });

  it("un médecin ne voit que les parcours auxquels il a participé", async () => {
    const r = await service.getParcoursPatient('pat1', 'doc1');
    expect(r.parcours.map((p: any) => p.etapes[0].id)).toEqual([5, 1]);
  });

  it("le médecin qui traite le patient en ce moment voit aussi les parcours des autres médecins", async () => {
    const r = await service.getParcoursPatient('pat1', 'doc1', undefined, undefined, { tousMedecins: true });
    expect(r.parcours.map((p: any) => p.etapes[0].id)).toEqual([5, 10, 1]);
  });

  it("sans consultation en cours avec ce patient, la demande élargie reste limitée à ses parcours", async () => {
    const r = await service.getParcoursPatient('pat1', 'autre', undefined, undefined, { tousMedecins: true });
    expect(r.parcours.map((p: any) => p.etapes[0].id)).toEqual([10]);
  });
});
