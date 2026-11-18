-- Point 4 : le statut et le type de visite deviennent de vraies énumérations.
-- Les valeurs existantes sont d'abord normalisées (« TERMINÉ » accentué écrit
-- par l'ancienne finalisation, valeurs inattendues ramenées selon `termine`).
CREATE TYPE "StatutConsultation" AS ENUM ('EN_ATTENTE', 'EN_COURS', 'EN_ATTENTE_PARACLINIQUE', 'EN_ATTENTE_CONTROLE', 'HOSPITALISE', 'TERMINE', 'REPORTEE');
CREATE TYPE "TypeVisite" AS ENUM ('INITIAL', 'CONTROLE');

UPDATE "consultation" SET "statut" = 'TERMINE' WHERE upper("statut") IN ('TERMINÉ', 'TERMINEE', 'TERMINÉE');
UPDATE "consultation" SET "statut" = CASE WHEN "termine" THEN 'TERMINE' ELSE 'EN_ATTENTE' END
WHERE "statut" NOT IN ('EN_ATTENTE', 'EN_COURS', 'EN_ATTENTE_PARACLINIQUE', 'EN_ATTENTE_CONTROLE', 'HOSPITALISE', 'TERMINE', 'REPORTEE');
ALTER TABLE "consultation" ALTER COLUMN "statut" TYPE "StatutConsultation" USING ("statut"::"StatutConsultation");

UPDATE "consultation" SET "typeVisite" = 'INITIAL' WHERE "typeVisite" IS NULL OR "typeVisite" NOT IN ('INITIAL', 'CONTROLE');
ALTER TABLE "consultation" ALTER COLUMN "typeVisite" DROP DEFAULT;
ALTER TABLE "consultation" ALTER COLUMN "typeVisite" TYPE "TypeVisite" USING ("typeVisite"::"TypeVisite");
ALTER TABLE "consultation" ALTER COLUMN "typeVisite" SET DEFAULT 'INITIAL';

-- Point 5 (RG15) : chaque créneau porte le CHU qui l'a créé.
ALTER TABLE "planning" ADD COLUMN "chuId" TEXT;
CREATE INDEX "planning_chuId_date_idx" ON "planning"("chuId", "date");

-- Point 7 : nom de table corrigé (médicamenteuse), avec ses contraintes.
ALTER TABLE "prescription_non_medicamentaire" RENAME TO "prescription_non_medicamenteuse";
ALTER TABLE "prescription_non_medicamenteuse" RENAME CONSTRAINT "prescription_non_medicamentaire_pkey" TO "prescription_non_medicamenteuse_pkey";
ALTER TABLE "prescription_non_medicamenteuse" RENAME CONSTRAINT "prescription_non_medicamentaire_consultationId_fkey" TO "prescription_non_medicamenteuse_consultationId_fkey";
