-- AlterTable: add control context fields to consultation
ALTER TABLE "consultation"
ADD COLUMN "typeVisite" TEXT NOT NULL DEFAULT 'INITIAL',
ADD COLUMN "ordreControle" INTEGER,
ADD COLUMN "consultationParenteId" INTEGER;

-- AddForeignKey
ALTER TABLE "consultation"
ADD CONSTRAINT "consultation_consultationParenteId_fkey"
FOREIGN KEY ("consultationParenteId") REFERENCES "consultation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
