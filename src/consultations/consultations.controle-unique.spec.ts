import { ConsultationsService } from './consultations.service';

// Un seul contrôle en attente par consultation : ni un second enregistrement de
// fin de consultation, ni l'Accueil qui planifie le contrôle demandé ne doivent
// créer de doublon.
describe('ConsultationsService : contrôle de suivi unique', () => {
  const consultation = { id: 7, patientId: 'pat1', medecinId: 'doc1', ordreControle: 1, heure: '09:00', urgence: false };
  const enAttente = { id: 42, consultationParenteId: 7, typeVisite: 'CONTROLE', termine: false, ordreControle: 2 };
  let prisma: any;
  let service: ConsultationsService;

  const monter = (existant: any) => {
    prisma = {
      consultation: {
        findFirst: jest.fn().mockResolvedValue(existant),
        create: jest.fn(({ data }) => Promise.resolve({ id: 99, ...data })),
        update: jest.fn(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      },
    };
    service = new ConsultationsService(prisma);
    jest.spyOn(service as any, 'ensureMedecinQuota').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'notifyOurService').mockResolvedValue(undefined);
  };

  it('fin de consultation : crée le contrôle s’il n’existe pas', async () => {
    monter(null);
    const r = await (service as any).createControlFollowUp(consultation, 'doc1', { rdvDate: '2026-11-27', rdvMotif: 'Contrôle' });
    expect(prisma.consultation.create).toHaveBeenCalledTimes(1);
    expect(r.ordreControle).toBe(2);
    expect(r.consultationParenteId).toBe(7);
  });

  it('fin de consultation enregistrée deux fois : met à jour le contrôle existant', async () => {
    monter(enAttente);
    const r = await (service as any).createControlFollowUp(consultation, 'doc1', { rdvDate: '2026-11-28' });
    expect(prisma.consultation.create).not.toHaveBeenCalled();
    expect(prisma.consultation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
    expect(r.date).toEqual(new Date('2026-11-28'));
  });

  it("l'Accueil qui planifie le contrôle demandé reprend celui déjà créé", async () => {
    monter(enAttente);
    const r = await service.createConsultation({
      patientId: 'pat1', medecinId: 'doc1', date: '2026-11-30', heure: '10:00', motif: 'Contrôle',
      typeVisite: 'CONTROLE', consultationParenteId: 7,
    } as any);
    expect(prisma.consultation.create).not.toHaveBeenCalled();
    expect(prisma.consultation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 }, data: expect.objectContaining({ heure: '10:00', ordreControle: 2 }) }),
    );
    expect(r.consultation.id).toBe(42);
  });

  it("une nouvelle consultation initiale de l'Accueil est toujours créée", async () => {
    monter(enAttente);
    await service.createConsultation({ patientId: 'pat1', medecinId: 'doc1', date: '2026-11-30', heure: '10:00', motif: 'Fièvre' } as any);
    expect(prisma.consultation.findFirst).not.toHaveBeenCalled();
    expect(prisma.consultation.create).toHaveBeenCalledTimes(1);
  });
});
