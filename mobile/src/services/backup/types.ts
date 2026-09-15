/**
 * Backup and Recovery Types & Envelope Specifications
 * Phase 4: Recovery Foundation — Encrypted Backup and Verified Restore
 *
 * Adheres strictly to:
 * - ADR-001 (Local-first)
 * - ADR-006 / ADR-017 (Honest security labeling: live DB is NOT encrypted, exported backup IS encrypted)
 * - ADR-016 (Authenticated encrypted envelope: AES-256-GCM + Scrypt KDF + AAD)
 */

import {
  AccountRow,
  CategoryRow,
  TransactionRow,
  CounterpartyRow,
  DebtRow,
  DebtTransactionRow,
} from '../../db/types';

export const BACKUP_MAGIC_BYTES = new Uint8Array([0x42, 0x4D, 0x5A, 0x31]); // 'BMZ1'
export const BACKUP_FORMAT_VERSION = 1;
export const MIN_RESTORABLE_SCHEMA_VERSION = 4;
export const MAX_RESTORABLE_SCHEMA_VERSION = 7;
export const CURRENT_DATABASE_SCHEMA_VERSION = 7;
export const APP_VERSION_CODE = 1; // 1.0.0

export const HEADER_SIZE_BYTES = 60;
export const SALT_SIZE_BYTES = 16;
export const NONCE_SIZE_BYTES = 12;
export const TAG_SIZE_BYTES = 16; // 16-byte AES-256-GCM authentication tag

export const KDF_ID_SCRYPT = 1;
export const CIPHER_ID_AES_256_GCM = 1;

export const MIN_PASSPHRASE_LENGTH = 10;

// Bounded KDF limits to prevent malicious DoS / resource exhaustion attacks
export const KDF_BOUNDS = {
  MIN_N: 16384,
  MAX_N: 65536,
  MIN_R: 8,
  MAX_R: 16,
  MIN_P: 1,
  MAX_P: 2,
  DK_LEN: 32, // 256 bits for AES-256
} as const;

// Default KDF parameters for new backups
export const DEFAULT_KDF_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
} as const;

export const FLAG_COMPRESSED_DEFLATE = 1 << 0; // Bit 0: Deflate compression enabled
export const FLAGS_RESERVED_MASK = 0xfe; // Bits 1..7 reserved, must be 0

export const MAX_BACKUP_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB max .fmz envelope
export const MAX_DECOMPRESSED_PAYLOAD_BYTES = 50 * 1024 * 1024; // 50 MB max uncompressed JSON

export interface BackupHeader {
  magic: 'BMZ1';
  formatVersion: number; // 1
  schemaVersion: number;
  createdAtMs: number; // Milliseconds since Unix epoch
  kdfId: number; // 1 = Scrypt
  kdfN: number;
  kdfR: number;
  kdfP: number;
  salt: Uint8Array; // 16 bytes
  cipherId: number; // 1 = AES-256-GCM
  nonce: Uint8Array; // 12 bytes
  appVersion: number;
  flags: number; // Bitmask (bit 0 = DEFLATE)
  rawHeaderBytes: Uint8Array; // Exact 60 bytes used as AAD
}

export interface SchemaMigrationRow {
  version: number;
  name: string;
  applied_at: number;
  checksum?: string | null;
}

export interface BackupPayloadData {
  accounts: AccountRow[];
  categories: CategoryRow[];
  transactions: TransactionRow[];
  counterparties: CounterpartyRow[];
  debts: DebtRow[];
  debt_transactions: DebtTransactionRow[];
  schema_migrations: SchemaMigrationRow[];
}

export interface TableChecksums {
  accounts: string;
  categories: string;
  transactions: string;
  counterparties: string;
  debts: string;
  debt_transactions: string;
  schema_migrations: string;
}

export interface BackupManifest {
  manifestVersion: number; // 1
  createdAtMs: number;
  appVersion: number;
  schemaVersion: number;
  rowCounts: {
    accounts: number;
    categories: number;
    transactions: number;
    counterparties: number;
    debts: number;
    debt_transactions: number;
    schema_migrations: number;
  };
  tableChecksums: TableChecksums;
  payload: BackupPayloadData;
}

export const PORTABLE_FINANCIAL_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'counterparties',
  'debts',
  'debt_transactions',
] as const;

export type PortableFinancialTable = (typeof PORTABLE_FINANCIAL_TABLES)[number];

export type RestorePromotionPhase =
  | 'initialized'
  | 'active_moved_to_old'
  | 'staging_moved_to_active'
  | 'activation_verified'
  | 'rollback_candidate_verified'
  | 'rollback_restored_verified'
  | 'complete';

export interface RestoreJournal {
  journalVersion: 2;
  generation: number;
  operationId: string;
  activePath: string;
  stagingPath: string;
  recoveryOldPath: string;
  safetySnapshotPath: string | null;
  recoverySourcePath: string | null;
  completionIdentity: 'original' | 'destination' | null;
  expectedOriginalPortableDigest: string;
  expectedDestinationPortableDigest: string;
  phase: RestorePromotionPhase;
  updatedAtMs: number;
}

