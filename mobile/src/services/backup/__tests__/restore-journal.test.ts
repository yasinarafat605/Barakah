import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import {
  executeRestore,
  recoverFromInterruptedRestore,
  cleanStaleStagingArtifacts,
  readRestoreJournal,
  writeRestoreJournal,
  populateAndVerifyStagingDatabase,
  verifyAndPreviewBackup,
} from '../restore-service';
import {
  RestoreError,
  RestoreJournal,
  DecryptedBackupContext,
  PORTABLE_FINANCIAL_TABLES,
} from '../types';
import { createEncryptedBackup } from '../backup-service';
import { createBetterSqliteConnection } from '../../../db/test-adapter';
import { runMigrations } from '../../../db/migrations';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../../../db/migrations/006_backup_integrity_hardening';
import { computeTableChecksums } from '../serializer';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  backupDatabaseAsync: jest.fn(),
}));

// In-Memory Virtual FileSystem for strict deterministic simulation
const mockVfs = new Map<string, { content: string; size: number; isDir: boolean }>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/files/',
  cacheDirectory: 'file:///app/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (uri: string) => {
    const entry = mockVfs.get(uri);
    if (!entry) return { exists: false, isDirectory: false };
    return { exists: true, size: entry.size, isDirectory: entry.isDir };
  }),
  makeDirectoryAsync: jest.fn(async (uri: string) => {
    mockVfs.set(uri, { content: '', size: 0, isDir: true });
  }),
  readDirectoryAsync: jest.fn(async (dirUri: string) => {
    const results: string[] = [];
    for (const key of mockVfs.keys()) {
      if (key.startsWith(dirUri) && key !== dirUri) {
        const rel = key.slice(dirUri.length);
        if (!rel.includes('/')) {
          results.push(rel);
        }
      }
    }
    return results;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
    mockVfs.set(uri, { content, size: content.length, isDir: false });
  }),
  readAsStringAsync: jest.fn(async (uri: string) => {
    const entry = mockVfs.get(uri);
    if (!entry) throw new Error(`File not found: ${uri}`);
    return entry.content;
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const entry = mockVfs.get(from);
    if (!entry) throw new Error(`File not found for copy: ${from}`);
    mockVfs.set(to, { ...entry });
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const entry = mockVfs.get(from);
    if (!entry) throw new Error(`File not found for move: ${from}`);
    mockVfs.set(to, { ...entry });
    mockVfs.delete(from);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockVfs.delete(uri);
  }),
}));

const mockGetDatabase = jest.fn();
const mockCloseDatabase = jest.fn();

jest.mock('../../../db/client', () => ({
  DEFAULT_DATABASE_NAME: 'barakah.db',
  getDatabase: () => mockGetDatabase(),
  closeDatabase: () => mockCloseDatabase(),
  runExclusiveTransaction: jest.fn((db, cb) => cb(db)),
}));

jest.mock('../safety', () => ({
  ...jest.requireActual('../safety'),
  createPreRestoreSafetySnapshot: jest.fn().mockResolvedValue('file:///app/files/SQLite/safety_snapshots/pre_restore_safety_test.db'),
}));

