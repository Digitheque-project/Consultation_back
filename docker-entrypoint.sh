#!/bin/sh
# Applique les migrations Prisma en attente puis démarre le serveur.
# Sur une base fraîche (nouveau déploiement CHU), applique tout l'historique
# des migrations dans l'ordre ; sur une base existante, seulement celles
# qui manquent.
set -e

# Nombre de tentatives avant d'abandonner les migrations. Sert surtout au
# démarrage groupé (docker compose) : le conteneur applicatif démarre souvent
# avant que PostgreSQL n'accepte les connexions. Sans ces tentatives, le
# conteneur mourait immédiatement sur une simple course au démarrage.
MIGRATION_ATTEMPTS="${MIGRATION_ATTEMPTS:-10}"
MIGRATION_DELAY="${MIGRATION_DELAY:-5}"

attempt=1
migrations_ok=0
while [ "$attempt" -le "$MIGRATION_ATTEMPTS" ]; do
  echo "→ Application des migrations Prisma (tentative $attempt/$MIGRATION_ATTEMPTS)..."
  if npx prisma migrate deploy; then
    migrations_ok=1
    break
  fi
  echo "  Base indisponible ou migration en échec — nouvelle tentative dans ${MIGRATION_DELAY}s."
  attempt=$((attempt + 1))
  sleep "$MIGRATION_DELAY"
done

if [ "$migrations_ok" -ne 1 ]; then
  # On démarre quand même, volontairement. Un conteneur qui refuse de
  # démarrer est totalement muet : ni /health, ni logs applicatifs, rien à
  # interroger à distance — panne constatée en production, impossible à
  # diagnostiquer autrement qu'en lisant les logs de la plateforme.
  # En démarrant, /health répond 503 (donc "unhealthy" pour l'orchestrateur)
  # et le service se rétablit tout seul dès que la base revient.
  echo "!!! ATTENTION : migrations NON appliquées après $MIGRATION_ATTEMPTS tentatives."
  echo "!!! Démarrage en mode dégradé — /health renverra 503 tant que la base"
  echo "!!! ne répond pas. Vérifiez DATABASE_URL et l'état du serveur PostgreSQL."
fi

echo "→ Démarrage du serveur..."
exec node dist/main.js
