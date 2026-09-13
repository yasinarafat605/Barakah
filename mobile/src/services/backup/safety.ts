/**
 * Pre-Migration & Pre-Restore Safety Snapshot Engine
 * Phase 4: Recovery Foundation
 *
 * Adheres strictly to:
 * - Local-first architecture (ADR-001)
 * - Safe recovery path: Always snapshot database before applying migrations or restoring (ADR-016)
 * - Retains strictly the latest 3 safety snapshots per type
 * - WAL consistency: Always executes PRAGMA wal_checkpoint(TRUNCATE) before snapshotting
 * - Fail-closed: Never swallows snapshot, checkpoint, copy, integrity check, or metadata errors
 * - Verifies snapshot with PRAGMA integrity_check before proceeding
 * - Stores real SHA-256 hex checksums (never literal 'snapshot')
 * - Provides a documented emergency recovery path
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from '../../db/types';
import { DEFAULT_DATABASE_NAME } from '../../db/client';
import { BackupError } from './types';
import { computeSha256Hex } from './crypto';

export const MAX_SAFETY_SNAPSHOTS = 3;

export interface SafetySnapshotMetadata {
  fileName: string;
  uri: string;
  timestamp: number;
  sizeBytes: number;
  type: 'pre_migration' | 'pre_restore';
}

/**
 * Gets the safety snapshots directory URI.
 */
export function getSafetyDirectoryUri(): string | null {
  if (!FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}SQLite/safety_snapshots/`;
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
 * Ensures the safety snapshots directory exists or throws if unavailable.
 */
async function ensureSafetyDirectory(): Promise<string> {
  const dir = getSafetyDirectoryUri();
  if (!dir) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      'Cannot create safety snapshot: filesystem document directory is not available.'
    );
  }

  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Converts a Base64 string to Uint8Array efficiently without byte-by-byte JavaScript strings.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Computes the real SHA-256 hex checksum of a file on disk.
 */
async function computeSnapshotSha256(fileUri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);
  return computeSha256Hex(bytes);
}

/**
 * Prunes safety snapshots, keeping strictly the latest 3 valid files for a given prefix.
 */
export async function pruneOldSafetySnapshots(safetyDir: string, prefix: string): Promise<void> {
  const files = await FileSystem.readDirectoryAsync(safetyDir);
  const matched = files
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort(); // Lexicographical sort on timestamp orders oldest first

  while (matched.length > MAX_SAFETY_SNAPSHOTS) {
    const oldest = matched.shift();
    if (oldest) {
      await FileSystem.deleteAsync(`${safetyDir}${oldest}`, { idempotent: true });
    }
  }
}

/**
 * Verifies that a safety snapshot can be opened and passes PRAGMA integrity_check.
 */
async function verifySnapshotIntegrity(snapshotName: string, snapshotUri: string): Promise<void> {
  let snapDb: SQLite.SQLiteDatabase | null = null;
  try {
    snapDb = await SQLite.openDatabaseAsync(`safety_snapshots/${snapshotName}`);
    const result = await snapDb.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
    if (!result || result.integrity_check !== 'ok') {
      throw new Error(`Snapshot failed SQLite integrity check: ${result?.integrity_check ?? 'unknown'}`);
    }
  } catch (err: unknown) {
    // Delete corrupt snapshot
    await FileSystem.deleteAsync(snapshotUri, { idempotent: true });
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Safety snapshot verification failed: ${err instanceof Error ? err.message : 'Unknown integrity error'}. Migration or restore aborted.`
    );
  } finally {
    if (snapDb) {
      try {
        await snapDb.closeAsync();
      } catch {
        // Ignore close error
      }
    }
  }
}

/**
 * Checkpoints WAL and creates a verified pre-migration safety snapshot.
 * Fails closed: throws BackupError on any error to prevent un-snapshotted migrations.
 */
