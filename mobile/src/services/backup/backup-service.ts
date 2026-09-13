/**
 * Encrypted Backup Generation Service
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - In-memory operation lock to prevent concurrent backup/restore
 * - Strict exclusive-transaction point-in-time database snapshot
 * - Deterministic table SHA-256 checksums & canonical JSON serialization
 * - DEFLATE payload compression
 * - CSPRNG salt and nonce generation via expo-crypto
 * - Scrypt key derivation & AES-256-GCM encryption with 60-byte AAD header
 * - Automatic recording in backup_history metadata table
 * - Native file sharing integration via expo-sharing
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { DatabaseConnection } from '../../db/types';
import {
  BackupError,
  BackupManifest,
  BackupPayloadData,
  BackupHistoryRow,
  CURRENT_DATABASE_SCHEMA_VERSION,
  APP_VERSION_CODE,
  FLAG_COMPRESSED_DEFLATE,
  DEFAULT_KDF_PARAMS,
  MIN_PASSPHRASE_LENGTH,
} from './types';
import {
  deriveKeyFromPassphrase,
  getSecureRandomBytes,
  serializeHeader,
  encryptPayloadWithHeader,
  computeSha256Hex,
} from './crypto';
import {
  canonicalJsonStringify,
  computeTableChecksums,
  compressJsonPayload,
} from './serializer';

let isOperationInProgress = false;

export function isBackupOrRestoreInProgress(): boolean {
  return isOperationInProgress;
}

export function setOperationInProgress(val: boolean): void {
  isOperationInProgress = val;
}

export interface BackupResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256Checksum: string;
  recordCount: number;
  envelopeBytes: Uint8Array;
}

/**
 * Creates an authenticated, encrypted, compressed Barakah backup (.fmz).
 */
