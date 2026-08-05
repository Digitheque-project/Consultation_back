import { ConsultationsService } from './consultations.service';

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      consultation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      observationMedicale: {
        upsert: jest.fn(),
      },
      parametreClinique: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      prescriptionNonMedicamenteuse: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };

    service = new ConsultationsService(prisma as any);
  });

  it('marks a consultation as terminated when a doctor finishes it', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'INITIAL',
    });

    prisma.consultation.update.mockResolvedValue({ id: 1, statut: 'TERMINE', termine: true });

    const result = await service.traiterConsultation(1, { action: 'terminer' }, 'c2ded010-e37a-4ec1-bf93-4712393ba231');

    expect(result.action).toBe('terminer');
    expect(prisma.consultation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ statut: 'TERMINE', termine: true }),
      }),
    );
  });

  it('marks a consultation as arrived at reception when confirmation is received', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'INITIAL',
      urgence: false,
    });
    prisma.consultation.update.mockResolvedValue({
      id: 1,
      arriveeAccueil: true,
      arriveeAccueilAt: new Date('2026-06-25T08:30:00.000Z'),
    });

    const result = await service.markConsultationArrival(1, { arriveeAccueil: true });

    expect(result.success).toBe(true);
    expect(prisma.consultation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ arriveeAccueil: true }),
      }),
    );
  });

  it('allows arrival confirmation without a doctor ownership context', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'INITIAL',
      urgence: false,
    });
    prisma.consultation.update.mockResolvedValue({
      id: 1,
      arriveeAccueil: true,
      arriveeAccueilAt: new Date('2026-06-25T08:30:00.000Z'),
    });

    const result = await service.markConsultationArrival(1, { arriveeAccueil: true });

    expect(result.success).toBe(true);
    expect(prisma.consultation.update).toHaveBeenCalled();
  });

  it('forwards exam requests to the accueil microservice', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'INITIAL',
      urgence: false,
    });

    prisma.prescriptionNonMedicamenteuse.deleteMany.mockResolvedValue({});
    prisma.prescriptionNonMedicamenteuse.create.mockResolvedValue({ id: 42 });
    prisma.consultation.update.mockResolvedValue({ id: 1, statut: 'EN_ATTENTE_PARACLINIQUE', termine: false });

    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ success: true }),
    });

    const result = await service.traiterConsultation(
      1,
      { action: 'examen', motif: 'Bilan', service: 'Laboratoire' },
      'c2ded010-e37a-4ec1-bf93-4712393ba231',
    );

    expect(result.action).toBe('examen');
    expect((global as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accueil/triage/consultation-externe'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates a follow-up control consultation when a control date is planned', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'TERMINÉ',
      urgence: false,
      ordreControle: null,
    });

    prisma.observationMedicale.upsert.mockResolvedValue({});
    prisma.prescriptionNonMedicamenteuse.deleteMany.mockResolvedValue({});
    prisma.prescriptionNonMedicamenteuse.create.mockResolvedValue({ id: 77 });
    prisma.consultation.update.mockResolvedValue({ id: 1, statut: 'TERMINÉ', termine: true });
    prisma.consultation.create.mockResolvedValue({ id: 2, statut: 'EN_ATTENTE_CONTROLE', termine: false });

    const result = await service.finalizeConsultation(
      1,
      {
        observation: null,
        nonMedicaments: {
          rdvMotif: 'Contrôle post-opératoire',
          rdvDate: '2026-07-02',
        },
      },
      'c2ded010-e37a-4ec1-bf93-4712393ba231',
    );

    expect(result.success).toBe(true);
    expect(prisma.consultation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          typeVisite: 'CONTROLE',
          consultationParenteId: 1,
          ordreControle: 1,
          statut: 'EN_ATTENTE_CONTROLE',
        }),
      }),
    );
  });

  it('returns the patient consultation history with observations and prescriptions', async () => {
    prisma.consultation.findMany.mockResolvedValue([
      {
        id: 7,
        patientId: 'CHU-2026-00012',
        medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
        date: new Date('2026-06-20T09:00:00.000Z'),
        heure: '09:00',
        statut: 'TERMINÉ',
        urgence: false,
        termine: true,
        typeVisite: 'INITIAL',
        ordreControle: null,
        consultationParenteId: null,
        observation: { diagnostic: 'Diabète', notes: 'Observation initiale' },
        nonMedicamentPrescriptions: [{ rdvMotif: 'Contrôle' }],
      },
    ]);

    const result = await service.getPatientConsultationHistory('CHU-2026-00012', 'c2ded010-e37a-4ec1-bf93-4712393ba231');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 7,
        diagnostic: 'Diabète',
        observations: 'Observation initiale',
      }),
    );
  });

  it('stores suspicion and retained diagnosis plus clinical parameters when finalizing a consultation', async () => {
    prisma.consultation.findUnique.mockResolvedValue({
      id: 1,
      medecinId: 'c2ded010-e37a-4ec1-bf93-4712393ba231',
      patientId: 10,
      date: new Date('2026-06-25T09:00:00.000Z'),
      heure: '09:00',
      termine: false,
      statut: 'INITIAL',
      urgence: false,
      ordreControle: null,
    });

    prisma.observationMedicale.upsert.mockResolvedValue({});
    prisma.parametreClinique.deleteMany.mockResolvedValue({ count: 0 });
    prisma.parametreClinique.createMany.mockResolvedValue({ count: 3 });
    prisma.prescriptionNonMedicamenteuse.deleteMany.mockResolvedValue({});
    prisma.prescriptionNonMedicamenteuse.create.mockResolvedValue({ id: 77 });
    prisma.consultation.update.mockResolvedValue({ id: 1, statut: 'TERMINÉ', termine: true });
    prisma.consultation.create.mockResolvedValue({ id: 2, statut: 'EN_ATTENTE_CONTROLE', termine: false });

    await service.finalizeConsultation(
      1,
      {
        observation: {
          diagnosticSuspicion: 'Infection virale',
          diagnosticRetenu: 'Grippe',
          notes: 'Observation clinique',
        },
        nonMedicaments: null,
        parametres: [
          { nom: 'Tension', valeur: '12/8', unite: 'mmHg' },
          { nom: 'Température', valeur: '38.2', unite: '°C' },
          { nom: 'Poids', valeur: '72', unite: 'kg' },
        ],
      },
      'c2ded010-e37a-4ec1-bf93-4712393ba231',
    );

    expect(prisma.observationMedicale.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          diagnosticSuspicion: 'Infection virale',
          diagnosticRetenu: 'Grippe',
          notes: 'Observation clinique',
        }),
      }),
    );
    expect(prisma.parametreClinique.deleteMany).toHaveBeenCalled();
    expect(prisma.parametreClinique.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ nom: 'Tension', valeur: '12/8' }),
        ]),
      }),
    );
  });
});