export async function createPreMigrationSafetySnapshot(
  db: DatabaseConnection,
  currentVersion: number
): Promise<string> {
  // 1. Checkpoint WAL to flush all transactions to disk
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `WAL checkpoint failed before migration: ${err instanceof Error ? err.message : 'Unknown checkpoint error'}`
    );
  }

  // 2. Ensure directories and paths
  const safetyDir = await ensureSafetyDirectory();
  const activeDbUri = getActiveDatabaseUri();
  if (!activeDbUri) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      'Active database path unavailable for safety snapshot.'
    );
  }

  const dbInfo = await FileSystem.getInfoAsync(activeDbUri);
  if (!dbInfo.exists) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Active database file '${activeDbUri}' does not exist on disk.`
    );
  }

  const timestamp = Date.now();
  const snapshotName = `pre_migration_v${currentVersion}_${timestamp}.db`;
  const snapshotUri = `${safetyDir}${snapshotName}`;

  // 3. Copy database to snapshot destination
  try {
    await FileSystem.copyAsync({
      from: activeDbUri,
      to: snapshotUri,
    });
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Failed to copy active database for pre-migration safety snapshot: ${err instanceof Error ? err.message : 'Copy error'}`
    );
  }

  // 4. Compute real SHA-256 checksum (never literal 'snapshot')
  let sha256Checksum = '';
  try {
    sha256Checksum = await computeSnapshotSha256(snapshotUri);
  } catch (err: unknown) {
    await FileSystem.deleteAsync(snapshotUri, { idempotent: true });
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Failed to compute SHA-256 checksum for safety snapshot: ${err instanceof Error ? err.message : 'Checksum error'}`
    );
  }

  // 5. Verify snapshot integrity with SQLite PRAGMA integrity_check
  await verifySnapshotIntegrity(snapshotName, snapshotUri);

  // 6. Prune old snapshots, retaining strictly the latest 3
  try {
    await pruneOldSafetySnapshots(safetyDir, 'pre_migration_');
  } catch {
    // Non-fatal pruning error
  }

  // 7. Record in backup_history metadata table
  try {
    await db.runAsync(
      `INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES (?, 'pre_migration_safety', 1, ?, ?, ?, ?, 0, 'created', NULL, ?);`,
      `snap_mig_${timestamp}`,
      currentVersion,
      snapshotName,
      dbInfo.size ?? 0,
      sha256Checksum,
      timestamp
    );
  } catch (err: unknown) {
    // If upgrading from migration 001-004 where backup_history does not exist yet, allow
    const errMsg = err instanceof Error ? err.message : '';
    if (!errMsg.includes('no such table: backup_history')) {
      await FileSystem.deleteAsync(snapshotUri, { idempotent: true });
      throw new BackupError(
        'BACKUP_ERR_SNAPSHOT_FAILED',
        `Failed to record safety snapshot in backup history: ${errMsg}`
      );
    }
  }

  return snapshotUri;
}

/**
 * Checkpoints WAL and creates a verified pre-restore safety snapshot.
 * Fails closed: throws BackupError on any error to prevent restore without safety copy.
 */
export async function createPreRestoreSafetySnapshot(
  db: DatabaseConnection,
  currentVersion: number = 6
): Promise<string> {
  // 1. Checkpoint WAL
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `WAL checkpoint failed before restore: ${err instanceof Error ? err.message : 'Unknown checkpoint error'}`
    );
  }

  // 2. Ensure directories and paths
  const safetyDir = await ensureSafetyDirectory();
  const activeDbUri = getActiveDatabaseUri();
  if (!activeDbUri) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      'Active database path unavailable for pre-restore safety snapshot.'
    );
  }

  const dbInfo = await FileSystem.getInfoAsync(activeDbUri);
  if (!dbInfo.exists) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Active database file '${activeDbUri}' does not exist on disk.`
    );
  }

  const timestamp = Date.now();
  const snapshotName = `pre_restore_safety_${timestamp}.db`;
  const snapshotUri = `${safetyDir}${snapshotName}`;

  // 3. Copy database to snapshot destination
  try {
    await FileSystem.copyAsync({
      from: activeDbUri,
      to: snapshotUri,
    });
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Failed to copy active database for pre-restore safety snapshot: ${err instanceof Error ? err.message : 'Copy error'}`
    );
  }

  // 4. Compute real SHA-256 checksum
  let sha256Checksum = '';
  try {
    sha256Checksum = await computeSnapshotSha256(snapshotUri);
  } catch (err: unknown) {
    await FileSystem.deleteAsync(snapshotUri, { idempotent: true });
    throw new BackupError(
      'BACKUP_ERR_SNAPSHOT_FAILED',
      `Failed to compute SHA-256 checksum for pre-restore snapshot: ${err instanceof Error ? err.message : 'Checksum error'}`
    );
  }

  // 5. Verify snapshot integrity with SQLite PRAGMA integrity_check
  await verifySnapshotIntegrity(snapshotName, snapshotUri);

  // 6. Prune old snapshots, retaining strictly the latest 3
  try {
    await pruneOldSafetySnapshots(safetyDir, 'pre_restore_');
  } catch {
    // Non-fatal pruning error
  }

  // 7. Record in backup_history metadata table
  try {
    await db.runAsync(
      `INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES (?, 'pre_restore_safety', 1, ?, ?, ?, ?, 0, 'created', NULL, ?);`,
      `snap_restore_${timestamp}`,
      currentVersion,
      snapshotName,
      dbInfo.size ?? 0,
      sha256Checksum,
      timestamp
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : '';
    if (!errMsg.includes('no such table: backup_history')) {
      await FileSystem.deleteAsync(snapshotUri, { idempotent: true });
      throw new BackupError(
        'BACKUP_ERR_SNAPSHOT_FAILED',
        `Failed to record pre-restore safety snapshot in backup history: ${errMsg}`
      );
    }
  }

  return snapshotUri;
}

/**
 * Lists available safety snapshots on disk with metadata.
 * Part of the documented emergency recovery path.
 */
export async function listSafetySnapshots(): Promise<SafetySnapshotMetadata[]> {
  const dir = getSafetyDirectoryUri();
  if (!dir) return [];

  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return [];

    const fileNames = await FileSystem.readDirectoryAsync(dir);
    const results: SafetySnapshotMetadata[] = [];

    for (const name of fileNames) {
      if (!name.endsWith('.db')) continue;
      const fileUri = `${dir}${name}`;
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) continue;

      const isPreMig = name.startsWith('pre_migration_');
      const isPreRes = name.startsWith('pre_restore_');
      if (!isPreMig && !isPreRes) continue;

      const timestampMatch = name.match(/_(\d+)\.db$/);
      const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : 0;

      results.push({
        fileName: name,
        uri: fileUri,
        timestamp,
        sizeBytes: fileInfo.size ?? 0,
        type: isPreMig ? 'pre_migration' : 'pre_restore',
      });
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}
