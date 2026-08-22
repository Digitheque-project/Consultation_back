// Doit rester le tout premier import de main.ts : ce fichier s'exécute avant
// que AppModule (et les URLs de services externes qu'il importe en cascade)
// ne soit chargé, pour échouer au démarrage avec la liste complète des
// variables manquantes plutôt que de démarrer silencieusement sur une
// URL codée en dur potentiellement obsolète (cf. incident CHU_ID).
//
// On charge .env nous-mêmes ici : ConfigModule (qui fait la même chose) ne
// s'exécute qu'au chargement de AppModule, donc après ce fichier. En prod
// (Render/Proxmox), les variables sont déjà injectées dans process.env et
// cet appel est un no-op sans effet.
import { config as loadDotenv } from 'dotenv';
loadDotenv();

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SERVICE_API_TOKEN',
  'GATEWAY_URL',
  'AUTH_USER_SERVICE_URL',
  'NOTIFICATION_URL',
  'CHU_ID',
  'CONSULTATION_EXTERNE_SERVICE_ID',
  'ACCUEIL_SERVICE_ID',
] as const;

const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error("\n❌ Démarrage impossible — variables d'environnement manquantes :");
  for (const name of missing) console.error(`   - ${name}`);
  console.error('\nRenseignez-les (fichier .env local, Render, ou futur Proxmox) avant de relancer le service.\n');
  process.exit(1);
}
