-- 006_backup_integrity_hardening.sql
-- Hardens backup metadata audit ledger and backfills canonical migration checksums.
-- Enforces true backup lifecycle states: generated, exported, verified, share_cancelled, failed.

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

INSERT INTO backup_history_new SELECT * FROM backup_history;
DROP TABLE backup_history;
ALTER TABLE backup_history_new RENAME TO backup_history;

CREATE INDEX IF NOT EXISTS idx_backup_history_created_at ON backup_history(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);

UPDATE schema_migrations SET checksum = '3401108a03c501e234c0bbee51f6817110ce1e67942561d1d5ecfa6ae2f0a3a7' WHERE version = 1;
UPDATE schema_migrations SET checksum = 'd68c734ca7da2d4991918ac6941402382995987be06ab2b606a7446451b0dbd5' WHERE version = 2;
UPDATE schema_migrations SET checksum = 'ae389f82651e5e44ebf6e561e3a6da77802a217f7ad87736f1a6a3bbf7bf3bb9' WHERE version = 3;
UPDATE schema_migrations SET checksum = 'c2cbb8c3794dbb5879a5ab83321411d63f686fda31036ff44aeff068309d9d9b' WHERE version = 4;
UPDATE schema_migrations SET checksum = '0d94b86ce2c88b3cde228624342bac28742a96c5dea7eecea735907c832585bd' WHERE version = 5;
