/**
 * seed-consultations.mjs
 *
 * 1. Récupère les patients valides depuis l'accueil (chuId courant)
 * 2. Supprime les consultations avec des patientId non reconnus (ancien CHU)
 * 3. Crée de nouvelles consultations pour aujourd'hui et demain
 *
 * Usage : node scripts/seed-consultations.mjs [--dry-run]
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const ACCUEIL_BASE_URL = process.env.ACCUEIL_BASE_URL ?? 'https://acceuil-back-production.up.railway.app';
const CHU_ID          = process.env.CHU_ID          ?? '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394';
const DRY_RUN         = process.argv.includes('--dry-run');

// ── Utilitaires ─────────────────────────────────────────────────────────────

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function tomorrow() {
  const d = today();
  d.setDate(d.getDate() + 1);
  return d;
}

function log(msg) {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'EXEC'}] ${msg}`);
}

// ── 1. Récupérer les patients valides depuis l'accueil ───────────────────────

async function fetchValidPatients() {
  const url = `${ACCUEIL_BASE_URL}/accueil/patients?chuId=${CHU_ID}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Accueil ${res.status}: ${await res.text()}`);
  const patients = await res.json();
  console.log(`\n✔ ${patients.length} patient(s) valide(s) dans l'accueil pour CHU ${CHU_ID}`);
  return patients;
}

// ── 2. Nettoyer les consultations avec des patients inconnus ─────────────────

async function cleanStaleConsultations(validIds) {
  const validSet = new Set(validIds);

  // Toutes les consultations en DB
  const all = await prisma.consultation.findMany({
    select: { id: true, patientId: true, date: true, statut: true },
    orderBy: { id: 'asc' },
  });

  const stale = all.filter(c => !validSet.has(c.patientId));

  console.log(`\n📋 ${all.length} consultation(s) en base`);
  console.log(`🗑  ${stale.length} consultation(s) avec patientId invalide (ancien CHU)`);

  if (stale.length === 0) {
    console.log('   → Rien à supprimer.');
    return;
  }

  stale.forEach(c => console.log(`   • #${c.id}  patientId=${c.patientId}  date=${dateKey(c.date)}  statut=${c.statut}`));

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Suppression ignorée — relancez sans --dry-run pour confirmer.');
    return;
  }

  const staleIds = stale.map(c => c.id);

  // Supprimer d'abord les contrôles (enfants) avant les parents
  const controles = await prisma.consultation.findMany({
    where: { consultationParenteId: { in: staleIds } },
    select: { id: true },
  });
  const controleIds = controles.map(c => c.id);
  const allToDelete = [...new Set([...controleIds, ...staleIds])];

  // Supprimer les données dépendantes
  await prisma.observationMedicale.deleteMany({ where: { consultationId: { in: allToDelete } } });
  await prisma.parametreClinique.deleteMany({ where: { consultationId: { in: allToDelete } } });
  await prisma.prescriptionMedicamenteuse.deleteMany({ where: { consultationId: { in: allToDelete } } });
  await prisma.prescriptionNonMedicamenteuse.deleteMany({ where: { consultationId: { in: allToDelete } } });

  // Supprimer les contrôles avant les parents (contrainte FK)
  if (controleIds.length > 0) {
    await prisma.consultation.deleteMany({ where: { id: { in: controleIds } } });
  }
  await prisma.consultation.deleteMany({ where: { id: { in: staleIds } } });

  console.log(`\n✔ ${allToDelete.length} consultation(s) supprimée(s).`);
}

// ── 3. Créer de nouvelles consultations ─────────────────────────────────────

const MOTIFS = [
  'Consultation de suivi — tension artérielle',
  'Douleur thoracique à l\'effort',
  'Fièvre persistante depuis 3 jours',
  'Bilan annuel de santé',
  'Contrôle post-hospitalisation',
  'Trouble du sommeil',
  'Fatigue chronique',
  'Toux sèche persistante',
  'Douleurs lombaires',
  'Suivi diabète',
  'Vertige et nausées',
  'Consultation dermatologique',
];

async function seedNewConsultations(patients, medecins) {
  if (medecins.length === 0) {
    console.log('\n⚠  Aucun médecin en base — import impossible.');
    return;
  }

  // Patients réels (avec nom complet)
  const realPatients = patients.filter(p => p.prenom && p.nom);
  if (realPatients.length === 0) {
    console.log('\n⚠  Aucun patient avec nom complet disponible.');
    return;
  }

  const slots = [
    // Aujourd'hui
    ...generateSlots(today(),    medecins, realPatients, 7),
    // Demain
    ...generateSlots(tomorrow(), medecins, realPatients, 5),
  ];

  console.log(`\n📝 Création de ${slots.length} nouvelles consultation(s)...`);

  for (const slot of slots) {
    if (DRY_RUN) {
      console.log(`   [DRY] ${slot.date} ${slot.heure} — ${slot.patientId} → Dr. ${slot.medecinId.slice(0, 8)}`);
      continue;
    }
    const created = await prisma.consultation.create({
      data: slot,
      select: { id: true, patientId: true, heure: true, statut: true },
    });
    console.log(`   ✔ #${created.id}  ${created.heure}  ${created.patientId}  ${created.statut}`);
  }
}

function generateSlots(date, medecins, patients, count) {
  const slots = [];
  const heures = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30'];

  for (let i = 0; i < Math.min(count, patients.length); i++) {
    const patient  = patients[i % patients.length];
    const medecin  = medecins[i % medecins.length];
    const heure    = heures[i % heures.length];
    const urgence  = i === 0; // Le premier de chaque jour est urgent
    const isToday  = dateKey(date) === dateKey(today());

    // Statuts variés pour aujourd'hui, EN_ATTENTE pour demain
    let statut = 'EN_ATTENTE';
    if (isToday) {
      if (i === 0) statut = 'EN_COURS';
      else if (i === 1) statut = 'TERMINÉ';
    }

    slots.push({
      patientId: patient.id,
      medecinId: medecin.id,
      date,
      heure,
      motif: MOTIFS[i % MOTIFS.length],
      urgence: urgence && isToday,
      statut,
      termine: statut === 'TERMINÉ',
      arriveeAccueil: isToday && i <= 2,
      arriveeAccueilAt: isToday && i <= 2 ? new Date() : null,
    });
  }

  return slots;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' Nettoyage & seed des consultations CHU');
  console.log(`═══════════════════════════════════════════`);
  console.log(` CHU ID   : ${CHU_ID}`);
  console.log(` Accueil  : ${ACCUEIL_BASE_URL}`);
  console.log(` Mode     : ${DRY_RUN ? 'DRY-RUN (aucune modification)' : 'EXÉCUTION RÉELLE'}`);

  await prisma.$connect();

  // 1. Patients valides
  const patients = await fetchValidPatients();
  const validIds = patients.map(p => p.id);

  // 2. Supprimer les consultations obsolètes
  await cleanStaleConsultations(validIds);

  // 3. Médecins disponibles en base
  const medecins = await prisma.medecin.findMany({
    select: { id: true, nom: true, prenom: true },
  });
  console.log(`\n👨‍⚕️  ${medecins.length} médecin(s) en base : ${medecins.map(m => `Dr. ${m.prenom} ${m.nom}`).join(', ')}`);

  // 4. Créer de nouvelles consultations
  await seedNewConsultations(patients, medecins);

  // 5. Résumé final
  const total = await prisma.consultation.count();
  console.log(`\n✅ Terminé. ${total} consultation(s) actuellement en base.`);
}

main()
  .catch(err => { console.error('\n❌ Erreur :', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
