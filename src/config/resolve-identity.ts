// Résout CHU_ID, CONSULTATION_EXTERNE_SERVICE_ID et ACCUEIL_SERVICE_ID
// dynamiquement depuis le registre service-service de la passerelle
// (GET /services), au lieu de les figer en .env — contrairement aux URLs de
// service, ces UUID ne "rotent" jamais (assignés une fois en base, jamais
// suspendus par Render), mais les garder en dur reste une variable de plus
// à maintenir manuellement à chaque nouveau déploiement/CHU.
//
// ⚠️ Ne JAMAIS choisir silencieusement entre plusieurs candidats ambigus, ni
// retomber sur une valeur par défaut périmée en cas d'échec réseau : un
// incident passé (voir le commentaire en tête de assert-env.ts) a déjà été
// causé par une identité de déploiement incorrecte utilisée silencieusement
// — échouer bruyamment au démarrage est le comportement volontaire ici,
// exactement comme pour les variables manquantes.
//
// Exécuté depuis main.ts AVANT l'import dynamique de AppModule, donc avant
// que consultations.service.ts et consorts ne lisent process.env.CHU_ID (et
// consorts) au chargement de leur module — ce fichier écrit directement
// dans process.env, les lectures `process.env.X as string` existantes dans
// le reste du code n'ont besoin d'aucun changement.
import * as jwt from 'jsonwebtoken';

const GATEWAY_URL = process.env.GATEWAY_URL as string;
const JWT_SECRET = process.env.JWT_SECRET as string;

// Noms tels qu'enregistrés dans le registre service-service (voir
// GET /services via la passerelle) — pas une convention à nous, celle du
// registre partagé du CHU.
const OUR_SERVICE_NAME = 'Consultation externe';
const ACCUEIL_SERVICE_NAME = 'Accueil';

type RegistryService = { id: string; name: string; chuId: string };

function fail(message: string): never {
  console.error(`\n❌ Démarrage impossible — ${message}\n`);
  process.exit(1);
}

async function fetchServices(): Promise<RegistryService[]> {
  // Aucun JWT médecin n'existe à ce stade (démarrage du process, avant toute
  // requête) — /services exige un JWT signé par le même secret SSO que les
  // autres services du CHU (vérifié : ni sans token, ni avec SERVICE_API_TOKEN
  // ça ne passe), donc on en signe un nous-mêmes, de très courte durée de
  // vie, seulement pour cet appel de résolution.
  const bootstrapToken = jwt.sign({ userId: 'bootstrap-consultation-externe', role: 'SERVICE' }, JWT_SECRET, {
    expiresIn: '2m',
  });

  const response = await fetch(`${GATEWAY_URL}/services`, {
    headers: { Authorization: `Bearer ${bootstrapToken}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`GET /services a répondu HTTP ${response.status}`);
  }
  return response.json();
}

export async function resolveIdentityEnvVars(): Promise<void> {
  // Repli explicite : si les trois valeurs sont déjà fournies (override
  // manuel, environnement de test/CI sans accès réseau à la passerelle),
  // on ne fait aucun appel et on les utilise telles quelles.
  if (process.env.CHU_ID && process.env.CONSULTATION_EXTERNE_SERVICE_ID && process.env.ACCUEIL_SERVICE_ID) {
    return;
  }

  let services: RegistryService[];
  try {
    services = await fetchServices();
  } catch (err) {
    fail(
      `résolution de l'identité du déploiement (CHU_ID, CONSULTATION_EXTERNE_SERVICE_ID, ACCUEIL_SERVICE_ID) impossible via ${GATEWAY_URL}/services : ${(err as Error).message}\n` +
        `Renseignez CHU_ID, CONSULTATION_EXTERNE_SERVICE_ID et ACCUEIL_SERVICE_ID manuellement en .env pour contourner cette résolution automatique.`,
    );
  }

  const mineMatches = services.filter((s) => s.name === OUR_SERVICE_NAME);
  if (mineMatches.length !== 1) {
    fail(
      `${mineMatches.length} service(s) nommé(s) "${OUR_SERVICE_NAME}" trouvé(s) dans le registre (1 attendu) — ` +
        `impossible de déterminer notre identité sans ambiguïté. Renseignez CONSULTATION_EXTERNE_SERVICE_ID et CHU_ID manuellement en .env.`,
    );
  }
  const mine = mineMatches[0];

  const accueilMatches = services.filter((s) => s.chuId === mine.chuId && s.name === ACCUEIL_SERVICE_NAME);
  if (accueilMatches.length !== 1) {
    fail(
      `${accueilMatches.length} service(s) nommé(s) "${ACCUEIL_SERVICE_NAME}" trouvé(s) pour le CHU ${mine.chuId} (1 attendu). ` +
        `Renseignez ACCUEIL_SERVICE_ID manuellement en .env.`,
    );
  }
  const accueil = accueilMatches[0];

  process.env.CHU_ID = mine.chuId;
  process.env.CONSULTATION_EXTERNE_SERVICE_ID = mine.id;
  process.env.ACCUEIL_SERVICE_ID = accueil.id;

  console.log(
    `🔎  Identité résolue via la passerelle : CHU_ID=${mine.chuId}, CONSULTATION_EXTERNE_SERVICE_ID=${mine.id}, ACCUEIL_SERVICE_ID=${accueil.id}`,
  );
}
