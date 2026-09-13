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
import { CANONICAL_MIGRATION_CHECKSUMS } from '../../db/migrations/006_backup_integrity_hardening';
import {
  RestoreError,
  RestorePreview,
  BackupHeader,
  BackupManifest,
  BackupPayloadData,
  RestoreJournal,
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
} from './crypto';
import {
  decompressPayload,
  validateManifestStructure,
  validateHeaderManifestConsistency,
  computeTableChecksums,
} from './serializer';
import {
  validateAccountRow,
  validateCategoryRow,
  validateTransactionRow,
  validateCounterpartyRow,
  validateDebtRow,
  validateDebtTransactionRow,
  validateSchemaMigrationRow,
  validatePayloadInvariants,
} from './validation';
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

export const RESTORE_JOURNAL_FILENAME = 'restore_journal.json';

export function getRestoreJournalUri(): string | null {
  if (!FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}SQLite/${RESTORE_JOURNAL_FILENAME}`;
}

export async function writeRestoreJournal(journal: RestoreJournal): Promise<void> {
  const uri = getRestoreJournalUri();
  if (!uri) return;
  const content = JSON.stringify(journal, null, 2);
  await FileSystem.writeAsStringAsync(uri, content);
}

export async function readRestoreJournal(): Promise<RestoreJournal | null> {
  const uri = getRestoreJournalUri();
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(uri);
    return JSON.parse(content) as RestoreJournal;
  } catch {
    return null;
  }
}

export async function clearRestoreJournal(): Promise<void> {
  const uri = getRestoreJournalUri();
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Non-fatal
  }
}

/**
 * Removes disposable staging artifacts.
 * Rules:
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

    const journal = await readRestoreJournal();
    const protectedPaths = new Set<string>();
    if (journal) {
      if (journal.stagingPath) protectedPaths.add(journal.stagingPath);
      if (journal.recoveryOldPath) protectedPaths.add(journal.recoveryOldPath);
      if (journal.safetySnapshotPath) protectedPaths.add(journal.safetySnapshotPath);
    }

    const files = await FileSystem.readDirectoryAsync(sqliteDir);
    for (const f of files) {
      const fullPath = `${sqliteDir}${f}`;

      // NEVER delete barakah.db.old_* files in stale artifact cleanup!
      // Old recovery databases must be preserved unless confirmed activation or rollback has occurred.
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

/**
 * Verifies that a database file exists and passes SQLite PRAGMA integrity_check and foreign_key_check.
 */
async function verifyCandidateDatabase(dbPath: string): Promise<boolean> {
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
      dbName = `temp_verify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`;
      tempUri = `${sqliteDir}${dbName}`;
      await FileSystem.copyAsync({ from: dbPath, to: tempUri });
    }

    const testDb = await SQLite.openDatabaseAsync(dbName);
    try {
      const integrity = await testDb.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
      const fkViolations = await testDb.getAllAsync('PRAGMA foreign_key_check;');
      await testDb.closeAsync();
      if (tempUri) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
        await FileSystem.deleteAsync(`${tempUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${tempUri}-shm`, { idempotent: true });
      }
      return integrity?.integrity_check === 'ok' && fkViolations.length === 0;
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
  const journal = await readRestoreJournal();
  if (!journal) return;

  const activeDbUri = journal.activePath || getActiveDatabaseUri();
  const recoveryOldUri = journal.recoveryOldPath;
  const safetySnapshotUri = journal.safetySnapshotPath;

  if (!activeDbUri) {
    return;
  }

  // Phase 'complete': Nothing to recover, safely clear journal
  if (journal.phase === 'complete') {
    await clearRestoreJournal();
    return;
  }

  const restoreFromPath = async (sourcePath: string): Promise<boolean> => {
    try {
      await FileSystem.deleteAsync(activeDbUri, { idempotent: true });
      await FileSystem.deleteAsync(`${activeDbUri}-wal`, { idempotent: true });
      await FileSystem.deleteAsync(`${activeDbUri}-shm`, { idempotent: true });

      const sourceInfo = await FileSystem.getInfoAsync(sourcePath);
      if (!sourceInfo.exists) return false;

      await FileSystem.copyAsync({ from: sourcePath, to: activeDbUri });
      return await verifyCandidateDatabase(activeDbUri);
    } catch {
      return false;
    }
  };

  // Phase 'activation_verified': Staging was promoted and verified before interruption.
  if (journal.phase === 'activation_verified') {
    const activeValid = await verifyCandidateDatabase(activeDbUri);
    if (activeValid) {
      if (recoveryOldUri) {
        await FileSystem.deleteAsync(recoveryOldUri, { idempotent: true });
      }
      if (journal.stagingPath) {
        await FileSystem.deleteAsync(journal.stagingPath, { idempotent: true });
      }
      await clearRestoreJournal();
      return;
    }
  }

  // For incomplete promotion phases ('initialized', 'active_moved_to_old', 'staging_moved_to_active'):
  // Prefer the verified original database!
  let recovered = false;

  // Candidate 1: recoveryOldUri (the intact active database moved during restore)
  if (recoveryOldUri) {
    const oldValid = await verifyCandidateDatabase(recoveryOldUri);
    if (oldValid) {
      recovered = await restoreFromPath(recoveryOldUri);
      if (recovered) {
        await clearRestoreJournal();
        return;
      }
    }
  }

  // Candidate 2: safetySnapshotUri (pre-restore safety snapshot)
  if (!recovered && safetySnapshotUri) {
    const snapValid = await verifyCandidateDatabase(safetySnapshotUri);
    if (snapValid) {
      recovered = await restoreFromPath(safetySnapshotUri);
      if (recovered) {
        await clearRestoreJournal();
        return;
      }
    }
  }

  // Candidate 3: If phase was 'initialized', active database was never moved
  if (!recovered && journal.phase === 'initialized') {
    const activeValid = await verifyCandidateDatabase(activeDbUri);
    if (activeValid) {
      await clearRestoreJournal();
      return;
    }
  }

  // If neither candidate verifies, preserve all files and journal
  throw new RestoreError(
    'RESTORE_ERR_RECOVERY_REQUIRED',
    `An interrupted restore operation was detected (Operation ID: ${journal.operationId}, Phase: ${journal.phase}), but automatic recovery could not verify a valid database. All recovery files have been safely preserved.`
  );
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

  // 8. Strict row validation without silent trimming
  const accounts = manifest.payload.accounts.map((row, idx) => validateAccountRow(row, idx));
  const categories = manifest.payload.categories.map((row, idx) => validateCategoryRow(row, idx));
  const transactions = manifest.payload.transactions.map((row, idx) => validateTransactionRow(row, idx));
  const counterparties = manifest.payload.counterparties.map((row, idx) => validateCounterpartyRow(row, idx));
  const debts = manifest.payload.debts.map((row, idx) => validateDebtRow(row, idx));
  const debt_transactions = manifest.payload.debt_transactions.map((row, idx) => validateDebtTransactionRow(row, idx));
  const schema_migrations = manifest.payload.schema_migrations.map((row, idx) => validateSchemaMigrationRow(row, idx));

  const validatedPayload: BackupPayloadData = {
    accounts,
    categories,
    transactions,
    counterparties,
    debts,
    debt_transactions,
    schema_migrations,
  };

  // 9. Cross-table invariants & relations validation
  validatePayloadInvariants(validatedPayload);

  // 10. Table checksum verification
  const computedChecksums = computeTableChecksums(validatedPayload);
  for (const table of Object.keys(computedChecksums) as (keyof typeof computedChecksums)[]) {
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
  };

  try {
    const aCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM accounts;');
    const cCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM categories;');
    const tCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM transactions;');
    const cpCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM counterparties;');
    const dCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debts;');
    const dtCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debt_transactions;');

    liveRowCounts = {
      accounts: aCount?.c ?? 0,
      categories: cCount?.c ?? 0,
      transactions: tCount?.c ?? 0,
      counterparties: cpCount?.c ?? 0,
      debts: dCount?.c ?? 0,
      debt_transactions: dtCount?.c ?? 0,
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
    },
    liveRowCounts,
  };

  return {
    header,
    manifest: { ...manifest, payload: validatedPayload },
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
        'INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);',
        a.id,
        a.name,
        a.type,
        a.initial_balance,
        a.currency,
        a.created_at,
        a.updated_at
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
        'INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
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

  if (
    aCount?.c !== manifest.rowCounts.accounts ||
    cCount?.c !== manifest.rowCounts.categories ||
    tCount?.c !== manifest.rowCounts.transactions ||
    cpCount?.c !== manifest.rowCounts.counterparties ||
    dCount?.c !== manifest.rowCounts.debts ||
    dtCount?.c !== manifest.rowCounts.debt_transactions
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
  const destMigrations = await newLiveDb.getAllAsync<any>('SELECT * FROM schema_migrations ORDER BY version ASC;');

  const livePayload: BackupPayloadData = {
    accounts,
    categories,
    transactions,
    counterparties,
    debts,
    debt_transactions,
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
 * 3. Populates & verifies staging database under exclusive transaction.
 * 4. Checkpoints staging WAL and closes staging connection.
 * 5. Creates fail-closed pre-restore safety snapshot of active database.
 * 6. Closes active live database connection.
 * 7. Writes restore journal with 'initialized' phase.
 * 8. Moves active DB to recoveryOldPath and flushes 'active_moved_to_old' phase.
 * 9. Moves staging DB to active path and flushes 'staging_moved_to_active' phase.
 * 10. Reopens live connection and runs full post-activation checks.
 * 11. Flushes 'activation_verified' phase on success.
 * 12. Safely prunes recovery database only after confirmed verification and clears journal.
 * 13. Automatic rollback with verification and truthful outcome reporting on failure.
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

  const operationId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stagingDbName = `staging_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`;
  let stagingDb: DatabaseConnection | null = null;
  let safetySnapshotUri: string | null = null;
  let backupOldDbUri: string | null = null;
  let stagingDbUri: string | null = null;
  let activeDbUri: string | null = null;
  let currentJournal: RestoreJournal | null = null;

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

    // 3. Close staging database to prepare for staged replacement
    await stagingDb.closeAsync();
    stagingDb = null;

    // 4. Fail-closed: create pre-restore safety snapshot of active live database
    safetySnapshotUri = await createPreRestoreSafetySnapshot(liveDb, context.header.schemaVersion);

    // 5. Close active live database connection
    await closeDatabase();

    // 6. Safe staged promotion on filesystem
    if (FileSystem.documentDirectory) {
      const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
      activeDbUri = getActiveDatabaseUri();
      stagingDbUri = `${sqliteDir}${stagingDbName}`;
      backupOldDbUri = `${sqliteDir}barakah.db.old_${Date.now()}`;

      if (activeDbUri) {
        // Persist restore journal before first filesystem move
        currentJournal = {
          operationId,
          activePath: activeDbUri,
          stagingPath: stagingDbUri,
          recoveryOldPath: backupOldDbUri,
          safetySnapshotPath: safetySnapshotUri,
          expectedDestinationChecksum: context.manifest.tableChecksums.transactions,
          phase: 'initialized',
          updatedAtMs: Date.now(),
        };
        await writeRestoreJournal(currentJournal);

        // Clean stale WAL and SHM files
        await FileSystem.deleteAsync(`${activeDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${activeDbUri}-shm`, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${stagingDbUri}-shm`, { idempotent: true });

        // Boundary 1: Move active DB to recoveryOldPath
        const activeInfo = await FileSystem.getInfoAsync(activeDbUri);
        if (activeInfo.exists) {
          await FileSystem.moveAsync({
            from: activeDbUri,
            to: backupOldDbUri,
          });
        }
        currentJournal.phase = 'active_moved_to_old';
        currentJournal.updatedAtMs = Date.now();
        await writeRestoreJournal(currentJournal);

        // Boundary 2: Move staging DB to active DB path
        await FileSystem.moveAsync({
          from: stagingDbUri,
          to: activeDbUri,
        });
        currentJournal.phase = 'staging_moved_to_active';
        currentJournal.updatedAtMs = Date.now();
        await writeRestoreJournal(currentJournal);
      }
    }

    // 7. Reopen active connection and run comprehensive post-activation verification
    const newLiveDb = await getDatabase();
    await verifyActivatedDatabase(newLiveDb, context.manifest);

    // Boundary 3: Activation verified!
    if (currentJournal) {
      currentJournal.phase = 'activation_verified';
      currentJournal.updatedAtMs = Date.now();
      await writeRestoreJournal(currentJournal);
    }

    // 8. Activation confirmed: safely prune old recovery database and clear journal
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

    // If failure happened before moving active DB, clear journal and fail
    if (!currentJournal || currentJournal.phase === 'initialized') {
      await clearRestoreJournal();
      if (err instanceof RestoreError) throw err;
      throw new RestoreError(
        'RESTORE_ERR_PROMOTION_FAILED',
        `Database staging or safety snapshot failed: ${activationError.message}`
      );
    }

    // Rollback: try restoring from backupOldDbUri or safetySnapshotUri
    let rollbackVerified = false;
    let manualRecoveryAvailable = false;

    if (activeDbUri && FileSystem.documentDirectory) {
      try {
        await closeDatabase();
        await FileSystem.deleteAsync(activeDbUri, { idempotent: true });
        await FileSystem.deleteAsync(`${activeDbUri}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${activeDbUri}-shm`, { idempotent: true });

        if (backupOldDbUri) {
          const backupInfo = await FileSystem.getInfoAsync(backupOldDbUri);
          if (backupInfo.exists) {
            await FileSystem.moveAsync({
              from: backupOldDbUri,
              to: activeDbUri,
            });
          } else if (safetySnapshotUri) {
            await FileSystem.copyAsync({
              from: safetySnapshotUri,
              to: activeDbUri,
            });
          }
        } else if (safetySnapshotUri) {
          await FileSystem.copyAsync({
            from: safetySnapshotUri,
            to: activeDbUri,
          });
        }

        // Reopen restored original database and verify integrity
        const reopenedDb = await getDatabase();
        const integrity = await reopenedDb.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check;');
        const fkViolations = await reopenedDb.getAllAsync('PRAGMA foreign_key_check;');
        if (integrity?.integrity_check === 'ok' && fkViolations.length === 0) {
          rollbackVerified = true;
        }
      } catch {
        rollbackVerified = false;
      }
    }

    if (rollbackVerified) {
      await clearRestoreJournal();
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
    if (stagingDbUri && FileSystem.documentDirectory) {
      await FileSystem.deleteAsync(stagingDbUri, { idempotent: true });
      await FileSystem.deleteAsync(`${stagingDbUri}-wal`, { idempotent: true });
      await FileSystem.deleteAsync(`${stagingDbUri}-shm`, { idempotent: true });
    }
    await cleanStaleStagingArtifacts();
    setOperationInProgress(false);
  }
}