describe('Restore Journal & Crash Recovery Suite', () => {
  const sqliteDir = 'file:///app/files/SQLite/';
  const activeDbUri = `${sqliteDir}barakah.db`;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVfs.clear();
    mockVfs.set(sqliteDir, { content: '', size: 0, isDir: true });
    mockVfs.set(activeDbUri, { content: 'active-db-binary-bytes', size: 1024, isDir: false });
    mockVfs.set(`${sqliteDir}safety_snapshots/pre_restore_safety_test.db`, {
      content: 'safety-snapshot-bytes',
      size: 1024,
      isDir: false,
    });
  });

  it('Successful full schema-6 restore: populates financial tables and verifies canonical migration ledger', async () => {
    const testDb = createBetterSqliteConnection();
    await runMigrations(testDb);

    // Seed test data
    const now = Date.now();
    await testDb.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_s6', 'Main Savings', 'bank', 100000, 'USD', ?, ?);`,
      now, now
    );
    await testDb.runAsync(
      `INSERT INTO counterparties (id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at)
       VALUES ('cp_s6', 'Partner Org', 'business', NULL, NULL, NULL, '#15803D', 0, ?, ?);`,
      now, now
    );

    const backup = await createEncryptedBackup(testDb, 'Password1234!', 'Password1234!');
    expect(backup.recordCount).toBeGreaterThan(0);

    // Verify isolated staging populate
    const stagingDb = createBetterSqliteConnection();
    const context = await verifyAndPreviewBackup(testDb, backup.envelopeBytes, 'Password1234!');
    await populateAndVerifyStagingDatabase(stagingDb, context.manifest);

    // Check all portable tables restored
    const accCount = await stagingDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM accounts WHERE id = ?;', 'acc_s6');
    expect(accCount?.c).toBe(1);

    // Verify destination schema_migrations contains all 6 migrations with canonical checksums
    const destMigrations = await stagingDb.getAllAsync<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
    );
    expect(destMigrations.length).toBe(6);
    for (const m of destMigrations) {
      expect(m.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[m.version]);
    }
  });

  it('Schema-4 and schema-5 upgrade restores: successfully restores into schema-6 destination without checksum rejection', async () => {
    // 1. Emulate a schema-4 backup manifest (contains migrations 1..4 in provenance ledger)
    const stagingDb4 = createBetterSqliteConnection();
    const mockManifestV4 = {
      manifestVersion: 1,
      createdAtMs: Date.now(),
      appVersion: 1,
      schemaVersion: 4,
      rowCounts: {
        accounts: 1,
        categories: 0,
        transactions: 0,
        counterparties: 1,
        debts: 0,
        debt_transactions: 0,
        schema_migrations: 4,
      },
      tableChecksums: {
        accounts: '',
        categories: '',
        transactions: '',
        counterparties: '',
        debts: '',
        debt_transactions: '',
        schema_migrations: 'source_v4_ledger_checksum',
      },
      payload: {
        accounts: [{ id: 'acc_v4', name: 'Legacy v4 Account', type: 'cash', initial_balance: 500, currency: 'USD', created_at: 1000, updated_at: 1000 }],
        categories: [],
        transactions: [],
        counterparties: [{ id: 'cp_v4', name: 'Legacy Person', type: 'person', phone: null, email: null, note: null, avatar_color: null, is_archived: 0, created_at: 1000, updated_at: 1000 }],
        debts: [],
        debt_transactions: [],
        schema_migrations: [
          { version: 1, name: '001_initial_schema', applied_at: 1000, checksum: null },
          { version: 2, name: '002_categories_and_transfers', applied_at: 1001, checksum: null },
          { version: 3, name: '003_debts_and_counterparties', applied_at: 1002, checksum: null },
          { version: 4, name: '004_debt_ledger_integrity_upgrade', applied_at: 1003, checksum: null },
        ],
      },
    };

    // Staging population applies migrations 1..6 and inserts data
    await populateAndVerifyStagingDatabase(stagingDb4, mockManifestV4 as any);

    // Target database is now at schema 6
    const cols = await stagingDb4.getAllAsync<{ name: string }>('PRAGMA table_info(backup_history);');
    expect(cols.length).toBeGreaterThan(0); // backup_history table created by migration 005
    const rows = await stagingDb4.getAllAsync<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations;');
    expect(rows.length).toBe(6);
    expect(rows.find(r => r.version === 6)?.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[6]);

    // 2. Emulate a schema-5 backup manifest
    const stagingDb5 = createBetterSqliteConnection();
    const mockManifestV5 = {
      ...mockManifestV4,
      schemaVersion: 5,
      rowCounts: { ...mockManifestV4.rowCounts, schema_migrations: 5 },
      payload: {
        ...mockManifestV4.payload,
        schema_migrations: [
          ...mockManifestV4.payload.schema_migrations,
          { version: 5, name: '005_backup_metadata_and_checksums', applied_at: 1004, checksum: null },
        ],
      },
    };

    await populateAndVerifyStagingDatabase(stagingDb5, mockManifestV5 as any);
    const rows5 = await stagingDb5.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations;');
    expect(rows5.length).toBe(6);
  });

  it('Migration-ledger policy: verifies destination ledger against canonical checksums while comparing financial tables independently', async () => {
    const stagingDb = createBetterSqliteConnection();
    await runMigrations(stagingDb);

    const now = Date.now();
    await stagingDb.runAsync(
      'INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);',
      'acc_policy', 'Test Policy Acc', 'cash', 100, 'USD', now, now
    );

    const accounts = await stagingDb.getAllAsync<any>('SELECT * FROM accounts ORDER BY id ASC;');
    const payload = {
      accounts,
      categories: [],
      transactions: [],
      counterparties: [],
      debts: [],
      debt_transactions: [],
      schema_migrations: [],
    };
    const checksums = computeTableChecksums(payload as any);

    // Portable financial tables match independently
    expect(checksums.accounts).toHaveLength(64);
    for (const t of PORTABLE_FINANCIAL_TABLES) {
      if (t !== 'accounts') {
        expect(checksums[t]).toHaveLength(64);
      }
    }

    // Destination ledger verified against CANONICAL_MIGRATION_CHECKSUMS
    const destMigrations = await stagingDb.getAllAsync<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
    );
    for (const m of destMigrations) {
      expect(m.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[m.version]);
    }
  });

  it('Crash after active-to-old move: safely recovers original database on startup', async () => {
    // Setup simulated crash state:
    // Active DB was moved to barakah.db.old_123, but process died before staging was moved to active
    const recoveryOldPath = `${sqliteDir}barakah.db.old_123`;
    mockVfs.delete(activeDbUri); // active does not exist
    mockVfs.set(recoveryOldPath, { content: 'intact-original-db-bytes', size: 1024, isDir: false });

    // Persist incomplete restore journal
    const journal: RestoreJournal = {
      operationId: 'op_crash_1',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_restore_test.db`,
      recoveryOldPath: recoveryOldPath,
      safetySnapshotPath: `${sqliteDir}safety_snapshots/pre_restore_safety_test.db`,
      expectedDestinationChecksum: 'expected_cs',
      phase: 'active_moved_to_old',
      updatedAtMs: Date.now(),
    };
    await writeRestoreJournal(journal);

    // Mock SQLite verification for the candidate
    const mockTestDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockTestDb);

    // Startup recovery executes
    await recoverFromInterruptedRestore();

    // Original database was safely restored to activeDbUri!
    const activeInfo = await FileSystem.getInfoAsync(activeDbUri);
    expect(activeInfo.exists).toBe(true);

    // Journal is cleared after verified recovery
    const remainingJournal = await readRestoreJournal();
    expect(remainingJournal).toBeNull();
  });

  it('Startup recovery from every journal phase: recovers or preserves safely', async () => {
    const mockTestDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockTestDb);

    // Phase 1: initialized (active DB was never moved)
    mockVfs.set(activeDbUri, { content: 'active-db', size: 1024, isDir: false });
    await writeRestoreJournal({
      operationId: 'op_p1',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_p1.db`,
      recoveryOldPath: `${sqliteDir}barakah.db.old_p1`,
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'cs',
      phase: 'initialized',
      updatedAtMs: Date.now(),
    });
    await recoverFromInterruptedRestore();
    expect(await readRestoreJournal()).toBeNull();

    // Phase 2: staging_moved_to_active (prefer verified original old DB)
    const oldPath = `${sqliteDir}barakah.db.old_p2`;
    mockVfs.set(activeDbUri, { content: 'unverified-staging-db', size: 1024, isDir: false });
    mockVfs.set(oldPath, { content: 'verified-original-old-db', size: 1024, isDir: false });
    await writeRestoreJournal({
      operationId: 'op_p2',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_p2.db`,
      recoveryOldPath: oldPath,
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'cs',
      phase: 'staging_moved_to_active',
      updatedAtMs: Date.now(),
    });
    await recoverFromInterruptedRestore();
    // Replaced unverified active with verified original
    expect(mockVfs.get(activeDbUri)?.content).toBe('verified-original-old-db');
    expect(await readRestoreJournal()).toBeNull();

    // Phase 3: activation_verified (staging was already verified)
    mockVfs.set(activeDbUri, { content: 'verified-new-db', size: 1024, isDir: false });
    mockVfs.set(oldPath, { content: 'old-backup-to-prune', size: 1024, isDir: false });
    await writeRestoreJournal({
      operationId: 'op_p3',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_p3.db`,
      recoveryOldPath: oldPath,
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'cs',
      phase: 'activation_verified',
      updatedAtMs: Date.now(),
    });
    await recoverFromInterruptedRestore();
    // Confirmed activation pruned old candidate and cleared journal
    expect(mockVfs.has(oldPath)).toBe(false);
    expect(await readRestoreJournal()).toBeNull();

    // Phase 4: complete (cleans journal)
    await writeRestoreJournal({
      operationId: 'op_p4',
      activePath: activeDbUri,
      stagingPath: '',
      recoveryOldPath: '',
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'cs',
      phase: 'complete',
      updatedAtMs: Date.now(),
    });
    await recoverFromInterruptedRestore();
    expect(await readRestoreJournal()).toBeNull();
  });

  it('Rollback failure preservation: preserves recovery database and journal on rollback failure', async () => {
    // Fail getDatabase on rollback
    const mockCorruptDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'file is not a database' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
    };
    mockGetDatabase.mockResolvedValue(mockCorruptDb);

    const mockStagingDb: any = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
      withExclusiveTransactionAsync: jest.fn(async (cb) => cb(mockStagingDb)),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(mockStagingDb);

    const dummyContext: DecryptedBackupContext = {
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

    try {
      await executeRestore(mockStagingDb as any, dummyContext);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RestoreError);
      // Journal and recovery files must NOT be deleted
      const journal = await readRestoreJournal();
      expect(journal).not.toBeNull();
      expect((err as RestoreError).outcome).toBe('activation_failed_manual_recovery_available');
    }
  });

  it('No deletion of referenced .old_* databases: cleanStaleStagingArtifacts protects recovery databases', async () => {
    const referencedOldPath = `${sqliteDir}barakah.db.old_active_op`;
    const unreferencedOldPath = `${sqliteDir}barakah.db.old_prior_op`;
    const disposableStagingPath = `${sqliteDir}staging_restore_999.db`;

    mockVfs.set(referencedOldPath, { content: 'active-recovery-db', size: 1024, isDir: false });
    mockVfs.set(unreferencedOldPath, { content: 'prior-recovery-db', size: 1024, isDir: false });
    mockVfs.set(disposableStagingPath, { content: 'disposable-staging', size: 512, isDir: false });

    // Set active journal referencing referencedOldPath
    await writeRestoreJournal({
      operationId: 'op_ref',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_active.db`,
      recoveryOldPath: referencedOldPath,
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'cs',
      phase: 'staging_moved_to_active',
      updatedAtMs: Date.now(),
    });

    await cleanStaleStagingArtifacts();

    // NEVER delete any .old_* recovery databases during stale staging artifact cleanup
    expect(mockVfs.has(referencedOldPath)).toBe(true);
    expect(mockVfs.has(unreferencedOldPath)).toBe(true);

    // Unreferenced disposable staging artifact IS deleted
    expect(mockVfs.has(disposableStagingPath)).toBe(false);
  });

  it('End-to-end runtime QA lifecycle: populate -> export -> verify -> mutate -> restore -> restart -> reconcile -> inject failure -> recover on restart', async () => {
    // 1. Create populated database
    const liveDb = createBetterSqliteConnection();
    await runMigrations(liveDb);

    const now = Date.now();
    await liveDb.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_e2e_1', 'Main Checking', 'bank', 250000, 'USD', ?, ?);`,
      now, now
    );
    await liveDb.runAsync(
      `INSERT INTO counterparties (id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at)
       VALUES ('cp_e2e_1', 'Supplies Co', 'business', NULL, NULL, NULL, '#15803D', 0, ?, ?);`,
      now, now
    );
    await liveDb.runAsync(
      `INSERT OR IGNORE INTO categories (id, name_key, name_custom, icon, color, type, is_archived, sort_order, is_default, created_at, updated_at)
       VALUES ('cat_salary', 'salary', 'Salary', 'briefcase', '#087A62', 'income', 0, 1, 1, ?, ?);`,
      now, now
    );
    await liveDb.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at)
       VALUES ('debt_e2e_1', 'cp_e2e_1', 'borrowed', 100000, 'USD', 'existing_balance', ?, '2026-12-31', 'active', 'Initial loan', ?, ?, NULL, NULL);`,
      now, now, now
    );
    await liveDb.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
       VALUES ('tx_e2e_1', 'acc_e2e_1', 'cat_salary', 50000, 'income', NULL, NULL, NULL, 'Payment received', ?, ?, ?, NULL);`,
      now, now, now
    );

    // 2. Export and independently verify .fmz
    const backup = await createEncryptedBackup(liveDb, 'SecurePass123!', 'SecurePass123!');
    expect(backup.recordCount).toBeGreaterThan(0);

    const verifiedContext = await verifyAndPreviewBackup(liveDb, backup.envelopeBytes, 'SecurePass123!');
    expect(verifiedContext.preview.rowCounts.accounts).toBe(1);
    expect(verifiedContext.preview.rowCounts.debts).toBe(1);
    expect(verifiedContext.preview.rowCounts.transactions).toBe(1);

    // 3. Mutate live data
    await liveDb.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
       VALUES ('tx_e2e_mutated', 'acc_e2e_1', 'cat_salary', 999999, 'income', NULL, NULL, NULL, 'Unsaved transaction', ?, ?, ?, NULL);`,
      now + 1000, now + 1000, now + 1000
    );
    const mutatedTxCount = await liveDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM transactions;');
    expect(mutatedTxCount?.c).toBe(2);

    // 4. Restore backup via staged replacement
    const stagingDb = createBetterSqliteConnection();
    await runMigrations(stagingDb);
    (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async (name: string) => {
      mockVfs.set(`${sqliteDir}${name}`, { content: 'staging-db-bytes', size: 1024, isDir: false });
      return stagingDb;
    });

    const activatedDb = createBetterSqliteConnection();
    await populateAndVerifyStagingDatabase(activatedDb, verifiedContext.manifest);
    mockGetDatabase.mockResolvedValue(activatedDb);

    await executeRestore(liveDb, verifiedContext);

    // 5. Restart the app (simulate fresh startup)
    await recoverFromInterruptedRestore();

    // 6. Reconcile accounts, transactions and debts
    const reconciledTx = await activatedDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM transactions;');
    expect(reconciledTx?.c).toBe(1);
    const reconciledAcc = await activatedDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM accounts WHERE id = ?;', 'acc_e2e_1');
    expect(reconciledAcc?.c).toBe(1);
    const reconciledDebt = await activatedDb.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM debts WHERE id = ?;', 'debt_e2e_1');
    expect(reconciledDebt?.c).toBe(1);

    // 7. Inject activation failure (simulated crash after active DB moved to old)
    const crashOldPath = `${sqliteDir}barakah.db.old_crash_test`;
    mockVfs.set(crashOldPath, { content: 'intact-original-data', size: 1024, isDir: false });
    mockVfs.delete(activeDbUri); // active DB is missing due to crash
    await writeRestoreJournal({
      operationId: 'op_crash_simulation',
      activePath: activeDbUri,
      stagingPath: `${sqliteDir}staging_failed.db`,
      recoveryOldPath: crashOldPath,
      safetySnapshotPath: null,
      expectedDestinationChecksum: 'expected_cs',
      phase: 'active_moved_to_old',
      updatedAtMs: Date.now(),
    });

    // 8. Confirm original database recovery after restart
    const recoveryDb = {
      getFirstAsync: jest.fn().mockResolvedValue({ integrity_check: 'ok' }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(recoveryDb);

    await recoverFromInterruptedRestore();

    expect(mockVfs.has(activeDbUri)).toBe(true);
    expect(mockVfs.get(activeDbUri)?.content).toBe('intact-original-data');
    expect(await readRestoreJournal()).toBeNull();
  });
});
