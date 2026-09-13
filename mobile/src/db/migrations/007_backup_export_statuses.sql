-- 007_backup_export_statuses.sql
-- Adds truthful backup export status values: share_sheet_returned, verified_external_copy.
-- Rebuilds backup_history table while preserving all existing records and legacy statuses.

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
