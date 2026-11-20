import { ConsultationsService } from './consultations.service';

// Historique clinique : la date affichée est celle où la consultation a été
// faite, pas celle du rendez-vous prévu (souvent antérieure).
describe('ConsultationsService.getPatientConsultationHistory : date de réalisation', () => {
  const prevue = new Date('2026-10-21');
  const base = {
    patientId: 'pat1', medecinId: 'doc1', heure: '09:00', statut: 'TERMINE', typeVisite: 'CONTROLE',
    ordreControle: 1, termine: true, date: prevue, nonMedicamentPrescriptions: [],
  };
  const liste = [
    { ...base, id: 1, updatedAt: new Date('2026-11-20T10:00:00Z'), observation: { createdAt: new Date('2026-11-20T09:30:00Z'), notes: 'a', diagnostic: 'x' } },
    { ...base, id: 2, updatedAt: new Date('2026-10-25T08:00:00Z'), observation: null },
    { ...base, id: 3, updatedAt: new Date('2026-11-05T08:00:00Z'), observation: { createdAt: new Date('2026-11-01T08:00:00Z'), notes: '', diagnostic: '' } },
  ];

  it("donne la date réelle (observation, sinon dernière mise à jour) et trie dans l'ordre réel", async () => {
    const prisma: any = { consultation: { findMany: jest.fn().mockResolvedValue(liste) } };
    const service = new ConsultationsService(prisma);
    const r = await service.getPatientConsultationHistory('pat1', 'doc1');
    expect(r.map((h) => h.id)).toEqual([2, 3, 1]);
    expect(r.map((h) => h.dateRealisation?.toISOString().slice(0, 10))).toEqual(['2026-10-25', '2026-11-01', '2026-11-20']);
    expect(r.every((h) => h.date === prevue)).toBe(true);
  });
});
