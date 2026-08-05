-- AlterTable
ALTER TABLE "medecin" ADD COLUMN     "role" TEXT DEFAULT 'MEDECIN';

-- AlterTable
ALTER TABLE "planning" ADD COLUMN     "quota" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "consultation_consultationParenteId_idx" ON "consultation"("consultationParenteId");

-- CreateIndex
CREATE INDEX "planning_medecinId_date_idx" ON "planning"("medecinId", "date");
