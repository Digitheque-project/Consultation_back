-- Migration: utiliser l'UUID du service auth comme PK du medecin
-- Supprime l'Int autoincrement et authUserId, remplace par String UUID

-- 1. Supprimer les contraintes FK
ALTER TABLE "consultation" DROP CONSTRAINT IF EXISTS "consultation_medecinId_fkey";
ALTER TABLE "planning" DROP CONSTRAINT IF EXISTS "planning_medecinId_fkey";

-- 2. Supprimer la PK et l'index unique sur authUserId
ALTER TABLE "medecin" DROP CONSTRAINT IF EXISTS "medecin_pkey";
ALTER TABLE "medecin" DROP CONSTRAINT IF EXISTS "medecin_authUserId_key";

-- 3. Ajouter colonne texte new_id = authUserId sur medecin
ALTER TABLE "medecin" ADD COLUMN "new_id" TEXT;
UPDATE "medecin" SET "new_id" = "authUserId";
DELETE FROM "medecin" WHERE "new_id" IS NULL;

-- 4. Migrer consultation.medecinId (Int → String via join)
ALTER TABLE "consultation" ADD COLUMN "new_medecinId" TEXT;
UPDATE "consultation" c
SET "new_medecinId" = m."authUserId"
FROM "medecin" m
WHERE m.id = c."medecinId";

-- 5. Migrer planning.medecinId (Int → String via join)
ALTER TABLE "planning" ADD COLUMN "new_medecinId" TEXT;
UPDATE "planning" p
SET "new_medecinId" = m."authUserId"
FROM "medecin" m
WHERE m.id = p."medecinId";

-- 6. Remplacer les colonnes Int par les colonnes String dans consultation
ALTER TABLE "consultation" DROP COLUMN "medecinId";
ALTER TABLE "consultation" RENAME COLUMN "new_medecinId" TO "medecinId";
ALTER TABLE "consultation" ALTER COLUMN "medecinId" SET NOT NULL;

-- 7. Remplacer les colonnes Int par les colonnes String dans planning
ALTER TABLE "planning" DROP COLUMN "medecinId";
ALTER TABLE "planning" RENAME COLUMN "new_medecinId" TO "medecinId";

-- 8. Remplacer id et supprimer authUserId dans medecin
ALTER TABLE "medecin" DROP COLUMN "id";
ALTER TABLE "medecin" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "medecin" DROP COLUMN IF EXISTS "authUserId";
ALTER TABLE "medecin" ADD PRIMARY KEY ("id");

-- 9. Restaurer les FK
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_medecinId_fkey"
  FOREIGN KEY ("medecinId") REFERENCES "medecin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "planning" ADD CONSTRAINT "planning_medecinId_fkey"
  FOREIGN KEY ("medecinId") REFERENCES "medecin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. Restaurer l'index planning
DROP INDEX IF EXISTS "planning_medecinId_date_idx";
CREATE INDEX "planning_medecinId_date_idx" ON "planning"("medecinId", "date");
