-- CreateEnum
CREATE TYPE "RDVNiveau" AS ENUM ('NIVEAU_1', 'NIVEAU_2', 'NIVEAU_3', 'NIVEAU_4');

-- CreateEnum
CREATE TYPE "ExamPriorite" AS ENUM ('STAT', 'URGENTE', 'NORMALE');

-- CreateEnum
CREATE TYPE "HospitalisationStatus" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REFUSE');

-- CreateTable
CREATE TABLE "consultation" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heure" TEXT NOT NULL,
    "patientId" INTEGER NOT NULL,
    "medecinId" INTEGER NOT NULL,
    "statut" TEXT NOT NULL,
    "urgence" BOOLEAN NOT NULL DEFAULT false,
    "termine" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_medicale" (
    "id" SERIAL NOT NULL,
    "consultationId" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,
    "diagnostic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observation_medicale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_medicamentaire" (
    "id" SERIAL NOT NULL,
    "consultationId" INTEGER NOT NULL,
    "medicament" TEXT NOT NULL,
    "forme" TEXT,
    "dosage" TEXT,
    "voie" TEXT,
    "posologie" TEXT,
    "duree" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_medicamentaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_non_medicamentaire" (
    "id" SERIAL NOT NULL,
    "consultationId" INTEGER NOT NULL,
    "recommandationsNotes" TEXT,
    "rdvMotif" TEXT,
    "rdvNiveau" "RDVNiveau",
    "rdvDate" TIMESTAMP(3),
    "examenService" TEXT,
    "examenType" TEXT,
    "examenPriorite" "ExamPriorite" DEFAULT 'NORMALE',
    "hospitalisationMotif" TEXT,
    "hospitalisationService" TEXT,
    "hospitalisationStatus" "HospitalisationStatus" DEFAULT 'EN_ATTENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_non_medicamentaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observation_medicale_consultationId_key" ON "observation_medicale"("consultationId");

-- AddForeignKey
ALTER TABLE "observation_medicale" ADD CONSTRAINT "observation_medicale_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_medicamentaire" ADD CONSTRAINT "prescription_medicamentaire_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_non_medicamentaire" ADD CONSTRAINT "prescription_non_medicamentaire_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
