import { Migration, DatabaseConnection } from '../types';

export const MIGRATION_006_NAME = '006_backup_integrity_hardening';

export const CANONICAL_MIGRATION_CHECKSUMS: Record<number, string> = {
  1: '3401108a03c501e234c0bbee51f6817110ce1e67942561d1d5ecfa6ae2f0a3a7',
  2: 'd68c734ca7da2d4991918ac6941402382995987be06ab2b606a7446451b0dbd5',
  3: 'ae389f82651e5e44ebf6e561e3a6da77802a217f7ad87736f1a6a3bbf7bf3bb9',
  4: 'c2cbb8c3794dbb5879a5ab83321411d63f686fda31036ff44aeff068309d9d9b',
  5: '0d94b86ce2c88b3cde228624342bac28742a96c5dea7eecea735907c832585bd',
  6: 'b7f20e8e2dd800e403dd1026916662436535b9b1fbe53a932e72121e632c59f4',
};

async function applyMigration006(db: DatabaseConnection): Promise<void> {
  // 1. Recreate backup_history to allow updated states
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS backup_history_new (
      id TEXT PRIMARY KEY NOT NULL,
      backup_type TEXT NOT NULL CHECK (backup_type IN ('manual_export', 'pre_restore_safety', 'pre_migration_safety')),
      format_version INTEGER NOT NULL CHECK (typeof(format_version) = 'integer'),
      schema_version INTEGER NOT NULL CHECK (typeof(schema_version) = 'integer'),
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL CHECK (typeof(file_size_bytes) = 'integer'),
      sha256_checksum TEXT NOT NULL,
      record_count INTEGER NOT NULL CHECK (typeof(record_count) = 'integer'),
      status TEXT NOT NULL CHECK (status IN ('created', 'generated', 'share_sheet_returned', 'verified_external_copy', 'exported', 'verified', 'share_cancelled', 'failed')),
      error_code TEXT,
      created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer')
    );
  `);

  // Check if old backup_history exists
  const tableCheck = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='backup_history';"
  );
  if (tableCheck) {
    await db.execAsync('INSERT INTO backup_history_new SELECT * FROM backup_history;');
    await db.execAsync('DROP TABLE backup_history;');
  }
  await db.execAsync('ALTER TABLE backup_history_new RENAME TO backup_history;');

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_backup_history_created_at ON backup_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);
  `);

  // 2. Correctly backfill canonical checksums for migrations 1 through 5
  for (let v = 1; v <= 5; v++) {
    const cs = CANONICAL_MIGRATION_CHECKSUMS[v];
    await db.runAsync(
      'UPDATE schema_migrations SET checksum = ? WHERE version = ?;',
      cs,
      v
    );
  }
}

export const migration006: Migration = {
  version: 6,
  name: MIGRATION_006_NAME,
  up: applyMigration006,
};
