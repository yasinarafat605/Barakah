import {
  base64ToUint8Array,
  getSafetyDirectoryUri,
  getActiveDatabaseUri,
  pruneOldSafetySnapshots,
  createPreMigrationSafetySnapshot,
  createPreRestoreSafetySnapshot,
  listSafetySnapshots,
} from '../safety';
import { BackupError } from '../types';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from '../../../db/types';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock/app/files/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

describe('Safety Snapshot Engine & Fail-Closed Invariants', () => {
  const mockFs = FileSystem as jest.Mocked<typeof FileSystem>;
  const mockSqlite = SQLite as jest.Mocked<typeof SQLite>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 4096 } as any);
    mockFs.readAsStringAsync.mockResolvedValue(Buffer.from('fake-sqlite-header').toString('base64'));
    mockFs.makeDirectoryAsync.mockResolvedValue(undefined);
    mockFs.copyAsync.mockResolvedValue(undefined);
    mockFs.deleteAsync.mockResolvedValue(undefined);
    mockFs.readDirectoryAsync.mockResolvedValue([]);
  });

  it('converts base64 string to Uint8Array accurately without truncation', () => {
    const originalText = 'Barakah Financial Integrity Verification';
    const base64 = Buffer.from(originalText).toString('base64');
    const bytes = base64ToUint8Array(base64);
    const decoded = Buffer.from(bytes).toString('utf8');
    expect(decoded).toBe(originalText);
  });

  it('resolves correct safety directory and database URIs', () => {
    expect(getSafetyDirectoryUri()).toBe('file:///mock/app/files/SQLite/safety_snapshots/');
    expect(getActiveDatabaseUri()).toBe('file:///mock/app/files/SQLite/barakah.db');
    expect(getActiveDatabaseUri('custom.db')).toBe('file:///mock/app/files/SQLite/custom.db');
  });

  it('strictly prunes safety snapshots to latest 3 valid files per type', async () => {
    const existingFiles = [
      'pre_migration_v5_1700000001000.db',
      'pre_migration_v5_1700000002000.db',
      'pre_migration_v5_1700000003000.db',
      'pre_migration_v5_1700000004000.db',
      'pre_migration_v5_1700000005000.db',
      'other_unrelated_file.txt',
    ];
    mockFs.readDirectoryAsync.mockResolvedValue(existingFiles);

    const safetyDir = 'file:///mock/app/files/SQLite/safety_snapshots/';
    await pruneOldSafetySnapshots(safetyDir, 'pre_migration_');

    // 5 matching files, MAX_SAFETY_SNAPSHOTS = 3 -> oldest 2 must be deleted
    expect(mockFs.deleteAsync).toHaveBeenCalledTimes(2);
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(`${safetyDir}pre_migration_v5_1700000001000.db`, { idempotent: true });
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(`${safetyDir}pre_migration_v5_1700000002000.db`, { idempotent: true });
    expect(mockFs.deleteAsync).not.toHaveBeenCalledWith(`${safetyDir}pre_migration_v5_1700000003000.db`, { idempotent: true });
  });

  it('fails closed and aborts migration if WAL checkpoint fails', async () => {
    const mockDb: Partial<DatabaseConnection> = {
      execAsync: jest.fn().mockRejectedValue(new Error('WAL checkpoint lock timeout')),
    };

    await expect(
      createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5)
    ).rejects.toThrow(BackupError);

    try {
      await createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).code).toBe('BACKUP_ERR_SNAPSHOT_FAILED');
      expect((err as BackupError).message).toMatch(/WAL checkpoint failed/i);
    }
  });

  it('fails closed if active database file does not exist on disk', async () => {
    const mockDb: Partial<DatabaseConnection> = {
      execAsync: jest.fn().mockResolvedValue(undefined),
    };
    mockFs.getInfoAsync.mockResolvedValue({ exists: false, isDirectory: false } as any);

    await expect(
      createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5)
    ).rejects.toThrow(BackupError);

    try {
      await createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).code).toBe('BACKUP_ERR_SNAPSHOT_FAILED');
      expect((err as BackupError).message).toMatch(/does not exist on disk/i);
    }
  });

  it('deletes snapshot file and aborts if snapshot fails SQLite integrity check', async () => {
    const mockDb: Partial<DatabaseConnection> = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    };

    // Staging / Snapshot DB mock reporting corruption
    const mockSnapDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'malformed index tbl_idx' }),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    mockSqlite.openDatabaseAsync.mockResolvedValue(mockSnapDb as any);

    await expect(
      createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5)
    ).rejects.toThrow(BackupError);

    // Verify snapshot file was immediately deleted
    expect(mockFs.deleteAsync).toHaveBeenCalled();

    try {
      await createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).code).toBe('BACKUP_ERR_SNAPSHOT_FAILED');
      expect((err as BackupError).message).toMatch(/Safety snapshot verification failed/i);
    }
  });

  it('successfully creates pre-migration safety snapshot and records metadata', async () => {
    const mockDb: Partial<DatabaseConnection> = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    };

    const mockSnapDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    mockSqlite.openDatabaseAsync.mockResolvedValue(mockSnapDb as any);

    const snapshotUri = await createPreMigrationSafetySnapshot(mockDb as DatabaseConnection, 5);
    expect(snapshotUri).toMatch(/pre_migration_v5_\d+\.db$/);

    // Verify metadata recorded in backup_history
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO backup_history'),
      expect.any(String),
      5,
      expect.stringMatching(/pre_migration_v5_\d+\.db$/),
      4096,
      expect.stringMatching(/^[0-9a-f]{64}$/), // Real SHA-256 hex checksum
      expect.any(Number)
    );
  });

  it('successfully creates pre-restore safety snapshot', async () => {
    const mockDb: Partial<DatabaseConnection> = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    };

    const mockSnapDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    mockSqlite.openDatabaseAsync.mockResolvedValue(mockSnapDb as any);

    const snapshotUri = await createPreRestoreSafetySnapshot(mockDb as DatabaseConnection, 6);
    expect(snapshotUri).toMatch(/pre_restore_safety_\d+\.db$/);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO backup_history'),
      expect.any(String),
      6,
      expect.stringMatching(/pre_restore_safety_\d+\.db$/),
      4096,
      expect.stringMatching(/^[0-9a-f]{64}$/), // Real SHA-256 hex checksum
      expect.any(Number)
    );
  });

  it('lists safety snapshots sorted by timestamp descending', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: true, size: 8192 } as any);
    mockFs.readDirectoryAsync.mockResolvedValue([
      'pre_migration_v5_1700000001000.db',
      'pre_restore_v6_1700000003000.db',
      'pre_migration_v5_1700000002000.db',
      'ignored.txt',
    ]);

    const snapshots = await listSafetySnapshots();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].timestamp).toBe(1700000003000);
    expect(snapshots[0].type).toBe('pre_restore');
    expect(snapshots[1].timestamp).toBe(1700000002000);
    expect(snapshots[2].timestamp).toBe(1700000001000);
  });
});
