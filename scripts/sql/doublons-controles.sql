-- =============================================================================
-- Contrôles en double (corrigé dans le code le 20/11/2026, commit 309fce0) :
-- plusieurs contrôles « en attente » créés depuis la même consultation.
-- À lancer dans l'éditeur SQL de la base du service Consultation.
--
-- Contrôle gardé pour chaque consultation d'origine, dans cet ordre :
--   1. celui qui contient déjà des données (consultation commencée) ;
--   2. sinon celui dont l'arrivée a été confirmée par l'Accueil ;
--   3. sinon le plus récemment modifié (dernière planification par l'Accueil).
-- Les autres ne sont supprimés QUE s'ils sont vides : ni observation, ni
-- paramètre, ni demande, ni consultation rattachée. Sinon « à examiner ».
-- =============================================================================

-- 1. LISTE (ne modifie rien) ---------------------------------------------------
WITH base AS (
  SELECT c.*, (EXISTS (SELECT 1 FROM observation_medicale o WHERE o."consultationId" = c.id)
          OR EXISTS (SELECT 1 FROM parametre_clinique p WHERE p."consultationId" = c.id)
          OR EXISTS (SELECT 1 FROM prescription_non_medicamenteuse n WHERE n."consultationId" = c.id)
          OR EXISTS (SELECT 1 FROM consultation e WHERE e."consultationParenteId" = c.id)) AS a_du_contenu
    FROM consultation c
   WHERE c."typeVisite" = 'CONTROLE' AND c.termine = false AND c."consultationParenteId" IS NOT NULL
), attente AS (
  SELECT b.*,
         row_number() OVER (PARTITION BY b."consultationParenteId"
                            ORDER BY b.a_du_contenu DESC, b."arriveeAccueil" DESC, b."updatedAt" DESC, b.id DESC) AS rang,
         count(*) OVER (PARTITION BY b."consultationParenteId") AS nb
    FROM base b
)
SELECT "consultationParenteId" AS consultation_origine, id, "patientId", "ordreControle",
       to_char(date, 'DD/MM/YYYY') AS date_prevue, heure, statut, "arriveeAccueil", motif,
       CASE WHEN rang = 1 THEN 'GARDÉ'
            WHEN a_du_contenu THEN 'à examiner (contient des données)'
            ELSE 'à supprimer' END AS decision
  FROM attente
 WHERE nb > 1
 ORDER BY "consultationParenteId", rang;

-- 2. SUPPRESSION (après lecture de la liste) ----------------------------------
-- Tout ou rien : décommenter les lignes ci-dessous et exécuter ce bloc seul.
-- BEGIN;
-- WITH attente AS (
--   SELECT c.id,
--          row_number() OVER (PARTITION BY c."consultationParenteId"
--                             ORDER BY (EXISTS (SELECT 1 FROM observation_medicale o WHERE o."consultationId" = c.id)
--                                       OR EXISTS (SELECT 1 FROM parametre_clinique p WHERE p."consultationId" = c.id)
--                                       OR EXISTS (SELECT 1 FROM prescription_non_medicamenteuse n WHERE n."consultationId" = c.id)
--                                       OR EXISTS (SELECT 1 FROM consultation e WHERE e."consultationParenteId" = c.id)) DESC,
--                                      c."arriveeAccueil" DESC, c."updatedAt" DESC, c.id DESC) AS rang,
--          count(*) OVER (PARTITION BY c."consultationParenteId") AS nb
--     FROM consultation c
--    WHERE c."typeVisite" = 'CONTROLE' AND c.termine = false AND c."consultationParenteId" IS NOT NULL
-- )
-- DELETE FROM consultation c
--  USING attente a
--  WHERE c.id = a.id AND a.nb > 1 AND a.rang > 1
--    AND NOT EXISTS (SELECT 1 FROM observation_medicale o WHERE o."consultationId" = c.id)
--    AND NOT EXISTS (SELECT 1 FROM parametre_clinique p WHERE p."consultationId" = c.id)
--    AND NOT EXISTS (SELECT 1 FROM prescription_non_medicamenteuse n WHERE n."consultationId" = c.id)
--    AND NOT EXISTS (SELECT 1 FROM consultation e WHERE e."consultationParenteId" = c.id)
-- RETURNING c.id, c."patientId", to_char(c.date, 'DD/MM/YYYY') AS date_prevue, c.motif;
-- COMMIT;
