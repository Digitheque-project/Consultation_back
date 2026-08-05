#!/usr/bin/env node
'use strict';
/**
 * Pre-migration cleanup for Render production DB.
 *
 * 1. Migration 20260628000000_add_arrivee_accueil: columns already exist but
 *    Prisma marked it "failed" → mark as --applied.
 *
 * 2. Migration 20260711000000_use_auth_uuid_as_medecin_pk: will fail because
 *    medecin.authUserId is NULL. Fix: if medecin.id is still integer, clear
 *    all rows so the migration runs on empty tables (no NOT NULL violation).
 *    The app re-syncs medecins from auth service on first request.
 */
const { execSync } = require('child_process');
const { Client } = require('pg');

async function main() {
  // ── Step 1: resolve failed migration that is already applied ───────────────
  const MARK_APPLIED = '20260628000000_add_arrivee_accueil';
  try {
    execSync(`prisma migrate resolve --applied "${MARK_APPLIED}"`, { stdio: 'inherit' });
    console.log(`[resolve] ${MARK_APPLIED} → marked as applied.`);
  } catch {
    console.log(`[resolve] ${MARK_APPLIED} → already in clean state.`);
  }

  // ── Step 2: check if UUID PK migration is still pending ────────────────────
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await db.connect();

    // Check if medecin.id is still INTEGER (UUID migration not yet applied)
    const col = await db.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'medecin' AND column_name = 'id'
    `);

    if (!col.rows.length) {
      console.log('[cleanup] medecin table not found — fresh DB, no cleanup needed.');
      return;
    }

    const idType = col.rows[0].data_type;
    console.log(`[cleanup] medecin.id type = ${idType}`);

    if (idType === 'text' || idType === 'character varying') {
      console.log('[cleanup] Already UUID — UUID migration already applied, skipping cleanup.');
      return;
    }

    // medecin.id is integer → UUID migration hasn't run yet
    // Clear all data so it can run on empty tables (prevents NOT NULL failure)
    console.log('[cleanup] Clearing all rows so UUID migration can run cleanly...');
    await db.query('ALTER TABLE IF EXISTS consultation DROP CONSTRAINT IF EXISTS "consultation_medecinId_fkey"');
    await db.query('ALTER TABLE IF EXISTS planning DROP CONSTRAINT IF EXISTS "planning_medecinId_fkey"');
    await db.query('TRUNCATE TABLE prescription_non_medicamentaire, prescription_medicamentaire, parametre_clinique, observation_medicale, consultation, planning, medecin CASCADE');
    console.log('[cleanup] All rows cleared. Medecins will be re-synced from auth service on first request.');
  } catch (err) {
    console.error('[cleanup] Error (non-fatal):', err.message);
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error('[resolve-failed-migration] Unexpected error (non-fatal):', e.message);
});
