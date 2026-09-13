/**
 * Deterministic Migration Runner for Barakah
 * Tracks applied migrations in `schema_migrations` table.
 */

import { DatabaseConnection, Migration } from './types';
import { migration001 } from './migrations/001_initial_schema';
import { migration002 } from './migrations/002_categories_and_transfers';
import { migration003 } from './migrations/003_debts_and_counterparties';
import { migration004 } from './migrations/004_debt_ledger_integrity_upgrade';
import { migration005, MIGRATION_CHECKSUMS } from './migrations/005_backup_metadata_and_checksums';
import { runExclusiveTransaction } from './client';
import { createPreMigrationSafetySnapshot } from '../services/backup/safety';

export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];

export interface MigrationResult {
  applied: number;
  versions: number[];
}

export async function runMigrations(db: DatabaseConnection): Promise<MigrationResult> {
  // Ensure schema_migrations ledger table exists
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // Fetch currently applied migrations
  const appliedRows = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC;'
  );
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const newlyApplied: number[] = [];
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.version)).sort((a, b) => a.version - b.version);

  // If there is existing data and pending migrations, create a pre-migration safety snapshot first
  if (pending.length > 0 && appliedRows.length > 0) {
    const latestApplied = Math.max(...appliedRows.map((r) => r.version));
    await createPreMigrationSafetySnapshot(db, latestApplied);
  }

  for (const migration of pending) {
    await runExclusiveTransaction(db, async () => {
      await migration.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
        migration.version,
        migration.name,
        Date.now()
      );
    });
    newlyApplied.push(migration.version);
  }

  // Backfill checksums for newly applied migrations
  try {
    for (const version of newlyApplied) {
      const cs = MIGRATION_CHECKSUMS[version];
      if (cs) {
        await db.runAsync(
          "UPDATE schema_migrations SET checksum = ? WHERE version = ? AND (checksum IS NULL OR checksum = '');",
          cs,
          version
        );
      }
    }
  } catch {
    // Ignore if column doesn't exist yet
  }

  return {
    applied: newlyApplied.length,
    versions: newlyApplied,
  };
}

export async function getAppliedMigrations(
  db: DatabaseConnection
): Promise<{ version: number; name: string; applied_at: number }[]> {
  try {
    return await db.getAllAsync<{ version: number; name: string; applied_at: number }>(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC;'
    );
  } catch {
    return [];
  }
}
