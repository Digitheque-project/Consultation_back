#!/bin/sh
# Applique les migrations Prisma en attente puis démarre le serveur.
# Sur une base fraîche (nouveau déploiement CHU), applique tout l'historique
# des migrations dans l'ordre ; sur une base existante, seulement celles
# qui manquent. Échoue bruyamment (set -e) si les migrations échouent —
# mieux vaut un conteneur qui ne démarre pas qu'un serveur tournant sur un
# schéma incohérent.
set -e

echo "→ Application des migrations Prisma..."
npx prisma migrate deploy

echo "→ Démarrage du serveur..."
exec node dist/main.js
