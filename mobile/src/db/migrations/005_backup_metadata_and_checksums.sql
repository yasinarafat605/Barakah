-- 005_backup_metadata_and_checksums.sql
-- Migration 005: Upgrade schema_migrations ledger with checksums and create backup_history metadata table
-- Phase 4: Recovery Foundation — Encrypted Backup and Verified Restore

-- 1. Upgrade schema_migrations table to store SHA-256 checksums
ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;

-- 2. Create backup_history table for auditing local backup creation, verification, and safety snapshots
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
