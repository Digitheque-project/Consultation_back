-- AlterTable
-- seriesId regroupe les occurrences d'un creneau recurrent (Lun/Mer/Ven...)
-- generees comme des lignes independantes - nullable, aucun impact sur les
-- creneaux existants.
ALTER TABLE "planning" ADD COLUMN "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "planning_seriesId_idx" ON "planning"("seriesId");
