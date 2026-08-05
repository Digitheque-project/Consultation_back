/*
  Warnings:

  - You are about to drop the `prescription_medicamentaire` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "prescription_medicamentaire" DROP CONSTRAINT "prescription_medicamentaire_consultationId_fkey";

-- DropTable
DROP TABLE "prescription_medicamentaire";
