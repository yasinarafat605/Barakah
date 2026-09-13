import { Migration, DatabaseConnection } from '../types';

export const MIGRATION_005_NAME = '005_backup_metadata_and_checksums';

/**
 * Deterministic checksum signatures for migrations 001 through 005.
 * Computed from canonical identifiers.
 */
export const MIGRATION_CHECKSUMS: Record<number, string> = {
  1: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  2: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03',
  3: '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da',
  4: 'c64a30a1089907f168f1883bfd1182fb067204439c2ff1ee38ad5c866f8e7b39',
  5: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
};

async function applyMigration005(db: DatabaseConnection): Promise<void> {
  // Check if checksum column already exists on schema_migrations
  const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(schema_migrations);');
  const hasChecksumCol = tableInfo.some((col) => col.name === 'checksum');

  if (!hasChecksumCol) {
    await db.execAsync('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');
  }

  // Create backup_history table and indexes
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS backup_history (
      id TEXT PRIMARY KEY NOT NULL,
      backup_type TEXT NOT NULL CHECK (backup_type IN ('manual_export', 'pre_restore_safety', 'pre_migration_safety')),
      format_version INTEGER NOT NULL CHECK (typeof(format_version) = 'integer'),
      schema_version INTEGER NOT NULL CHECK (typeof(schema_version) = 'integer'),
      file_name TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL CHECK (typeof(file_size_bytes) = 'integer'),
      sha256_checksum TEXT NOT NULL,
      record_count INTEGER NOT NULL CHECK (typeof(record_count) = 'integer'),
      status TEXT NOT NULL CHECK (status IN ('created', 'verified', 'failed')),
      error_code TEXT,
      created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer')
    );

    CREATE INDEX IF NOT EXISTS idx_backup_history_created_at ON backup_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);
  `);

  // Backfill checksums for existing rows in schema_migrations
  for (const [versionStr, checksum] of Object.entries(MIGRATION_CHECKSUMS)) {
    const version = Number(versionStr);
    await db.runAsync(
      "UPDATE schema_migrations SET checksum = ? WHERE version = ? AND (checksum IS NULL OR checksum = '');",
      checksum,
      version
    );
  }
}

export const migration005: Migration = {
  version: 5,
  name: MIGRATION_005_NAME,
  up: applyMigration005,
};
