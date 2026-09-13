import { decompressPayload, compressJsonPayload, validateManifestStructure, validateHeaderManifestConsistency } from '../serializer';
import { inspectBackupHeader } from '../restore-service';
import {
  MAX_BACKUP_FILE_SIZE_BYTES,
  HEADER_SIZE_BYTES,
  TAG_SIZE_BYTES,
  BackupHeader,
  BackupManifest,
  RestoreError,
} from '../types';

describe('Backup Resource Limits & Decompression Defense', () => {
  it('aborts streaming decompression before allocating when payload exceeds limit', () => {
    // Highly compressible payload: 200,000 'A' characters compresses to ~200 bytes
    const largePayload = 'A'.repeat(200000);
    const compressed = compressJsonPayload(largePayload);

    // Test with a tight limit of 10,000 bytes
    expect(() => {
      decompressPayload(compressed, 10000);
    }).toThrow(RestoreError);

    try {
      decompressPayload(compressed, 10000);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe('RESTORE_ERR_PAYLOAD_TOO_LARGE');
    }
  });

  it('rejects envelope when truncated below header + auth tag minimum size', async () => {
    const minSize = HEADER_SIZE_BYTES + TAG_SIZE_BYTES; // 60 + 16 = 76
    const truncated = new Uint8Array(minSize - 1);

    await expect(inspectBackupHeader(truncated)).rejects.toThrow(RestoreError);
    try {
      await inspectBackupHeader(truncated);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe('RESTORE_ERR_FILE_TRUNCATED');
    }
  });

  it('rejects envelope when exceeding maximum allowable file size', async () => {
    // Pretend envelope has length > 100 MB
    const fakeOversized = {
      length: MAX_BACKUP_FILE_SIZE_BYTES + 1,
      slice: () => new Uint8Array(0),
    } as unknown as Uint8Array;

    await expect(inspectBackupHeader(fakeOversized)).rejects.toThrow(RestoreError);
    try {
      await inspectBackupHeader(fakeOversized);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe('RESTORE_ERR_FILE_TOO_LARGE');
    }
  });

  it('rejects manifest structure with invalid format or row count mismatch', () => {
    // Non-object manifest
    expect(() => validateManifestStructure('not an object')).toThrow(RestoreError);
    try {
      validateManifestStructure('not an object');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe('RESTORE_ERR_INVALID_MANIFEST');
    }

    // Row count mismatch
    const mismatchedManifest = {
      manifestVersion: 1,
      createdAtMs: Date.now(),
      appVersion: 1,
      schemaVersion: 6,
      rowCounts: {
        accounts: 10,
        categories: 0,
        transactions: 0,
        counterparties: 0,
        debts: 0,
        debt_transactions: 0,
        schema_migrations: 0,
      },
      tableChecksums: {
        accounts: '',
        categories: '',
        transactions: '',
        counterparties: '',
        debts: '',
        debt_transactions: '',
        schema_migrations: '',
      },
      payload: {
        accounts: [], // Declared 10, found 0
        categories: [],
        transactions: [],
        counterparties: [],
        debts: [],
        debt_transactions: [],
        schema_migrations: [],
      },
    };

    expect(() => validateManifestStructure(mismatchedManifest)).toThrow(RestoreError);
    try {
      validateManifestStructure(mismatchedManifest);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      expect((err as RestoreError).code).toBe('RESTORE_ERR_ROW_COUNT_MISMATCH');
    }
  });

  it('enforces strict header-to-manifest consistency', () => {
    const header: BackupHeader = {
      magic: 'BMZ1',
      formatVersion: 1,
      kdfId: 1,
      kdfN: 16384,
      kdfR: 8,
      kdfP: 1,
      salt: new Uint8Array(16),
      cipherId: 1,
      nonce: new Uint8Array(12),
      schemaVersion: 6,
      appVersion: 1,
      flags: 1,
      createdAtMs: 1700000000000,
      rawHeaderBytes: new Uint8Array(60),
    };

    const validManifest: BackupManifest = {
      manifestVersion: 1,
      createdAtMs: 1700000000000,
      appVersion: 1,
      schemaVersion: 6,
      rowCounts: {
        accounts: 0,
        categories: 0,
        transactions: 0,
        counterparties: 0,
        debts: 0,
        debt_transactions: 0,
        schema_migrations: 0,
      },
      tableChecksums: {
        accounts: '',
        categories: '',
        transactions: '',
        counterparties: '',
        debts: '',
        debt_transactions: '',
        schema_migrations: '',
      },
      payload: {
        accounts: [],
        categories: [],
        transactions: [],
        counterparties: [],
        debts: [],
        debt_transactions: [],
        schema_migrations: [],
      },
    };

    // Valid case does not throw
    expect(() => validateHeaderManifestConsistency(header, validManifest)).not.toThrow();

    // Mismatched schema version
    expect(() =>
      validateHeaderManifestConsistency(header, { ...validManifest, schemaVersion: 5 })
    ).toThrow(RestoreError);

    // Mismatched app version
    expect(() =>
      validateHeaderManifestConsistency(header, { ...validManifest, appVersion: 2 })
    ).toThrow(RestoreError);

    // Mismatched creation timestamp
    expect(() =>
      validateHeaderManifestConsistency(header, { ...validManifest, createdAtMs: 1700000009999 })
    ).toThrow(RestoreError);
  });
});
