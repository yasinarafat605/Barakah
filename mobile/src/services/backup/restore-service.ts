/**
 * Verified Restore Pipeline & Staging Promotion Engine
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - Decoupled inspection and verification (preview without mutating live database)
 * - Isolated staging database validation & integrity verification
 * - Header-to-manifest metadata consistency enforcement
 * - Fail-closed pre-restore safety snapshot before promotion
 * - Safe atomic promotion with FileSystem.moveAsync, old database preservation, and automatic rollback
 * - Post-activation verification: PRAGMA integrity_check, foreign_key_check, row counts, table checksums, invariants
 * - Cleanup of staging WAL/SHM artifacts on success and failure
 * - Concurrency lock preventing concurrent backups or restores
 * - Zero silent repairs (ADR-016)
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from '../../db/types';
import { getDatabase, closeDatabase, runExclusiveTransaction } from '../../db/client';
import { runMigrations } from '../../db/migrations';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../../db/migrations/registry';
import * as Crypto from 'expo-crypto';
import {
  RestoreError,
  RestorePreview,
  BackupHeader,
  BackupManifest,
  BackupPayloadData,
  TableChecksums,
  RestoreJournal,
  RestoreJournalEnvelope,
  RestorePromotionPhase,
  PORTABLE_FINANCIAL_TABLES,
  CURRENT_DATABASE_SCHEMA_VERSION,
  HEADER_SIZE_BYTES,
  TAG_SIZE_BYTES,
  MAX_BACKUP_FILE_SIZE_BYTES,
  FLAG_COMPRESSED_DEFLATE,
} from './types';
import {
  parseHeader,
  deriveKeyFromPassphrase,
  decryptPayloadWithHeader,
  computeSha256Hex,
  getSecureRandomBytes,
} from './crypto';
import {
  decompressPayload,
  validateManifestStructure,
  validateHeaderManifestConsistency,
  computeTableChecksums,
  computeLegacyTableChecksums,
  canonicalJsonStringify,
} from './serializer';
import {
  validateAccountRow,
  validateCategoryRow,
  validateTransactionRow,
  validateCounterpartyRow,
  validateDebtRow,
  validateDebtTransactionRow,
  validateBudgetRow,
  validateBudgetCategoryRow,
  validateSavingsGoalRow,
  validateSavingsGoalEntryRow,
  validateSchemaMigrationRow,
  validatePayloadInvariants,
} from './validation';
import { utcCivilDateFromTimestamp } from '../../domain/civil-date';
import {
  createPreRestoreSafetySnapshot,
  getActiveDatabaseUri,
} from './safety';
import { isBackupOrRestoreInProgress, setOperationInProgress } from './backup-service';

export interface DecryptedBackupContext {
  header: BackupHeader;
  manifest: BackupManifest;
  preview: RestorePreview;
  envelopeBytes: Uint8Array;
}

export const RESTORE_JOURNAL_FILENAME = 'barakah_restore_journal.json';
export const RESTORE_JOURNAL_TMP_FILENAME = 'barakah_restore_journal.json.tmp';
export const RESTORE_JOURNAL_BAK_FILENAME = 'barakah_restore_journal.json.bak';
export const LEGACY_RESTORE_JOURNAL_FILENAME = 'restore_journal.json';

export function getRestoreJournalUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}SQLite/${RESTORE_JOURNAL_FILENAME}`;
}

export function getRestoreJournalTmpUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}SQLite/${RESTORE_JOURNAL_TMP_FILENAME}`;
}

export function getRestoreJournalBakUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}SQLite/${RESTORE_JOURNAL_BAK_FILENAME}`;
}

export function getLegacyRestoreJournalUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}SQLite/${LEGACY_RESTORE_JOURNAL_FILENAME}`;
}

/**
 * Generates a cryptographically random operation identifier.
 */
export function generateSecureOperationId(): string {
  if (typeof (Crypto as any)?.randomUUID === 'function') {
    try {
      return `restore_${(Crypto as any).randomUUID()}`;
    } catch {}
  }
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try {
      return `restore_${globalThis.crypto.randomUUID()}`;
    } catch {}
  }
  const bytes = getSecureRandomBytes(16);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `restore_${hex}`;
}

/**
 * Computes a deterministic SHA-256 digest covering all portable financial table checksums.
 */
export function computeManifestDigest(tableChecksums: TableChecksums | Record<string, string>): string {
  const parts = PORTABLE_FINANCIAL_TABLES.map((t) => `${t}:${(tableChecksums as any)[t] || ''}`).join(';');
  return computeSha256Hex(parts);
}

/**
 * Restricts every path to approved application SQLite and snapshot directories,
 * rejecting '..', foreign directories, backslashes, and unexpected filenames.
 */
export function validateJournalPath(
  path: unknown,
  allowedKinds: ('active' | 'staging' | 'recoveryOld' | 'snapshot')[]
): boolean {
  if (typeof path !== 'string' || !path.trim()) return false;
  if (!FileSystem.documentDirectory) return false;

  // Reject path traversal and backslashes
  if (path.includes('..') || path.includes('\\')) return false;

  const baseDir = `${FileSystem.documentDirectory}SQLite/`;
  const snapshotsDir = `${FileSystem.documentDirectory}SQLite/safety_snapshots/`;

  const isInBaseDir = path.startsWith(baseDir);
  const isInSnapshotsDir = path.startsWith(snapshotsDir);

  if (!isInBaseDir && !isInSnapshotsDir) return false;

  const fileName = path.split('/').pop();
  if (!fileName) return false;

  return allowedKinds.some((kind) => {
    switch (kind) {
      case 'active':
        return isInBaseDir && !isInSnapshotsDir && fileName === 'barakah.db';
      case 'staging':
        return isInBaseDir && !isInSnapshotsDir && fileName.startsWith('staging_restore_') && fileName.endsWith('.db');
      case 'recoveryOld':
        return isInBaseDir && !isInSnapshotsDir && fileName.startsWith('barakah.db.old_');
      case 'snapshot':
        return (
          isInSnapshotsDir &&
          (fileName.startsWith('pre_migration_') || fileName.startsWith('pre_restore_')) &&
          fileName.endsWith('.db')
        );
      default:
        return false;
    }
  });
}

