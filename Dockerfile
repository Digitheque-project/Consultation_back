# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Backend consultation externe — image de production (NestJS + Prisma).
#
# Contrairement au frontend, ces variables sont lues au RUNTIME (pas
# besoin de --build-arg) : fournissez-les via `docker run -e` ou
# `--env-file` (voir .env.example pour la liste complète, exigée par
# src/config/assert-env.ts au démarrage).
#
# Build :
#   docker build -t chu-backend .
#
# Run (les migrations Prisma s'appliquent automatiquement au démarrage,
# voir docker-entrypoint.sh) :
#   docker run -p 3333:3333 --env-file .env chu-backend
# ─────────────────────────────────────────────────────────────────────────

# ── Étape 1 : dépendances ───────────────────────────────────────────────
# build-essential/python3 : nécessaires pour compiler le module natif
# bcrypt si aucun binaire précompilé n'est disponible pour la plateforme
# cible — retirés dans l'image finale (étape "runner").
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ── Étape 2 : build ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# openssl : requis pour que Prisma détecte la bonne version de libssl et
# choisisse le bon moteur de requête — sans ça il se rabat sur
# "openssl-1.1.x" alors que bookworm fournit openssl 3.0.x, ce qui plante
# au runtime ("Unable to require query engine").
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate n'a besoin que du schéma, pas d'une base de données —
# volontairement PAS de "prisma migrate deploy" ici : l'image doit rester
# buildable sans accès réseau à la base de données de destination. Les
# migrations s'appliquent au démarrage du conteneur (docker-entrypoint.sh).
RUN npx prisma generate
RUN npx nest build
RUN node scripts/postbuild.cjs

# ── Étape 3 : image de production ────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Le moteur de requête Prisma est lié dynamiquement à libssl au runtime,
# pas seulement au moment de "prisma generate" — sans openssl ici, le
# conteneur démarre puis plante à la première requête base de données.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nestjs \
 && useradd --system --uid 1001 --gid nestjs nestjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R nestjs:nestjs /app

USER nestjs
EXPOSE 3333

ENTRYPOINT ["./docker-entrypoint.sh"]
