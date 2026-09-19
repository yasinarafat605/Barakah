/**
 * Deterministic Migration Runner for Barakah
 * Tracks applied migrations in `schema_migrations` table.
 */

import { DatabaseConnection, Migration } from './types';
import { migration001 } from './migrations/001_initial_schema';
import { migration002 } from './migrations/002_categories_and_transfers';
import { migration003 } from './migrations/003_debts_and_counterparties';
import { migration004 } from './migrations/004_debt_ledger_integrity_upgrade';
import { migration005 } from './migrations/005_backup_metadata_and_checksums';
import { migration006 } from './migrations/006_backup_integrity_hardening';
import { migration007 } from './migrations/007_backup_export_statuses';
import { migration008 } from './migrations/008_planning_foundation';
import { migration009 } from './migrations/009_planning_integrity_corrections';
import { CANONICAL_MIGRATION_CHECKSUMS } from './migrations/registry';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { runExclusiveTransaction } from './client';
import { createPreMigrationSafetySnapshot } from '../services/backup/safety';

export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
];

export interface MigrationResult {
  applied: number;
  versions: number[];
}

export async function runMigrations(db: DatabaseConnection): Promise<MigrationResult> {
  // 1. Read existing migration state WITHOUT altering or mutating the schema
  const tableCheck = await db.getFirstAsync<{ c: number }>(
    "SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='schema_migrations';"
  );
  const tableExists = (tableCheck?.c ?? 0) > 0;

  let appliedRows: { version: number; checksum?: string | null }[] = [];
  if (tableExists) {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(schema_migrations);');
    const hasChecksum = cols.some((c) => c.name === 'checksum');
    if (hasChecksum) {
      appliedRows = await db.getAllAsync<{ version: number; checksum?: string | null }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
      );
    } else {
      appliedRows = await db.getAllAsync<{ version: number; checksum?: string | null }>(
        'SELECT version, NULL as checksum FROM schema_migrations ORDER BY version ASC;'
      );
    }
  }

  const appliedSet = new Set(appliedRows.map((r) => r.version));
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.version)).sort((a, b) => a.version - b.version);

  // 2. Take the pre-migration safety snapshot BEFORE any schema alterations (fail closed)
  if (
    pending.length > 0 &&
    appliedRows.length > 0 &&
    Platform.OS !== 'web' &&
    Boolean(FileSystem.documentDirectory)
  ) {
    const latestApplied = Math.max(...appliedRows.map((r) => r.version));
    await createPreMigrationSafetySnapshot(db, latestApplied);
  }

  // 3. ONLY AFTER the safety snapshot: ensure schema_migrations table and columns exist
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  try {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(schema_migrations);');
    if (!cols.some((c) => c.name === 'checksum')) {
      await db.execAsync('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');
    }
  } catch {
    // Column check fallback
  }

  // 4. If Migration 006 was already applied, verify all existing checksums on startup
  if (appliedSet.has(6)) {
    for (const r of appliedRows) {
      const expected = CANONICAL_MIGRATION_CHECKSUMS[r.version];
      if (expected && r.checksum && r.checksum !== expected) {
        throw new Error(
          `MIGRATION_ERR_CHECKSUM_MISMATCH: Applied migration ${r.version} checksum mismatch. Expected ${expected}, got ${r.checksum}`
        );
      }
    }
  }

  const newlyApplied: number[] = [];
  for (const migration of pending) {
    await runExclusiveTransaction(db, async (txn) => {
      await migration.up(txn);
      const cs = CANONICAL_MIGRATION_CHECKSUMS[migration.version] ?? null;
      await txn.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?);',
        migration.version,
        migration.name,
        Date.now(),
        cs
      );
    });
    newlyApplied.push(migration.version);
  }

  // Final post-migration verification if migration 006 is now applied
  const finalApplied = await db.getAllAsync<{ version: number; checksum?: string | null }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
  );
  const finalSet = new Set(finalApplied.map((r) => r.version));
  if (finalSet.has(6)) {
    for (const r of finalApplied) {
      const expected = CANONICAL_MIGRATION_CHECKSUMS[r.version];
      if (expected && r.checksum !== expected) {
        throw new Error(
          `MIGRATION_ERR_CHECKSUM_MISMATCH: Migration ${r.version} checksum mismatch after applying migrations. Expected ${expected}, got ${r.checksum}`
        );
      }
    }
  }

  return {
    applied: newlyApplied.length,
    versions: newlyApplied,
  };
}

export async function getAppliedMigrations(
  db: DatabaseConnection
): Promise<{ version: number; name: string; applied_at: number; checksum?: string | null }[]> {
  try {
    return await db.getAllAsync<{ version: number; name: string; applied_at: number; checksum?: string | null }>(
      'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;'
    );
  } catch {
    return [];
  }
}