function validateJournalEnvelopeContent(content: string): {
  valid: boolean;
  journal?: RestoreJournal;
  error?: string;
} {
  if (!content || !content.trim()) {
    return { valid: false, error: 'Empty journal content' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    return { valid: false, error: `Invalid JSON: ${err?.message || 'Parse error'}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'Journal root is not an object' };
  }

  const root = parsed as Record<string, unknown>;
  let payload: unknown;

  if (root.version === 2 && typeof root.checksum === 'string' && root.payload) {
    // Envelope format
    const expectedChecksum = computeSha256Hex(canonicalJsonStringify(root.payload));
    if (root.checksum !== expectedChecksum) {
      return { valid: false, error: 'Journal checksum mismatch' };
    }
    payload = root.payload;
  } else {
    return { valid: false, error: 'Unsupported or malformed restore journal version' };
  }

  const j = payload as Partial<RestoreJournal>;
  if (j.journalVersion !== 2) {
    return { valid: false, error: 'Unsupported journalVersion' };
  }
  if (!Number.isSafeInteger(j.generation) || (j.generation ?? -1) < 0) {
    return { valid: false, error: 'Missing or invalid generation' };
  }
  if (typeof j.operationId !== 'string' || !j.operationId.trim()) {
    return { valid: false, error: 'Missing or invalid operationId' };
  }
  const validPhases: RestorePromotionPhase[] = [
    'initialized',
    'active_moved_to_old',
    'staging_moved_to_active',
    'activation_verified',
    'rollback_candidate_verified',
    'rollback_restored_verified',
    'complete',
  ];
  if (!j.phase || !validPhases.includes(j.phase)) {
    return { valid: false, error: `Invalid phase: ${String(j.phase)}` };
  }
  if (!validateJournalPath(j.activePath, ['active'])) {
    return { valid: false, error: 'Invalid or unsafe activePath' };
  }
  if (j.phase !== 'complete') {
    if (!validateJournalPath(j.stagingPath, ['staging'])) {
      return { valid: false, error: 'Invalid or unsafe stagingPath' };
    }
    if (!validateJournalPath(j.recoveryOldPath, ['recoveryOld'])) {
      return { valid: false, error: 'Invalid or unsafe recoveryOldPath' };
    }
  }
  if (j.safetySnapshotPath !== null && !validateJournalPath(j.safetySnapshotPath, ['snapshot'])) {
    return { valid: false, error: 'Invalid or unsafe safetySnapshotPath' };
  }
  if (j.recoverySourcePath !== null && !validateJournalPath(j.recoverySourcePath, ['active', 'recoveryOld', 'snapshot'])) {
    return { valid: false, error: 'Invalid or unsafe recoverySourcePath' };
  }
  if (j.completionIdentity !== null && j.completionIdentity !== 'original' && j.completionIdentity !== 'destination') {
    return { valid: false, error: 'Invalid completionIdentity' };
  }
  if (j.phase === 'complete' && j.completionIdentity === null) {
    return { valid: false, error: 'Complete journal is missing completionIdentity' };
  }
  if (typeof j.expectedOriginalPortableDigest !== 'string' || !/^[a-f0-9]{64}$/.test(j.expectedOriginalPortableDigest)) {
    return { valid: false, error: 'Missing or invalid expectedOriginalPortableDigest' };
  }
  if (typeof j.expectedDestinationPortableDigest !== 'string' || !/^[a-f0-9]{64}$/.test(j.expectedDestinationPortableDigest)) {
    return { valid: false, error: 'Missing or invalid expectedDestinationPortableDigest' };
  }
  if (typeof j.updatedAtMs !== 'number' || isNaN(j.updatedAtMs) || j.updatedAtMs <= 0) {
    return { valid: false, error: 'Missing or invalid updatedAtMs' };
  }

  return {
    valid: true,
    journal: {
      journalVersion: 2,
      generation: j.generation!,
      operationId: j.operationId!,
      activePath: j.activePath!,
      stagingPath: j.stagingPath || '',
      recoveryOldPath: j.recoveryOldPath || '',
      safetySnapshotPath: j.safetySnapshotPath ?? null,
      recoverySourcePath: j.recoverySourcePath ?? null,
      completionIdentity: j.completionIdentity ?? null,
      expectedOriginalPortableDigest: j.expectedOriginalPortableDigest!,
      expectedDestinationPortableDigest: j.expectedDestinationPortableDigest!,
      phase: j.phase!,
      updatedAtMs: j.updatedAtMs!,
    },
  };
}

export interface JournalReadResult {
  journal: RestoreJournal | null;
  corrupt: boolean;
  errorDetail?: string;
  sourceUri?: string;
}

/**
 * Reads and validates restore journal from filesystem.
 * If corrupt, truncated, or invalid data is encountered, flags corrupt: true.
 * Fallback to .bak generation is attempted if the primary journal is damaged.
 */
export async function readRestoreJournalWithStatus(): Promise<JournalReadResult> {
  const journalUri = getRestoreJournalUri();
  const bakUri = getRestoreJournalBakUri();
  const legacyUri = getLegacyRestoreJournalUri();
  const tmpUri = getRestoreJournalTmpUri();

  if (!journalUri) return { journal: null, corrupt: false };

  const candidates: { uri: string | null; isBak?: boolean }[] = [
    { uri: journalUri },
    { uri: bakUri, isBak: true },
    { uri: legacyUri },
    { uri: tmpUri },
  ];

  let anyFileExists = false;
  let firstCorruptionError: string | undefined;

  for (const candidate of candidates) {
    if (!candidate.uri) continue;
    try {
      const info = await FileSystem.getInfoAsync(candidate.uri);
      if (!info.exists) continue;
      anyFileExists = true;

      const content = await FileSystem.readAsStringAsync(candidate.uri);
      const validation = validateJournalEnvelopeContent(content);
      if (validation.valid && validation.journal) {
        return {
          journal: validation.journal,
          corrupt: false,
          sourceUri: candidate.uri,
        };
      } else {
        if (validation.error?.startsWith('Unsupported')) {
          return {
            journal: null,
            corrupt: true,
            errorDetail: validation.error,
            sourceUri: candidate.uri,
          };
        }
        if (!firstCorruptionError) {
          firstCorruptionError = validation.error;
        }
      }
    } catch (err: any) {
      anyFileExists = true;
      if (!firstCorruptionError) {
        firstCorruptionError = err?.message || 'Read failure';
      }
    }
  }

  if (anyFileExists) {
    return {
      journal: null,
      corrupt: true,
      errorDetail: firstCorruptionError || 'Invalid or unreadable journal format',
    };
  }

  return { journal: null, corrupt: false };
}

export async function readRestoreJournal(): Promise<RestoreJournal | null> {
  const result = await readRestoreJournalWithStatus();
  return result.journal;
}

/**
 * Writes the restore journal with two-phase commit:
 * 1. Write envelope ({ version: 2, checksum, payload }) to .tmp file.
 * 2. Copy current journal to .bak if it exists (retaining previous valid generation).
 * 3. Safely move .tmp file to active journal.
 */
export async function writeRestoreJournal(journal: RestoreJournal): Promise<void> {
  const journalUri = getRestoreJournalUri();
  const tmpUri = getRestoreJournalTmpUri();
  const bakUri = getRestoreJournalBakUri();
  if (!journalUri || !tmpUri || !bakUri) return;

  const envelope: RestoreJournalEnvelope = {
    version: 2,
    checksum: computeSha256Hex(canonicalJsonStringify(journal)),
    payload: journal,
  };
  const content = JSON.stringify(envelope, null, 2);

  // 1. Write to temporary file
  await FileSystem.writeAsStringAsync(tmpUri, content);

  // 2. Retain previous valid journal generation in .bak
  const info = await FileSystem.getInfoAsync(journalUri);
  if (info.exists) {
    try {
      await FileSystem.copyAsync({ from: journalUri, to: bakUri });
    } catch {
      // Non-fatal backup copy
    }
  }

  // 3. Promote temporary file to primary journal
  await FileSystem.moveAsync({ from: tmpUri, to: journalUri });
}

const ALLOWED_RESTORE_TRANSITIONS: Readonly<Record<RestorePromotionPhase, readonly RestorePromotionPhase[]>> = {
  initialized: ['active_moved_to_old', 'rollback_candidate_verified', 'rollback_restored_verified'],
  active_moved_to_old: ['staging_moved_to_active', 'rollback_candidate_verified'],
  staging_moved_to_active: ['activation_verified', 'rollback_candidate_verified'],
  activation_verified: ['complete', 'rollback_candidate_verified'],
  rollback_candidate_verified: ['rollback_restored_verified'],
  rollback_restored_verified: ['complete'],
  complete: [],
};

export function createRestoreJournalTransition(
  current: RestoreJournal,
  nextPhase: RestorePromotionPhase,
  expectedOperationId: string,
  expectedGeneration: number,
  updates: Partial<Pick<RestoreJournal, 'recoverySourcePath' | 'completionIdentity'>> = {}
): RestoreJournal {
  if (
    current.journalVersion !== 2 ||
    current.operationId !== expectedOperationId ||
    current.generation !== expectedGeneration
  ) {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'Restore journal identity or generation could not be proven. Recovery candidates were preserved.'
    );
  }

  if (!ALLOWED_RESTORE_TRANSITIONS[current.phase]?.includes(nextPhase)) {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'Illegal restore journal transition. Recovery candidates were preserved.'
    );
  }

  if (nextPhase === 'rollback_candidate_verified' && !updates.recoverySourcePath) {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'A verified rollback source was not recorded. Recovery candidates were preserved.'
    );
  }
  if (nextPhase === 'complete') {
    const requiredIdentity = current.phase === 'activation_verified' ? 'destination' : 'original';
    if (updates.completionIdentity !== requiredIdentity) {
      throw new RestoreError(
        'RESTORE_ERR_RECOVERY_REQUIRED',
        'Restore completion identity could not be proven. Recovery candidates were preserved.'
      );
    }
  }

  return {
    ...current,
    ...updates,
    phase: nextPhase,
    generation: current.generation + 1,
    updatedAtMs: Date.now(),
  };
}

export async function transitionRestoreJournal(
  current: RestoreJournal,
  nextPhase: RestorePromotionPhase,
  updates: Partial<Pick<RestoreJournal, 'recoverySourcePath' | 'completionIdentity'>> = {}
): Promise<RestoreJournal> {
  const before = await readRestoreJournalWithStatus();
  if (
    before.corrupt ||
    !before.journal ||
    before.journal.operationId !== current.operationId ||
    before.journal.generation !== current.generation ||
    before.journal.phase !== current.phase
  ) {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'Persisted restore journal state could not be proven. Recovery candidates were preserved.'
    );
  }

  const next = createRestoreJournalTransition(
    current,
    nextPhase,
    current.operationId,
    current.generation,
    updates
  );
  try {
    await writeRestoreJournal(next);
    const after = await readRestoreJournalWithStatus();
    if (
      after.corrupt ||
      !after.journal ||
      after.journal.operationId !== next.operationId ||
      after.journal.generation !== next.generation ||
      after.journal.phase !== next.phase
    ) {
      throw new Error('transition verification failed');
    }
  } catch {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'Restore journal transition was not durably persisted. Recovery candidates were preserved.'
    );
  }
  return next;
}

export async function clearRestoreJournal(): Promise<void> {
  const journalUri = getRestoreJournalUri();
  const tmpUri = getRestoreJournalTmpUri();
  const bakUri = getRestoreJournalBakUri();
  const legacyUri = getLegacyRestoreJournalUri();

  if (journalUri) {
    try { await FileSystem.deleteAsync(journalUri, { idempotent: true }); } catch {}
  }
  if (tmpUri) {
    try { await FileSystem.deleteAsync(tmpUri, { idempotent: true }); } catch {}
  }
  if (bakUri) {
    try { await FileSystem.deleteAsync(bakUri, { idempotent: true }); } catch {}
  }
  if (legacyUri) {
    try { await FileSystem.deleteAsync(legacyUri, { idempotent: true }); } catch {}
  }
}

/**
 * Removes disposable staging artifacts.
 * Rules:
 * - If journal is corrupt, preserve all recovery candidates.
 * - Delete disposable staging artifacts only when no active restore journal references them.
 * - Never delete .old_* recovery databases solely because of their filename.
 * - Verify the active database and journal state first.
 * - Retain unresolved recovery candidates.
 */
export async function cleanStaleStagingArtifacts(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
    const info = await FileSystem.getInfoAsync(sqliteDir);
    if (!info.exists) return;

    const journalResult = await readRestoreJournalWithStatus();
    if (journalResult.corrupt) {
      return;
    }

    const protectedPaths = new Set<string>();
    if (journalResult.journal) {
      if (journalResult.journal.stagingPath) protectedPaths.add(journalResult.journal.stagingPath);
      if (journalResult.journal.recoveryOldPath) protectedPaths.add(journalResult.journal.recoveryOldPath);
      if (journalResult.journal.safetySnapshotPath) protectedPaths.add(journalResult.journal.safetySnapshotPath);
    }

    const files = await FileSystem.readDirectoryAsync(sqliteDir);
    for (const f of files) {
      const fullPath = `${sqliteDir}${f}`;

      // NEVER delete barakah.db.old_* files in stale artifact cleanup!
      if (f.startsWith('barakah.db.old_')) {
        continue;
      }

      // Delete disposable staging artifacts only when no active restore journal references them
      if (f.startsWith('staging_restore_')) {
        if (!protectedPaths.has(fullPath) && !protectedPaths.has(f)) {
          try {
            await FileSystem.deleteAsync(fullPath, { idempotent: true });
          } catch {
            // Keep cleanup failure non-fatal
          }
        }
      }
    }
  } catch {
    // Non-fatal cleanup
  }
}

async function readPortablePayload(db: DatabaseConnection): Promise<BackupPayloadData> {
  return {
    accounts: await db.getAllAsync<any>('SELECT * FROM accounts ORDER BY id ASC;'),
    categories: await db.getAllAsync<any>('SELECT * FROM categories ORDER BY id ASC;'),
    transactions: await db.getAllAsync<any>('SELECT * FROM transactions ORDER BY id ASC;'),
    counterparties: await db.getAllAsync<any>('SELECT * FROM counterparties ORDER BY id ASC;'),
    debts: await db.getAllAsync<any>('SELECT * FROM debts ORDER BY id ASC;'),
    debt_transactions: await db.getAllAsync<any>('SELECT * FROM debt_transactions ORDER BY id ASC;'),
    budgets: await db.getAllAsync<any>('SELECT * FROM budgets ORDER BY id ASC;'),
    budget_categories: await db.getAllAsync<any>('SELECT * FROM budget_categories ORDER BY id ASC;'),
    savings_goals: await db.getAllAsync<any>('SELECT * FROM savings_goals ORDER BY id ASC;'),
    savings_goal_entries: await db.getAllAsync<any>('SELECT * FROM savings_goal_entries ORDER BY id ASC;'),
    schema_migrations: await db.getAllAsync<any>('SELECT * FROM schema_migrations ORDER BY version ASC;'),
  };
}

export async function computeDatabasePortableDigest(
  db: DatabaseConnection,
  useConsistentTransaction = false
): Promise<string> {
  const payload = useConsistentTransaction
    ? await runExclusiveTransaction(db, (txn) => readPortablePayload(txn))
    : await readPortablePayload(db);
  return computeManifestDigest(computeTableChecksums(payload));
}

async function verifyOpenDatabasePortableIdentity(
  db: DatabaseConnection,
  expectedDigest: string
): Promise<boolean> {
  const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
  const fkViolations = await db.getAllAsync('PRAGMA foreign_key_check;');
  if (integrity?.integrity_check !== 'ok' || fkViolations.length > 0) return false;
  return (await computeDatabasePortableDigest(db)) === expectedDigest;
}

/** Verifies structural integrity and the complete portable financial-table identity. */
async function verifyDatabasePortableIdentity(dbPath: string, expectedDigest: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(dbPath);
    if (!info.exists) return false;

    if (!FileSystem.documentDirectory) return false;
    const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
    let dbName = '';
    let tempUri: string | null = null;

    if (dbPath.startsWith(sqliteDir)) {
      dbName = dbPath.slice(sqliteDir.length);
    } else {
      dbName = `temp_digest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`;
      tempUri = `${sqliteDir}${dbName}`;
      await FileSystem.copyAsync({ from: dbPath, to: tempUri });
    }

    const testDb = await SQLite.openDatabaseAsync(dbName);
    try {
      const valid = await verifyOpenDatabasePortableIdentity(testDb as unknown as DatabaseConnection, expectedDigest);
      await testDb.closeAsync();
      if (tempUri) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
        await FileSystem.deleteAsync(`${tempUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${tempUri}-shm`, { idempotent: true });
      }

      return valid;
    } catch {
      try { await testDb.closeAsync(); } catch {}
      if (tempUri) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Detects an incomplete restore journal on application startup and recovers safely according to durable phase.
 * Must be executed before opening or migrating the live database.
 */
export async function recoverFromInterruptedRestore(): Promise<void> {
  const journalResult = await readRestoreJournalWithStatus();

  // If corrupt journal data is detected, NEVER interpret as "no journal"!
  if (journalResult.corrupt) {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      `Corrupt or invalid restore journal detected: ${journalResult.errorDetail || 'unreadable format'}. Recovery files preserved. Manual recovery required.`
    );
  }

  const initialJournal = journalResult.journal;
  if (!initialJournal) return;
  let journal: RestoreJournal = initialJournal;

  const activeDbUri = journal.activePath || getActiveDatabaseUri();
  if (!activeDbUri) return;

  const failClosed = (): never => {
    throw new RestoreError(
      'RESTORE_ERR_RECOVERY_REQUIRED',
      'Safe automatic restore recovery could not be proven. All recovery candidates were preserved.'
    );
  };

  const finishComplete = async (): Promise<void> => {
    if (journal.phase !== 'complete' || !journal.completionIdentity) failClosed();
    const expected = journal.completionIdentity === 'destination'
      ? journal.expectedDestinationPortableDigest
      : journal.expectedOriginalPortableDigest;
    if (!(await verifyDatabasePortableIdentity(activeDbUri, expected))) failClosed();
    if (journal.recoveryOldPath) {
      await FileSystem.deleteAsync(journal.recoveryOldPath, { idempotent: true });
    }
    if (journal.stagingPath) {
      await FileSystem.deleteAsync(journal.stagingPath, { idempotent: true });
      await FileSystem.deleteAsync(`${journal.stagingPath}-wal`, { idempotent: true });
      await FileSystem.deleteAsync(`${journal.stagingPath}-shm`, { idempotent: true });
    }
    await clearRestoreJournal();
  };

  const restoreVerifiedOriginal = async (sourcePath: string): Promise<void> => {
    if (!(await verifyDatabasePortableIdentity(sourcePath, journal.expectedOriginalPortableDigest))) failClosed();
    if (journal.phase !== 'rollback_candidate_verified') {
      journal = await transitionRestoreJournal(journal, 'rollback_candidate_verified', {
        recoverySourcePath: sourcePath,
      });
    }
    await FileSystem.deleteAsync(activeDbUri, { idempotent: true });
    await FileSystem.deleteAsync(`${activeDbUri}-wal`, { idempotent: true });
    await FileSystem.deleteAsync(`${activeDbUri}-shm`, { idempotent: true });
    await FileSystem.copyAsync({ from: sourcePath, to: activeDbUri });
    if (!(await verifyDatabasePortableIdentity(activeDbUri, journal.expectedOriginalPortableDigest))) failClosed();
    journal = await transitionRestoreJournal(journal, 'rollback_restored_verified');
    journal = await transitionRestoreJournal(journal, 'complete', { completionIdentity: 'original' });
    await finishComplete();
  };

  if (journal.phase === 'complete') {
    await finishComplete();
    return;
  }

  if (journal.phase === 'rollback_restored_verified') {
    if (!(await verifyDatabasePortableIdentity(activeDbUri, journal.expectedOriginalPortableDigest))) failClosed();
    journal = await transitionRestoreJournal(journal, 'complete', { completionIdentity: 'original' });
    await finishComplete();
    return;
  }

  if (journal.phase === 'rollback_candidate_verified') {
    const recoverySourcePath = journal.recoverySourcePath;
    if (!recoverySourcePath) return failClosed();
    await restoreVerifiedOriginal(recoverySourcePath);
    return;
  }

  if (journal.phase === 'activation_verified') {
    if (!(await verifyDatabasePortableIdentity(activeDbUri, journal.expectedDestinationPortableDigest))) failClosed();
    journal = await transitionRestoreJournal(journal, 'complete', { completionIdentity: 'destination' });
    await finishComplete();
    return;
  }

  if (journal.phase === 'initialized') {
    if (await verifyDatabasePortableIdentity(activeDbUri, journal.expectedOriginalPortableDigest)) {
      journal = await transitionRestoreJournal(journal, 'rollback_restored_verified');
      journal = await transitionRestoreJournal(journal, 'complete', { completionIdentity: 'original' });
      await finishComplete();
      return;
    }
  }

  const candidates = [journal.recoveryOldPath, journal.safetySnapshotPath].filter(
    (path): path is string => Boolean(path)
  );
  for (const candidate of candidates) {
    if (await verifyDatabasePortableIdentity(candidate, journal.expectedOriginalPortableDigest)) {
      await restoreVerifiedOriginal(candidate);
      return;
    }
  }

  failClosed();
}

/**
 * Reads and inspects only the 60-byte public header from an .fmz file without decrypting.
 * Used for pre-flight validation and displaying metadata before prompting for passphrase.
 */
export async function inspectBackupHeader(envelopeBytes: Uint8Array): Promise<BackupHeader> {
  if (envelopeBytes.length < HEADER_SIZE_BYTES + TAG_SIZE_BYTES) {
    throw new RestoreError(
      'RESTORE_ERR_FILE_TRUNCATED',
      `File truncated: minimum size is ${HEADER_SIZE_BYTES + TAG_SIZE_BYTES} bytes, received ${envelopeBytes.length}.`
    );
  }

  if (envelopeBytes.length > MAX_BACKUP_FILE_SIZE_BYTES) {
    throw new RestoreError(
      'RESTORE_ERR_FILE_TOO_LARGE',
      `File size exceeds maximum allowable limit (${envelopeBytes.length} > ${MAX_BACKUP_FILE_SIZE_BYTES} bytes).`
    );
  }

  return parseHeader(envelopeBytes);
}

/**
 * Decrypts, decompresses, and validates a backup payload without touching the live database.
 * Returns preview statistics and verified context.
 */
export async function verifyAndPreviewBackup(
  db: DatabaseConnection,
  envelopeBytes: Uint8Array,
  passphrase: string
): Promise<DecryptedBackupContext> {
  // 1. Inspect header
  const header = await inspectBackupHeader(envelopeBytes);

  // 2. Derive key
  const derivedKey = await deriveKeyFromPassphrase(passphrase, header.salt, {
    N: header.kdfN,
    r: header.kdfR,
    p: header.kdfP,
  });

  // 3. Authenticate and decrypt ciphertext (AES-256-GCM)
  const ciphertextWithTag = envelopeBytes.slice(HEADER_SIZE_BYTES);
  const decryptedBytes = decryptPayloadWithHeader(ciphertextWithTag, derivedKey, header);

  // 4. Bounded decompression if compressed flag is set
  let jsonString = '';
  if ((header.flags & FLAG_COMPRESSED_DEFLATE) !== 0) {
    jsonString = decompressPayload(decryptedBytes);
  } else {
    jsonString = new TextDecoder().decode(decryptedBytes);
  }

  // 5. Parse JSON
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonString);
  } catch (err: unknown) {
    throw new RestoreError(
      'RESTORE_ERR_INVALID_JSON',
      `Invalid JSON payload: ${err instanceof Error ? err.message : 'Parse error'}`
    );
  }

  // 6. Validate manifest structure & row counts against decoded arrays
  const manifest = validateManifestStructure(rawJson);

  // 7. Validate header-to-manifest consistency
  validateHeaderManifestConsistency(header, manifest);

  // 8. Verify legacy v1 checksums before adding deterministic Phase 5 defaults.
  // Existing backups remain readable, while every restored staging database is
  // normalized to the current portable-data shape.
  const rawPayload = manifest.payload as unknown as Record<string, any[]>;
  let legacyChecksums: Record<string, string> | null = null;
  if (manifest.manifestVersion === 1) {
    legacyChecksums = computeLegacyTableChecksums(rawPayload);
    rawPayload.accounts = rawPayload.accounts.map((row) => ({ ...row, archived_at: null }));
    rawPayload.transactions = rawPayload.transactions.map((row) => ({
      ...row,
      occurred_on: utcCivilDateFromTimestamp(row.timestamp),
    }));
    rawPayload.budgets = [];
    rawPayload.budget_categories = [];
    rawPayload.savings_goals = [];
    rawPayload.savings_goal_entries = [];
  }

  // 9. Strict row validation without silent normalization for current backups.
  const accounts = rawPayload.accounts.map((row, idx) => validateAccountRow(row, idx));
  const categories = rawPayload.categories.map((row, idx) => validateCategoryRow(row, idx));
  const transactions = rawPayload.transactions.map((row, idx) => validateTransactionRow(row, idx));
  const counterparties = rawPayload.counterparties.map((row, idx) => validateCounterpartyRow(row, idx));
  const debts = rawPayload.debts.map((row, idx) => validateDebtRow(row, idx));
  const debt_transactions = rawPayload.debt_transactions.map((row, idx) => validateDebtTransactionRow(row, idx));
  const budgets = rawPayload.budgets.map((row, idx) => validateBudgetRow(row, idx));
  const budget_categories = rawPayload.budget_categories.map((row, idx) => validateBudgetCategoryRow(row, idx));
  const savings_goals = rawPayload.savings_goals.map((row, idx) => validateSavingsGoalRow(row, idx));
  const savings_goal_entries = rawPayload.savings_goal_entries.map((row, idx) => validateSavingsGoalEntryRow(row, idx));
  const schema_migrations = rawPayload.schema_migrations.map((row, idx) => validateSchemaMigrationRow(row, idx));

  const validatedPayload: BackupPayloadData = {
    accounts,
    categories,
    transactions,
    counterparties,
    debts,
    debt_transactions,
    budgets,
    budget_categories,
    savings_goals,
    savings_goal_entries,
    schema_migrations,
  };

  // 10. Cross-table invariants & relations validation
  validatePayloadInvariants(validatedPayload);

  if (legacyChecksums) {
    const sourceChecksums = manifest.tableChecksums as unknown as Record<string, string>;
    for (const [table, checksum] of Object.entries(legacyChecksums)) {
      if (sourceChecksums[table] !== checksum) {
        throw new RestoreError('RESTORE_ERR_CHECKSUM_MISMATCH', `Table checksum mismatch on '${table}'. Backup payload may have been corrupted.`);
      }
    }
  }

  // 11. Current-manifest table checksum verification. Legacy source checksums
  // were verified above before normalization.
  const computedChecksums = computeTableChecksums(validatedPayload);
  if (manifest.manifestVersion === 2) for (const table of Object.keys(computedChecksums) as (keyof typeof computedChecksums)[]) {
    if (computedChecksums[table] !== manifest.tableChecksums[table]) {
      throw new RestoreError(
        'RESTORE_ERR_CHECKSUM_MISMATCH',
        `Table checksum mismatch on '${table}'. Backup payload may have been corrupted.`
      );
    }
  }

  // 11. Fetch current live database row counts for preview comparison
  let liveRowCounts = {
    accounts: 0,
    categories: 0,
    transactions: 0,
    counterparties: 0,
    debts: 0,
    debt_transactions: 0,
    budgets: 0,
    budget_categories: 0,
    savings_goals: 0,
    savings_goal_entries: 0,
  };

  try {
    const aCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM accounts;');
    const cCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM categories;');
    const tCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM transactions;');
    const cpCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM counterparties;');
    const dCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debts;');
    const dtCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debt_transactions;');
    const bCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM budgets;');
    const bcCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM budget_categories;');
    const gCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM savings_goals;');
    const geCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM savings_goal_entries;');

    liveRowCounts = {
      accounts: aCount?.c ?? 0,
      categories: cCount?.c ?? 0,
      transactions: tCount?.c ?? 0,
      counterparties: cpCount?.c ?? 0,
      debts: dCount?.c ?? 0,
      debt_transactions: dtCount?.c ?? 0,
      budgets: bCount?.c ?? 0,
      budget_categories: bcCount?.c ?? 0,
      savings_goals: gCount?.c ?? 0,
      savings_goal_entries: geCount?.c ?? 0,
    };
  } catch {
    // Live counts query failure is non-fatal for preview
  }

  const preview: RestorePreview = {
    createdAtMs: header.createdAtMs,
    schemaVersion: header.schemaVersion,
    appVersion: header.appVersion,
    rowCounts: {
      accounts: accounts.length,
      categories: categories.length,
      transactions: transactions.length,
      counterparties: counterparties.length,
      debts: debts.length,
      debt_transactions: debt_transactions.length,
      budgets: budgets.length,
      budget_categories: budget_categories.length,
      savings_goals: savings_goals.length,
      savings_goal_entries: savings_goal_entries.length,
    },
    liveRowCounts,
  };

  return {
    header,
    manifest: {
      ...manifest,
      rowCounts: {
        accounts: accounts.length, categories: categories.length, transactions: transactions.length,
        counterparties: counterparties.length, debts: debts.length, debt_transactions: debt_transactions.length,
        budgets: budgets.length, budget_categories: budget_categories.length,
        savings_goals: savings_goals.length, savings_goal_entries: savings_goal_entries.length,
        schema_migrations: schema_migrations.length,
      },
      tableChecksums: computedChecksums,
      payload: validatedPayload,
    },
    preview,
    envelopeBytes,
  };
}

/**
 * Imports validated payload into an isolated staging database and runs full SQLite integrity checks.
 * Uses exclusive transaction with callback txn object for all writes.
 */
export async function populateAndVerifyStagingDatabase(
  stagingDb: DatabaseConnection,
  manifest: BackupManifest
): Promise<void> {
  // Apply all migrations to staging database to ensure target schema
  await runMigrations(stagingDb);

  // Clear any default seeded categories in staging so restored categories are exact
  await stagingDb.execAsync('DELETE FROM categories;');

  const p = manifest.payload;

  await runExclusiveTransaction(stagingDb, async (txn) => {
    // Accounts
    for (const a of p.accounts) {
      await txn.runAsync(
        'INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        a.id,
        a.name,
        a.type,
        a.initial_balance,
        a.currency,
        a.created_at,
        a.updated_at,
        a.archived_at
      );
    }

    // Categories
    for (const c of p.categories) {
      await txn.runAsync(
        'INSERT INTO categories (id, name_key, name_custom, icon, color, type, is_archived, sort_order, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        c.id,
        c.name_key,
        c.name_custom,
        c.icon,
        c.color,
        c.type,
        c.is_archived,
        c.sort_order,
        c.is_default,
        c.created_at,
        c.updated_at
      );
    }

    // Counterparties
    for (const cp of p.counterparties) {
      await txn.runAsync(
        'INSERT INTO counterparties (id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        cp.id,
        cp.name,
        cp.type,
        cp.phone,
        cp.email,
        cp.note,
        cp.avatar_color,
        cp.is_archived,
        cp.created_at,
        cp.updated_at
      );
    }

    // Debts
    for (const d of p.debts) {
      await txn.runAsync(
        'INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        d.id,
        d.counterparty_id,
        d.direction,
        d.original_principal,
        d.currency,
        d.opening_mode,
        d.opened_at,
        d.due_date,
        d.status,
        d.note,
        d.created_at,
        d.updated_at,
        d.archived_at,
        d.deleted_at
      );
    }

    // Transactions
    for (const t of p.transactions) {
      await txn.runAsync(
        'INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        t.id,
        t.account_id,
        t.category_id,
        t.amount,
        t.type,
        t.transfer_id,
        t.transfer_role,
        t.related_account_id,
        t.note,
        t.timestamp,
        t.occurred_on,
        t.created_at,
        t.updated_at,
        t.deleted_at
      );
    }

    // Debt Transactions
    for (const dt of p.debt_transactions) {
      await txn.runAsync(
        'INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        dt.id,
        dt.debt_id,
        dt.transaction_id,
        dt.amount,
        dt.role,
        dt.note,
        dt.occurred_at,
        dt.created_at,
        dt.updated_at,
        dt.deleted_at
      );
    }

    for (const b of p.budgets) {
      await txn.runAsync(
        'INSERT INTO budgets (id, name, period_type, starts_on, ends_on, currency, account_id, income_target, expense_limit, rollover_policy, rollover_from_budget_id, note, created_at, updated_at, archived_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        b.id, b.name, b.period_type, b.starts_on, b.ends_on, b.currency, b.account_id,
        b.income_target, b.expense_limit, b.rollover_policy, b.rollover_from_budget_id,
        b.note, b.created_at, b.updated_at, b.archived_at, b.deleted_at
      );
    }
    for (const bc of p.budget_categories) {
      await txn.runAsync(
        'INSERT INTO budget_categories (id, budget_id, category_id, amount, sort_order, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        bc.id, bc.budget_id, bc.category_id, bc.amount, bc.sort_order, bc.created_at, bc.updated_at, bc.deleted_at
      );
    }
    for (const g of p.savings_goals) {
      await txn.runAsync(
        'INSERT INTO savings_goals (id, name, preset_key, target_amount, currency, target_date, linked_account_id, lifecycle_status, completed_at, archived_at, note, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        g.id, g.name, g.preset_key, g.target_amount, g.currency, g.target_date, g.linked_account_id,
        g.lifecycle_status, g.completed_at, g.archived_at, g.note, g.created_at, g.updated_at, g.deleted_at
      );
    }
    for (const e of p.savings_goal_entries) {
      await txn.runAsync(
        'INSERT INTO savings_goal_entries (id, goal_id, entry_type, amount, link_mode, transaction_id, occurred_at, occurred_on, note, cascade_deleted_at, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        e.id, e.goal_id, e.entry_type, e.amount, e.link_mode, e.transaction_id, e.occurred_at,
        e.occurred_on, e.note, e.cascade_deleted_at, e.created_at, e.updated_at, e.deleted_at
      );
    }
  });

  // Checkpoint staging WAL to flush all data into main staging database file
  await stagingDb.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');

  // Run SQLite PRAGMA integrity_check
  const integrityResult = await stagingDb.getFirstAsync<{ integrity_check: string }>(
    'PRAGMA integrity_check;'
  );
  if (!integrityResult || integrityResult.integrity_check !== 'ok') {
    throw new RestoreError(
      'RESTORE_ERR_INTEGRITY_CHECK_FAILED',
      `Staging database failed integrity check: ${integrityResult?.integrity_check ?? 'unknown'}`
    );
  }

  // Run SQLite PRAGMA foreign_key_check
  const fkViolations = await stagingDb.getAllAsync('PRAGMA foreign_key_check;');
  if (fkViolations.length > 0) {
    throw new RestoreError(
      'RESTORE_ERR_FK_CHECK_FAILED',
      `Staging database has ${fkViolations.length} foreign key violation(s).`
    );
  }
}

/**
 * Runs post-activation integrity and domain-invariant verification on the newly promoted live database.
 * Policy:
 * - Treat schema_migrations as destination-derived operational metadata.
 * - Retain source migration details in the encrypted manifest for provenance.
 * - Do not require byte-identical source and destination migration-ledger checksums after migration.
 * - Verify that portable financial-table checksums match manifest independently.
 * - Verify destination schema_migrations against canonical migration checksums.
 */
async function verifyActivatedDatabase(
  newLiveDb: DatabaseConnection,
  manifest: BackupManifest
): Promise<void> {
  // 1. PRAGMA integrity_check
  const integrityCheck = await newLiveDb.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
  if (!integrityCheck || integrityCheck.integrity_check !== 'ok') {
    throw new Error(`Activated database failed PRAGMA integrity_check: ${integrityCheck?.integrity_check ?? 'unknown'}`);
  }

  // 2. PRAGMA foreign_key_check
  const fkViolations = await newLiveDb.getAllAsync('PRAGMA foreign_key_check;');
  if (fkViolations.length > 0) {
    throw new Error(`Activated database has ${fkViolations.length} foreign key violation(s).`);
  }

  // 3. Row count verification against manifest for portable financial tables
  const aCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM accounts;');
  const cCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM categories;');
  const tCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM transactions;');
  const cpCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM counterparties;');
  const dCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debts;');
  const dtCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debt_transactions;');
  const bCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM budgets;');
  const bcCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM budget_categories;');
  const gCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM savings_goals;');
  const geCount = await newLiveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM savings_goal_entries;');

  if (
    aCount?.c !== manifest.rowCounts.accounts ||
    cCount?.c !== manifest.rowCounts.categories ||
    tCount?.c !== manifest.rowCounts.transactions ||
    cpCount?.c !== manifest.rowCounts.counterparties ||
    dCount?.c !== manifest.rowCounts.debts ||
    dtCount?.c !== manifest.rowCounts.debt_transactions ||
    bCount?.c !== manifest.rowCounts.budgets ||
    bcCount?.c !== manifest.rowCounts.budget_categories ||
    gCount?.c !== manifest.rowCounts.savings_goals ||
    geCount?.c !== manifest.rowCounts.savings_goal_entries
  ) {
    throw new Error('Activated database row counts do not match manifest expectations.');
  }

  // 4. Read portable financial tables to verify independent table checksums and invariants
  const accounts = await newLiveDb.getAllAsync<any>('SELECT * FROM accounts ORDER BY id ASC;');
  const categories = await newLiveDb.getAllAsync<any>('SELECT * FROM categories ORDER BY id ASC;');
  const transactions = await newLiveDb.getAllAsync<any>('SELECT * FROM transactions ORDER BY id ASC;');
  const counterparties = await newLiveDb.getAllAsync<any>('SELECT * FROM counterparties ORDER BY id ASC;');
  const debts = await newLiveDb.getAllAsync<any>('SELECT * FROM debts ORDER BY id ASC;');
  const debt_transactions = await newLiveDb.getAllAsync<any>('SELECT * FROM debt_transactions ORDER BY id ASC;');
  const budgets = await newLiveDb.getAllAsync<any>('SELECT * FROM budgets ORDER BY id ASC;');
  const budget_categories = await newLiveDb.getAllAsync<any>('SELECT * FROM budget_categories ORDER BY id ASC;');
  const savings_goals = await newLiveDb.getAllAsync<any>('SELECT * FROM savings_goals ORDER BY id ASC;');
  const savings_goal_entries = await newLiveDb.getAllAsync<any>('SELECT * FROM savings_goal_entries ORDER BY id ASC;');
  const destMigrations = await newLiveDb.getAllAsync<any>('SELECT * FROM schema_migrations ORDER BY version ASC;');

  const livePayload: BackupPayloadData = {
    accounts,
    categories,
    transactions,
    counterparties,
    debts,
    debt_transactions,
    budgets,
    budget_categories,
    savings_goals,
    savings_goal_entries,
    schema_migrations: destMigrations,
  };

  // 5. Portable table checksum verification (compare portable financial tables independently)
  const computed = computeTableChecksums(livePayload);
  for (const table of PORTABLE_FINANCIAL_TABLES) {
    if (computed[table] !== manifest.tableChecksums[table]) {
      throw new Error(`Activated database table checksum mismatch on '${table}'.`);
    }
  }

  // 6. Verify destination schema_migrations against canonical migration checksums
  const destVersions = new Set(destMigrations.map((m: any) => m.version));
  for (let v = 1; v <= CURRENT_DATABASE_SCHEMA_VERSION; v++) {
    if (!destVersions.has(v)) {
      throw new Error(`Activated database is missing canonical migration version ${v}.`);
    }
  }
  for (const m of destMigrations) {
    const canonical = CANONICAL_MIGRATION_CHECKSUMS[m.version];
    if (canonical && m.checksum && m.checksum !== canonical) {
      throw new Error(`Activated database migration ${m.version} checksum mismatch with canonical ledger.`);
    }
  }

  // 7. Transfer and debt domain-invariant validation
  validatePayloadInvariants(livePayload);
}

/**
 * Executes full crash-recoverable staged replacement restore:
 * 1. Cleans unreferenced stale staging artifacts.
 * 2. Creates unique staging database.
 * 3. Populates staging and verifies its complete destination portable identity.
 * 4. Checkpoints and consistently captures the original portable identity.
 * 5. Creates a fail-closed pre-restore safety snapshot and closes live connections.
 * 6. Writes and verifies the version-2 'initialized' journal before movement.
 * 7. Moves active DB to recoveryOldPath and transitions to 'active_moved_to_old'.
 * 8. Moves staging DB to active path and transitions to 'staging_moved_to_active'.
 * 9. Reopens live data and verifies integrity, invariants, and destination identity.
 * 10. Transitions through 'activation_verified' to 'complete'.
 * 11. Prunes recovery data only after completion identity is durably recorded.
 * 12. Uses the same journaled identity state machine for automatic rollback.
 */
export async function executeRestore(
  liveDb: DatabaseConnection,
  context: DecryptedBackupContext
): Promise<void> {
  if (isBackupOrRestoreInProgress()) {
    throw new RestoreError(
      'RESTORE_ERR_PROMOTION_FAILED',
      'Another operation is currently running. Please wait.'
    );
  }

  setOperationInProgress(true);

  const operationId = generateSecureOperationId();
  const stagingDbName = `staging_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`;
  let stagingDb: DatabaseConnection | null = null;
  let safetySnapshotUri: string | null = null;
  let backupOldDbUri: string | null = null;
  let stagingDbUri: string | null = null;
  let activeDbUri: string | null = null;
  let currentJournal: RestoreJournal | null = null;
  let preserveStaging = false;
  let promotionStarted = false;
  const destinationPortableDigest = computeManifestDigest(context.manifest.tableChecksums);
  let originalPortableDigest: string | null = null;

  try {
    // 0. Remove unreferenced stale staging artifacts
    await cleanStaleStagingArtifacts();

    // 1. Create and open isolated staging database
    const expoDb = await SQLite.openDatabaseAsync(stagingDbName);
    stagingDb = expoDb as unknown as DatabaseConnection;
    await stagingDb.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);

    // 2. Populate and verify staging database
    await populateAndVerifyStagingDatabase(stagingDb, context.manifest);
    const stagingPortableDigest = await computeDatabasePortableDigest(stagingDb);
    if (stagingPortableDigest !== destinationPortableDigest) {
      throw new RestoreError(
        'RESTORE_ERR_CHECKSUM_MISMATCH',
        'Staging database portable-data identity does not match the verified backup.'
      );
    }

    // 3. Close staging database to prepare for staged replacement
    await stagingDb.closeAsync();
    stagingDb = null;

    // 4. Checkpoint and consistently capture the original identity before any filesystem movement.
    await liveDb.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    originalPortableDigest = await computeDatabasePortableDigest(liveDb, true);

    // 5. Fail-closed: create pre-restore safety snapshot of active live database
    safetySnapshotUri = await createPreRestoreSafetySnapshot(liveDb, context.header.schemaVersion);

    // 6. Close active live database connection
    await closeDatabase();

    // 7. Safe staged promotion on filesystem
    if (FileSystem.documentDirectory) {
      const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
      activeDbUri = getActiveDatabaseUri();
      stagingDbUri = `${sqliteDir}${stagingDbName}`;
      backupOldDbUri = `${sqliteDir}barakah.db.old_${Date.now()}`;

      if (activeDbUri) {
        if (!originalPortableDigest) {
          throw new RestoreError('RESTORE_ERR_RECOVERY_REQUIRED', 'Original database identity was not captured.');
        }

        // Persist restore journal before first filesystem move
        currentJournal = {
          journalVersion: 2,
          generation: 0,
          operationId,
          activePath: activeDbUri,
          stagingPath: stagingDbUri,
          recoveryOldPath: backupOldDbUri,
          safetySnapshotPath: safetySnapshotUri,
          recoverySourcePath: null,
          completionIdentity: null,
          expectedOriginalPortableDigest: originalPortableDigest,
          expectedDestinationPortableDigest: destinationPortableDigest,
          phase: 'initialized',
          updatedAtMs: Date.now(),
        };
        await writeRestoreJournal(currentJournal);

        // Verify valid journal persisted before moving or deleting any database
        const journalCheck = await readRestoreJournalWithStatus();
        if (
          !journalCheck.journal ||
          journalCheck.journal.operationId !== operationId ||
          journalCheck.journal.generation !== 0 ||
          journalCheck.journal.expectedOriginalPortableDigest !== originalPortableDigest ||
          journalCheck.journal.expectedDestinationPortableDigest !== destinationPortableDigest
        ) {
          throw new RestoreError(
            'RESTORE_ERR_PROMOTION_FAILED',
            'Failed to safely persist restore journal before promotion.'
          );
        }

        // Clean stale WAL and SHM files
        await FileSystem.deleteAsync(`${activeDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${activeDbUri}-shm`, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-shm`, { idempotent: true });

        // Boundary 1: Move active DB to recoveryOldPath
        promotionStarted = true;
        const activeInfo = await FileSystem.getInfoAsync(activeDbUri);
        if (activeInfo.exists) {
          await FileSystem.moveAsync({
            from: activeDbUri,
            to: backupOldDbUri,
          });
        }
        currentJournal = await transitionRestoreJournal(currentJournal, 'active_moved_to_old');

        // Boundary 2: Move staging DB to active DB path
        await FileSystem.moveAsync({
          from: stagingDbUri,
          to: activeDbUri,
        });
        currentJournal = await transitionRestoreJournal(currentJournal, 'staging_moved_to_active');
      }
    }

    // 8. Reopen active connection and run comprehensive post-activation verification
    const newLiveDb = await getDatabase();
    await verifyActivatedDatabase(newLiveDb, context.manifest);
    if ((await computeDatabasePortableDigest(newLiveDb)) !== destinationPortableDigest) {
      throw new RestoreError(
        'RESTORE_ERR_CHECKSUM_MISMATCH',
        'Promoted database portable-data identity does not match the verified backup.'
      );
    }
    await newLiveDb.getFirstAsync('SELECT 1;');

    // Boundary 3: Activation verified!
    if (currentJournal) {
      currentJournal = await transitionRestoreJournal(currentJournal, 'activation_verified');
      currentJournal = await transitionRestoreJournal(currentJournal, 'complete', {
        completionIdentity: 'destination',
      });
    }

    // 8. Activation confirmed: safely prune old recovery database only after confirmed verification
    if (backupOldDbUri && FileSystem.documentDirectory) {
      await FileSystem.deleteAsync(backupOldDbUri, { idempotent: true });
      backupOldDbUri = null;
    }

    await clearRestoreJournal();
    currentJournal = null;
  } catch (err: unknown) {
    if (stagingDb) {
      try {
        await stagingDb.closeAsync();
      } catch {
        // Ignore
      }
    }

    const activationError = err instanceof Error ? err : new Error(String(err));

    // If failure happened before filesystem promotion, no recovery state is unresolved.
    if (!currentJournal || !promotionStarted) {
      await clearRestoreJournal();
      if (err instanceof RestoreError) throw err;
      throw new RestoreError(
        'RESTORE_ERR_PROMOTION_FAILED',
        `Database staging or safety snapshot failed: ${activationError.message}`
      );
    }

    // Recover through the same identity-checked, journaled recovery state machine.
    let rollbackVerified = false;
    let manualRecoveryAvailable = false;

    if (activeDbUri && FileSystem.documentDirectory) {
      try {
        await closeDatabase();
        const recoveryState = await readRestoreJournalWithStatus();
        const destinationWasVerified = Boolean(
          recoveryState.journal &&
          (recoveryState.journal.phase === 'activation_verified' ||
            (recoveryState.journal.phase === 'complete' &&
              recoveryState.journal.completionIdentity === 'destination'))
        );
        await recoverFromInterruptedRestore();
        if (destinationWasVerified) return;
        rollbackVerified = true;
      } catch {
        rollbackVerified = false;
      }
    }

    if (rollbackVerified) {
      throw new RestoreError(
        'RESTORE_ERR_ROLLBACK_SUCCEEDED',
        `Database activation failed: ${activationError.message}. Original database was preserved, restored, and verified.`,
        'activation_failed_rollback_succeeded'
      );
    }

    // Rollback could not verify. Check if recovery files are still available on disk
    try {
      if (backupOldDbUri) {
        const oldInfo = await FileSystem.getInfoAsync(backupOldDbUri);
        if (oldInfo.exists) manualRecoveryAvailable = true;
      }
      if (!manualRecoveryAvailable && safetySnapshotUri) {
        const snapInfo = await FileSystem.getInfoAsync(safetySnapshotUri);
        if (snapInfo.exists) manualRecoveryAvailable = true;
      }
    } catch {
      // Non-fatal check
    }

    // Do not delete referenced staging data in finally after manual-recovery or rollback-failed outcomes
    preserveStaging = true;

    if (manualRecoveryAvailable) {
      // Preserve all recovery files and journal
      throw new RestoreError(
        'RESTORE_ERR_MANUAL_RECOVERY_AVAILABLE',
        `Database activation failed: ${activationError.message}. Automatic rollback could not be completed, but your recovery database has been safely preserved for manual recovery.`,
        'activation_failed_manual_recovery_available'
      );
    }

    throw new RestoreError(
      'RESTORE_ERR_ROLLBACK_FAILED',
      `Database activation failed: ${activationError.message}, and automatic rollback failed. Manual recovery required.`,
      'activation_failed_rollback_failed'
    );
  } finally {
    if (!preserveStaging) {
      if (stagingDbUri && FileSystem.documentDirectory) {
        await FileSystem.deleteAsync(stagingDbUri, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-shm`, { idempotent: true });
      }
      await cleanStaleStagingArtifacts();
    }
    setOperationInProgress(false);
  }
}
