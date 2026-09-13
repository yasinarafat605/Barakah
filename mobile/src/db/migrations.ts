/**
 * Deterministic Migration Runner for Barakah
 * Tracks applied migrations in `schema_migrations` table.
 */

import { DatabaseConnection, Migration } from './types';
import { migration001 } from './migrations/001_initial_schema';
import { migration002 } from './migrations/002_categories_and_transfers';
import { migration003 } from './migrations/003_debts_and_counterparties';
import { runExclusiveTransaction } from './client';

export const MIGRATIONS: Migration[] = [migration001, migration002, migration003];

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