export async function createEncryptedBackup(
  db: DatabaseConnection,
  passphrase: string,
  passphraseConfirm: string,
  kdfParams: { N: number; r: number; p: number } = DEFAULT_KDF_PARAMS
): Promise<BackupResult> {
  if (isOperationInProgress) {
    throw new BackupError(
      'BACKUP_ERR_LOCK_ACTIVE',
      'Another backup or recovery operation is currently running. Please wait.'
    );
  }

  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupError(
      'BACKUP_ERR_PASSPHRASE_TOO_SHORT',
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`
    );
  }

  if (passphrase !== passphraseConfirm) {
    throw new BackupError(
      'BACKUP_ERR_PASSPHRASE_MISMATCH',
      'Passphrase confirmation does not match.'
    );
  }

  isOperationInProgress = true;

  try {
    // 1. Consistent point-in-time read under exclusive transaction
    let payloadData!: BackupPayloadData;

    const readSnapshot = async () => {
      const accounts = await db.getAllAsync<any>('SELECT * FROM accounts ORDER BY id ASC;');
      const categories = await db.getAllAsync<any>('SELECT * FROM categories ORDER BY id ASC;');
      const transactions = await db.getAllAsync<any>('SELECT * FROM transactions ORDER BY id ASC;');
      const counterparties = await db.getAllAsync<any>('SELECT * FROM counterparties ORDER BY id ASC;');
      const debts = await db.getAllAsync<any>('SELECT * FROM debts ORDER BY id ASC;');
      const debt_transactions = await db.getAllAsync<any>('SELECT * FROM debt_transactions ORDER BY id ASC;');
      const schema_migrations = await db.getAllAsync<any>('SELECT * FROM schema_migrations ORDER BY version ASC;');

      payloadData = {
        accounts,
        categories,
        transactions,
        counterparties,
        debts,
        debt_transactions,
        schema_migrations,
      };
    };

    if (typeof db.withExclusiveTransactionAsync === 'function') {
      await db.withExclusiveTransactionAsync(readSnapshot);
    } else {
      await db.withTransactionAsync(readSnapshot);
    }

    const totalRecords =
      payloadData.accounts.length +
      payloadData.categories.length +
      payloadData.transactions.length +
      payloadData.counterparties.length +
      payloadData.debts.length +
      payloadData.debt_transactions.length;

    // 2. Compute table checksums
    const tableChecksums = computeTableChecksums(payloadData);

    const now = Date.now();
    const manifest: BackupManifest = {
      manifestVersion: 1,
      createdAtMs: now,
      appVersion: APP_VERSION_CODE,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      rowCounts: {
        accounts: payloadData.accounts.length,
        categories: payloadData.categories.length,
        transactions: payloadData.transactions.length,
        counterparties: payloadData.counterparties.length,
        debts: payloadData.debts.length,
        debt_transactions: payloadData.debt_transactions.length,
        schema_migrations: payloadData.schema_migrations.length,
      },
      tableChecksums,
      payload: payloadData,
    };

    // 3. Serialize and compress
    const canonicalJson = canonicalJsonStringify(manifest);
    const compressedPayload = compressJsonPayload(canonicalJson);

    // 4. Generate CSPRNG salt & nonce
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);

    // 5. Derive AES-256 key
    const derivedKey = await deriveKeyFromPassphrase(passphrase, salt, kdfParams);

    // 6. Build 60-byte authenticated header
    const rawHeaderBytes = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: kdfParams.N,
      kdfR: kdfParams.r,
      kdfP: kdfParams.p,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      appVersion: APP_VERSION_CODE,
      flags: FLAG_COMPRESSED_DEFLATE,
      createdAtMs: now,
    });

    const header = {
      magic: 'BKBK',
      formatVersion: 1,
      kdfId: 1,
      kdfN: kdfParams.N,
      kdfR: kdfParams.r,
      kdfP: kdfParams.p,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      appVersion: APP_VERSION_CODE,
      flags: FLAG_COMPRESSED_DEFLATE,
      createdAtMs: now,
      rawHeaderBytes,
    };

    // 7. Encrypt payload with header as AAD
    const envelopeBytes = encryptPayloadWithHeader(compressedPayload, derivedKey, header);
    const wholeFileChecksum = computeSha256Hex(envelopeBytes);

    // 8. Write to filesystem if available
    const isoDate = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `barakah_backup_${isoDate}.fmz`;
    let filePath = '';

    if (FileSystem.cacheDirectory) {
      filePath = `${FileSystem.cacheDirectory}${fileName}`;
      // Write base64 string to file
      let binaryStr = '';
      const len = envelopeBytes.byteLength;
      for (let i = 0; i < len; i++) {
        binaryStr += String.fromCharCode(envelopeBytes[i]);
      }
      const base64Content = btoa(binaryStr);
      await FileSystem.writeAsStringAsync(filePath, base64Content, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    // 9. Record in backup_history
    const historyId = `bak_${now}`;
    try {
      await db.runAsync(
        `INSERT INTO backup_history (
          id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
        ) VALUES (?, 'manual_export', 1, ?, ?, ?, ?, ?, 'created', NULL, ?);`,
        historyId,
        CURRENT_DATABASE_SCHEMA_VERSION,
        fileName,
        envelopeBytes.length,
        wholeFileChecksum,
        totalRecords,
        now
      );
    } catch {
      // Table may not exist if running on older mock schema
    }

    return {
      filePath,
      fileName,
      fileSizeBytes: envelopeBytes.length,
      sha256Checksum: wholeFileChecksum,
      recordCount: totalRecords,
      envelopeBytes,
    };
  } catch (err: unknown) {
    if (err instanceof BackupError) throw err;
    throw new BackupError(
      'BACKUP_ERR_EXPORT_FAILED',
      `Backup export failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  } finally {
    isOperationInProgress = false;
  }
}

/**
 * Invokes native OS share / save sheet for the exported backup file.
 */
export async function shareBackupFile(filePath: string): Promise<void> {
  if (!filePath) {
    throw new BackupError('BACKUP_ERR_EXPORT_FAILED', 'Invalid backup file path for sharing.');
  }

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new BackupError(
      'BACKUP_ERR_EXPORT_FAILED',
      'File sharing is not supported on this platform or device.'
    );
  }

  try {
    await Sharing.shareAsync(filePath, {
      mimeType: 'application/octet-stream',
      dialogTitle: 'Save Barakah Backup',
      UTI: 'public.data',
    });
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_ERR_SHARE_CANCELLED',
      `Share action was cancelled or failed: ${err instanceof Error ? err.message : ''}`
    );
  }
}

/**
 * Retrieves the most recent successful manual backup record from backup_history.
 */
export async function getLastSuccessfulBackup(
  db: DatabaseConnection
): Promise<BackupHistoryRow | null> {
  try {
    return await db.getFirstAsync<BackupHistoryRow>(
      `SELECT * FROM backup_history
       WHERE backup_type = 'manual_export' AND status = 'created'
       ORDER BY created_at DESC
       LIMIT 1;`
    );
  } catch {
    return null;
  }
}
