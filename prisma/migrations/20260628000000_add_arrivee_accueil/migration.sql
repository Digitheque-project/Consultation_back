-- Add arrival tracking fields to consultation
ALTER TABLE "consultation"
ADD COLUMN "arriveeAccueil" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "arriveeAccueilAt" TIMESTAMP(3);
