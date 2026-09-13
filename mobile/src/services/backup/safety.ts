/**
 * Pre-Migration & Pre-Restore Safety Snapshot Engine
 * Phase 4: Recovery Foundation
 *
 * Adheres strictly to:
 * - Local-first architecture (ADR-001)
 * - Safe recovery path: Always snapshot database before applying migrations or restoring (ADR-016)
 * - Retains strictly the latest 3 pre-migration snapshots
 * - WAL consistency: Always executes PRAGMA wal_checkpoint(TRUNCATE) before snapshotting
 */

import * as FileSystem from 'expo-file-system/legacy';
import { DatabaseConnection } from '../../db/types';
import { DEFAULT_DATABASE_NAME } from '../../db/client';

const MAX_PRE_MIGRATION_SNAPSHOTS = 3;

/**
 * Gets the safety snapshots directory URI.
 */
export function getSafetyDirectoryUri(): string | null {
  if (!FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}safety_snapshots/`;
}

/**
 * Gets the active database file URI.
 * On Expo SQLite, databases are stored under `documentDirectory/SQLite/`.
 */
export function getActiveDatabaseUri(dbName: string = DEFAULT_DATABASE_NAME): string | null {
  if (!FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}SQLite/${dbName}`;
}

/**
 * Ensures the safety snapshots directory exists.
 */
async function ensureSafetyDirectory(): Promise<string | null> {
  const dir = getSafetyDirectoryUri();
  if (!dir) return null;

  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  } catch {
    return null;
  }
}

/**
 * Prunes pre-migration snapshots, keeping only the latest 3 files.
 */
async function pruneOldPreMigrationSnapshots(safetyDir: string): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(safetyDir);
    const preMigrationFiles = files
      .filter((f) => f.startsWith('pre_migration_') && f.endsWith('.db'))
      .sort(); // Lexicographical sort on timestamp suffix orders oldest first

    while (preMigrationFiles.length > MAX_PRE_MIGRATION_SNAPSHOTS) {
      const oldest = preMigrationFiles.shift();
      if (oldest) {
        await FileSystem.deleteAsync(`${safetyDir}${oldest}`, { idempotent: true });
      }
    }
  } catch {
    // Non-fatal pruning failure
  }
}

/**
 * Checkpoints WAL and creates a pre-migration safety snapshot.
 */
export async function createPreMigrationSafetySnapshot(
  db: DatabaseConnection,
  currentVersion: number
): Promise<string | null> {
  // If not on a real file system (e.g. in-memory test DB), checkpoint WAL and return
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Some mock/test DBs might not support WAL checkpoint pragma
  }

  const safetyDir = await ensureSafetyDirectory();
  const activeDbUri = getActiveDatabaseUri();

  if (!safetyDir || !activeDbUri) {
    return null;
  }

  try {
    const dbInfo = await FileSystem.getInfoAsync(activeDbUri);
    if (!dbInfo.exists) {
      return null;
    }

    const timestamp = Date.now();
    const snapshotName = `pre_migration_v${currentVersion}_${timestamp}.db`;
    const snapshotUri = `${safetyDir}${snapshotName}`;

    await FileSystem.copyAsync({
      from: activeDbUri,
      to: snapshotUri,
    });

    await pruneOldPreMigrationSnapshots(safetyDir);

    // Record in backup_history if table exists
    try {
      await db.runAsync(
        `INSERT INTO backup_history (
          id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
        ) VALUES (?, 'pre_migration_safety', 1, ?, ?, ?, 'snapshot', 0, 'created', NULL, ?);`,
        `snap_mig_${timestamp}`,
        currentVersion,
        snapshotName,
        dbInfo.size ?? 0,
        timestamp
      );
    } catch {
      // backup_history might not exist yet if upgrading from migration 001-004
    }

    return snapshotUri;
  } catch {
    return null;
  }
}

/**
 * Checkpoints WAL and creates a pre-restore safety snapshot before promoting restored data.
 */
export async function createPreRestoreSafetySnapshot(
  db: DatabaseConnection,
  currentVersion: number = 5
): Promise<string | null> {
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Safe fallback
  }

  const safetyDir = await ensureSafetyDirectory();
  const activeDbUri = getActiveDatabaseUri();

  if (!safetyDir || !activeDbUri) {
    return null;
  }

  try {
    const dbInfo = await FileSystem.getInfoAsync(activeDbUri);
    if (!dbInfo.exists) {
      return null;
    }

    const timestamp = Date.now();
    const snapshotName = `barakah_pre_restore_safety_${timestamp}.db`;
    const snapshotUri = `${safetyDir}${snapshotName}`;

    await FileSystem.copyAsync({
      from: activeDbUri,
      to: snapshotUri,
    });

    try {
      await db.runAsync(
        `INSERT INTO backup_history (
          id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
        ) VALUES (?, 'pre_restore_safety', 1, ?, ?, ?, 'snapshot', 0, 'created', NULL, ?);`,
        `snap_restore_${timestamp}`,
        currentVersion,
        snapshotName,
        dbInfo.size ?? 0,
        timestamp
      );
    } catch {
      // Ignore table missing
    }

    return snapshotUri;
  } catch {
    return null;
  }
}
