-- CreateTable
CREATE TABLE "medecin" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "specialite" TEXT,
    "telephone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medecin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning" (
    "id" SERIAL NOT NULL,
    "medecinId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medecin_email_key" ON "medecin"("email");

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "medecin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning" ADD CONSTRAINT "planning_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "medecin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
