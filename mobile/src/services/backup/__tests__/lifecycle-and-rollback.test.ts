import {
  uint8ArrayToBase64,
  cleanExpiredBackupCacheFiles,
  shareBackupFile,
  recordVerifiedExternalBackup,
  getLastSuccessfulBackup,
  createEncryptedBackup,
  isBackupOrRestoreInProgress,
  setOperationInProgress,
} from '../backup-service';
import { executeRestore, cleanStaleStagingArtifacts } from '../restore-service';
import { BackupError, RestoreError, DecryptedBackupContext } from '../types';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from '../../../db/types';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///mock/app/cache/',
  documentDirectory: 'file:///mock/app/files/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  copyAsync: jest.fn(),
  moveAsync: jest.fn(),
  deleteAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('../../../db/client', () => ({
  DEFAULT_DATABASE_NAME: 'barakah.db',
  getDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  runExclusiveTransaction: jest.fn((db, cb) => cb(db)),
}));

jest.mock('../safety', () => ({
  ...jest.requireActual('../safety'),
  createPreRestoreSafetySnapshot: jest.fn().mockResolvedValue('file:///mock/app/files/SQLite/safety_snapshots/pre_restore_safety_123.db'),
}));

describe('Backup Lifecycle, Concurrency & Atomic Rollback Suite', () => {
  const mockFs = FileSystem as jest.Mocked<typeof FileSystem>;
  const mockSharing = Sharing as jest.Mocked<typeof Sharing>;

  beforeEach(() => {
    jest.clearAllMocks();
    setOperationInProgress(false);
    mockFs.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, modificationTime: Date.now() / 1000 } as any);
    mockFs.readDirectoryAsync.mockResolvedValue([]);
    mockFs.deleteAsync.mockResolvedValue(undefined);
    mockFs.moveAsync.mockResolvedValue(undefined);
    mockFs.copyAsync.mockResolvedValue(undefined);
    mockSharing.isAvailableAsync.mockResolvedValue(true);
    mockSharing.shareAsync.mockResolvedValue(undefined);
  });

  it('converts byte chunks to base64 accurately without memory explosion', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111, 32, 66, 97, 114, 97, 107, 97, 104]);
    const b64 = uint8ArrayToBase64(data);
    expect(b64).toBe(Buffer.from(data).toString('base64'));
  });

  it('cleans expired backup cache files while preserving fresh ones', async () => {
    const now = Date.now();
    const expiredTime = (now - 30 * 60 * 60 * 1000) / 1000; // 30 hours old
    const freshTime = (now - 2 * 60 * 60 * 1000) / 1000;    // 2 hours old

    mockFs.readDirectoryAsync.mockResolvedValue([
      'barakah_backup_expired.fmz',
      'barakah_backup_fresh.fmz',
      'unrelated_cache.tmp',
    ]);

    mockFs.getInfoAsync.mockImplementation(async (path: string) => {
      if (path.includes('expired')) {
        return { exists: true, modificationTime: expiredTime } as any;
      }
      return { exists: true, modificationTime: freshTime } as any;
    });

    await cleanExpiredBackupCacheFiles(24 * 60 * 60 * 1000);

    expect(mockFs.deleteAsync).toHaveBeenCalledTimes(1);
    expect(mockFs.deleteAsync).toHaveBeenCalledWith('file:///mock/app/cache/barakah_backup_expired.fmz', { idempotent: true });
  });

  it('updates backup status to share_sheet_returned on successful share', async () => {
    const mockDb = {
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    } as unknown as DatabaseConnection;

    await shareBackupFile(mockDb, 'bak_123', 'file:///mock/cache/backup.fmz');

    expect(mockSharing.shareAsync).toHaveBeenCalledWith(
      'file:///mock/cache/backup.fmz',
      expect.objectContaining({ mimeType: 'application/octet-stream' })
    );

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE backup_history SET status = ?, error_code = ? WHERE id = ?;',
      'share_sheet_returned',
      null,
      'bak_123'
    );
  });

  it('does not treat share-sheet return as verified storage in getLastSuccessfulBackup', async () => {
    const mockDb = {
      getFirstAsync: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseConnection;

    const result = await getLastSuccessfulBackup(mockDb);
    expect(result).toBeNull();
    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE backup_type = 'manual_export' AND status = 'verified_external_copy'")
    );
  });

  it('promotes backup status to verified_external_copy upon external-file verification', async () => {
    const mockDb = {
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    } as unknown as DatabaseConnection;

    await recordVerifiedExternalBackup(mockDb, 'checksum_verified_abc');

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'verified_external_copy'"),
      'checksum_verified_abc'
    );
  });

  it('updates backup status to failed when share fails unexpectedly without parsing strings', async () => {
    const mockDb = {
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    } as unknown as DatabaseConnection;

    mockSharing.shareAsync.mockRejectedValue(new Error('User cancelled'));

    await expect(
      shareBackupFile(mockDb, 'bak_123', 'file:///mock/cache/backup.fmz')
    ).rejects.toThrow(BackupError);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE backup_history SET status = ?, error_code = ? WHERE id = ?;',
      'failed',
      'BACKUP_ERR_SHARE_FAILED',
      'bak_123'
    );
  });

  it('retrieves only verified_external_copy manual backups as last successful backup', async () => {
    const mockDb = {
      getFirstAsync: jest.fn().mockResolvedValue({
        id: 'bak_verified_01',
        backup_type: 'manual_export',
        status: 'verified_external_copy',
        created_at: 1700000000000,
      }),
    } as unknown as DatabaseConnection;

    const result = await getLastSuccessfulBackup(mockDb);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('bak_verified_01');

    expect(mockDb.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE backup_type = 'manual_export' AND status = 'verified_external_copy'")
    );
  });

  it('enforces concurrency lock preventing overlapping operations', async () => {
    setOperationInProgress(true);

    const mockDb = {} as DatabaseConnection;
    await expect(
      createEncryptedBackup(mockDb, 'SecurePassphrase123!', 'SecurePassphrase123!')
    ).rejects.toThrow(BackupError);

    try {
      await createEncryptedBackup(mockDb, 'SecurePassphrase123!', 'SecurePassphrase123!');
    } catch (err: unknown) {
      expect((err as BackupError).code).toBe('BACKUP_ERR_LOCK_ACTIVE');
      expect((err as BackupError).message).toMatch(/Another backup or recovery operation is currently running/i);
    }
  });

  it('cleans unreferenced staging artifacts but preserves .old_* recovery databases', async () => {
    mockFs.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: true } as any);
    mockFs.readDirectoryAsync.mockResolvedValue([
      'staging_restore_123.db',
      'barakah.db.old_456',
      'barakah.db',
    ]);

    await cleanStaleStagingArtifacts();

    // Disposable staging artifact without active journal reference is deleted
    expect(mockFs.deleteAsync).toHaveBeenCalledWith('file:///mock/app/files/SQLite/staging_restore_123.db', { idempotent: true });
    // NEVER delete .old_* files in stale staging artifact cleanup
    expect(mockFs.deleteAsync).not.toHaveBeenCalledWith('file:///mock/app/files/SQLite/barakah.db.old_456', { idempotent: true });
    expect(mockFs.deleteAsync).not.toHaveBeenCalledWith('file:///mock/app/files/SQLite/barakah.db', { idempotent: true });
  });

  it('rolls back and restores original database when post-activation checks fail', async () => {
    const mockDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseConnection;

    const mockStagingDb: any = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
      withExclusiveTransactionAsync: jest.fn((cb) => cb(mockStagingDb)),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockStagingDb);

    // Mock getDatabase after promotion to fail verification
    const { getDatabase } = jest.requireMock('../../../db/client');
    const mockCorruptActivatedDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'corrupt database page' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
    };
    (getDatabase as jest.Mock).mockResolvedValue(mockCorruptActivatedDb);

    const context: DecryptedBackupContext = {
      header: {
        magic: 'BMZ1',
        formatVersion: 1,
        schemaVersion: 6,
        createdAtMs: Date.now(),
        kdfId: 1,
        kdfN: 16384,
        kdfR: 8,
        kdfP: 1,
        salt: new Uint8Array(16),
        cipherId: 1,
        nonce: new Uint8Array(12),
        appVersion: 1,
        flags: 1,
        rawHeaderBytes: new Uint8Array(60),
      },
      manifest: {
        manifestVersion: 1,
        createdAtMs: Date.now(),
        appVersion: 1,
        schemaVersion: 6,
        rowCounts: { accounts: 0, categories: 0, transactions: 0, counterparties: 0, debts: 0, debt_transactions: 0, schema_migrations: 0 },
        tableChecksums: { accounts: '', categories: '', transactions: '', counterparties: '', debts: '', debt_transactions: '', schema_migrations: '' },
        payload: { accounts: [], categories: [], transactions: [], counterparties: [], debts: [], debt_transactions: [], schema_migrations: [] },
      },
      preview: {
        createdAtMs: Date.now(),
        schemaVersion: 6,
        appVersion: 1,
        rowCounts: { accounts: 0, categories: 0, transactions: 0, counterparties: 0, debts: 0, debt_transactions: 0 },
        liveRowCounts: { accounts: 0, categories: 0, transactions: 0, counterparties: 0, debts: 0, debt_transactions: 0 },
      },
      envelopeBytes: new Uint8Array(100),
    };

    await expect(executeRestore(mockDb, context)).rejects.toThrow(RestoreError);
    // Verified that moveAsync was called to restore backupOldDbUri back to activeDbUri
    expect(mockFs.moveAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'file:///mock/app/files/SQLite/barakah.db',
      })
    );
    // Operation lock is released
    expect(isBackupOrRestoreInProgress()).toBe(false);
  });
});
