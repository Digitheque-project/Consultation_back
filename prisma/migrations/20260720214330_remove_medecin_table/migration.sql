/*
  Warnings:

  - You are about to drop the `medecin` table. medecinId on consultation and
    planning becomes a plain external-reference string (same treatment as
    patientId) — no local duplication of doctor data, no foreign key.
    If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "consultation" DROP CONSTRAINT "consultation_medecinId_fkey";

-- DropForeignKey
ALTER TABLE "planning" DROP CONSTRAINT "planning_medecinId_fkey";

-- DropTable
DROP TABLE "medecin";
