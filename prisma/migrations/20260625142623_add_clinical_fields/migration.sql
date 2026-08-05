-- AlterTable
ALTER TABLE "observation_medicale" ADD COLUMN     "diagnosticRetenu" TEXT,
ADD COLUMN     "diagnosticSuspicion" TEXT;

-- AlterTable
ALTER TABLE "prescription_non_medicamentaire" ADD COLUMN     "reponseDate" TIMESTAMP(3),
ADD COLUMN     "reponseNotes" TEXT,
ADD COLUMN     "reponseStatus" TEXT DEFAULT 'EN_ATTENTE';

-- CreateTable
CREATE TABLE "parametre_clinique" (
    "id" SERIAL NOT NULL,
    "consultationId" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "unite" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametre_clinique_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "parametre_clinique" ADD CONSTRAINT "parametre_clinique_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
