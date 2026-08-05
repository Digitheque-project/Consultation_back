-- CreateTable
-- Cache local en lecture seule pour l'affichage de la liste des medecins.
-- Aucune cle etrangere ne pointe vers cette table (contrairement a l'ancienne
-- table "medecin") : elle peut etre videe et reconstruite sans impact.
CREATE TABLE "medecin_cache" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "specialite" TEXT,
    "telephone" TEXT,
    "role" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medecin_cache_pkey" PRIMARY KEY ("id")
);
