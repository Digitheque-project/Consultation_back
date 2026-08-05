/*
  Warnings:

  - Made the column `medecinId` on table `planning` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "medecin" ADD COLUMN     "chuId" TEXT;

-- AlterTable
ALTER TABLE "planning" ALTER COLUMN "medecinId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "medecin_chuId_idx" ON "medecin"("chuId");
