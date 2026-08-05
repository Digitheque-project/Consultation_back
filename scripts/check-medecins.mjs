import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Test de connexion
    const medecins = await prisma.medecin.findMany({
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        specialite: true,
      },
      take: 10,
    });

    console.log('✅ MÉDECINS TROUVÉS:', medecins.length);
    if (medecins.length > 0) {
      console.log(JSON.stringify(medecins, null, 2));
    } else {
      console.log('⚠️  Aucun médecin en base de données');
    }

    // Test: vérifier la structure de Planning
    const planning = await prisma.planning.findMany({
      take: 1,
      select: {
        id: true,
        medecinId: true,
        quota: true,
        date: true,
        heureDebut: true,
        heureFin: true,
      },
    });

    console.log('✅ PLANNING OK - Colonne quota accessible');
  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