export interface RestoreJournalEnvelope {
  version: 2;
  checksum: string;
  payload: RestoreJournal;
}

export type RollbackOutcome =
  | 'activation_failed_rollback_succeeded'
  | 'activation_failed_manual_recovery_available'
  | 'activation_failed_rollback_failed';

export type BackupHistoryStatus =
  | 'created'
  | 'generated'
  | 'share_sheet_returned'
  | 'verified_external_copy'
  | 'failed'
  | 'exported'
  | 'verified'
  | 'share_cancelled';

export interface BackupHistoryRow {
  id: string;
  backup_type: 'manual_export' | 'pre_restore_safety' | 'pre_migration_safety';
  format_version: number;
  schema_version: number;
  file_name: string;
  file_size_bytes: number;
  sha256_checksum: string;
  record_count: number;
  status: BackupHistoryStatus;
  error_code: string | null;
  created_at: number;
}

export interface DecryptedBackupContext {
  header: BackupHeader;
  manifest: BackupManifest;
  preview: RestorePreview;
  envelopeBytes: Uint8Array;
}

export interface RestorePreview {
  createdAtMs: number;
  schemaVersion: number;
  appVersion: number;
  rowCounts: {
    accounts: number;
    categories: number;
    transactions: number;
    counterparties: number;
    debts: number;
    debt_transactions: number;
  };
  liveRowCounts: {
    accounts: number;
    categories: number;
    transactions: number;
    counterparties: number;
    debts: number;
    debt_transactions: number;
  };
}

export type BackupErrorCode =
  | 'BACKUP_ERR_PASSPHRASE_TOO_SHORT'
  | 'BACKUP_ERR_PASSPHRASE_MISMATCH'
  | 'BACKUP_ERR_LOCK_ACTIVE'
  | 'BACKUP_ERR_DATABASE_EMPTY'
  | 'BACKUP_ERR_EXPORT_FAILED'
  | 'BACKUP_ERR_SNAPSHOT_FAILED'
  | 'BACKUP_ERR_SHARE_CANCELLED'
  | 'BACKUP_ERR_SHARE_FAILED'
  | 'BACKUP_ERR_SHARING_UNAVAILABLE';

export type RestoreErrorCode =
  | 'RESTORE_ERR_INVALID_FILE_TYPE'
  | 'RESTORE_ERR_FILE_TOO_LARGE'
  | 'RESTORE_ERR_FILE_TRUNCATED'
  | 'RESTORE_ERR_INVALID_MAGIC'
  | 'RESTORE_ERR_UNSUPPORTED_VERSION'
  | 'RESTORE_ERR_UNSUPPORTED_SCHEMA_VERSION'
  | 'RESTORE_ERR_UNSUPPORTED_KDF'
  | 'RESTORE_ERR_UNSUPPORTED_CIPHER'
  | 'RESTORE_ERR_INVALID_FLAGS'
  | 'RESTORE_ERR_AUTH_FAILED'
  | 'RESTORE_ERR_DECOMPRESS_FAILED'
  | 'RESTORE_ERR_DECOMPRESSION_BOMB'
  | 'RESTORE_ERR_PAYLOAD_TOO_LARGE'
  | 'RESTORE_ERR_INVALID_JSON'
  | 'RESTORE_ERR_INVALID_MANIFEST'
  | 'RESTORE_ERR_HEADER_MANIFEST_MISMATCH'
  | 'RESTORE_ERR_HEADER_MISMATCH'
  | 'RESTORE_ERR_SCHEMA_VALIDATION'
  | 'RESTORE_ERR_ROW_COUNT_MISMATCH'
  | 'RESTORE_ERR_CHECKSUM_MISMATCH'
  | 'RESTORE_ERR_TABLE_CHECKSUM_MISMATCH'
  | 'RESTORE_ERR_INVARIANT_FAILED'
  | 'RESTORE_ERR_INVALID_FINANCIAL_INVARIANT'
  | 'RESTORE_ERR_INTEGRITY_CHECK_FAILED'
  | 'RESTORE_ERR_FK_CHECK_FAILED'
  | 'RESTORE_ERR_SAFETY_SNAPSHOT_FAILED'
  | 'RESTORE_ERR_CONCURRENT_OPERATION'
  | 'RESTORE_ERR_PROMOTION_FAILED'
  | 'RESTORE_ERR_ACTIVATION_FAILED'
  | 'RESTORE_ERR_POST_ACTIVATION_VERIFICATION_FAILED'
  | 'RESTORE_ERR_ROLLBACK_SUCCEEDED'
  | 'RESTORE_ERR_MANUAL_RECOVERY_AVAILABLE'
  | 'RESTORE_ERR_ROLLBACK_FAILED'
  | 'RESTORE_ERR_RECOVERY_REQUIRED';

export class BackupError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export class RestoreError extends Error {
  constructor(
    public readonly code: RestoreErrorCode,
    message: string,
    public readonly outcome?: RollbackOutcome
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}
