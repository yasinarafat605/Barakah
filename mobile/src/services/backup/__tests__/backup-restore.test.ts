import { createBetterSqliteConnection } from '../../../db/test-adapter';
import { runMigrations } from '../../../db/migrations';
import { createEncryptedBackup } from '../backup-service';
import {
  inspectBackupHeader,
  verifyAndPreviewBackup,
  populateAndVerifyStagingDatabase,
} from '../restore-service';
import {
  RestoreError,
  CURRENT_DATABASE_SCHEMA_VERSION,
} from '../types';
import {
  encryptPayloadWithHeader,
  parseHeader,
  serializeHeader,
  deriveKeyFromPassphrase,
} from '../crypto';
import { canonicalJsonStringify, compressJsonPayload } from '../serializer';

describe('Backup and Restore Integration Suite', () => {
  const testPassphrase = 'ValidSecretPassphrase123!';
  const fastKdfParams = { N: 16384, r: 8, p: 1 };

  it('performs complete end-to-end backup, preview, and staging verification with Bengali text', async () => {
    const db = createBetterSqliteConnection();
    await runMigrations(db);

    // 1. Seed realistic financial data with accounts, transfers, counterparties, debts
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_bdt_cash', 'নগদ টাকা (Cash)', 'cash', 500000, 'BDT', ?, ?);`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_bdt_bank', 'ইসলামী ব্যাংক (Bank)', 'bank', 2000000, 'BDT', ?, ?);`,
      now,
      now
    );

    // Categories
    await db.runAsync(
      `INSERT INTO categories (id, name_key, name_custom, icon, color, type, is_archived, sort_order, is_default, created_at, updated_at)
       VALUES ('cat_salary', 'salary', 'মাসিক বেতন', 'briefcase', '#087A62', 'income', 0, 1, 1, ?, ?);`,
      now,
      now
    );

    // Normal transaction
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
       VALUES ('tx_inc_1', 'acc_bdt_bank', 'cat_salary', 7500000, 'income', NULL, NULL, NULL, 'ফেব্রুয়ারি মাসের বেতন', ?, ?, ?, NULL);`,
      now,
      now,
      now
    );

    // Paired transfer transaction
    const transferId = 'trf_001';
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
       VALUES ('tx_trf_src', 'acc_bdt_bank', NULL, 100000, 'transfer', ?, 'source', 'acc_bdt_cash', 'ব্যাংক থেকে উত্তোলন', ?, ?, ?, NULL);`,
      transferId,
      now,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
       VALUES ('tx_trf_dst', 'acc_bdt_cash', NULL, 100000, 'transfer', ?, 'destination', 'acc_bdt_bank', 'ব্যাংক থেকে উত্তোলন', ?, ?, ?, NULL);`,
      transferId,
      now,
      now,
      now
    );

    // Counterparty & Debt
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at)
       VALUES ('cp_rahim', 'আব্দুর রহিম', 'person', '01711000000', 'rahim@example.com', 'বিশ্বস্ত বন্ধু', '#15803D', 0, ?, ?);`,
      now,
      now
    );

    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at)
       VALUES ('debt_001', 'cp_rahim', 'lent', 500000, 'BDT', 'existing_balance', ?, '2026-12-31', 'active', 'ব্যবসায় সাহায্য', ?, ?, NULL, NULL);`,
      now,
      now,
      now
    );

    // Debt repayment
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at)
       VALUES ('dt_001', 'debt_001', 'tx_inc_1', 200000, 'repayment', 'আংশিক পরিশোধ', ?, ?, ?, NULL);`,
      now,
      now,
      now
    );

    // 2. Execute Backup
    const backupResult = await createEncryptedBackup(
      db,
      testPassphrase,
      testPassphrase,
      fastKdfParams
    );

    expect(backupResult.fileSizeBytes).toBeGreaterThan(100);
    expect(backupResult.recordCount).toBe(31); // 2 acc + 23 cat (22 seeded + 1 custom) + 3 tx (1 inc + 2 trf) + 1 cp + 1 debt + 1 dt = 31 records
    expect(backupResult.sha256Checksum).toHaveLength(64);

    // 3. Test inspectBackupHeader
    const inspectedHeader = await inspectBackupHeader(backupResult.envelopeBytes);
    expect(inspectedHeader.magic).toBe('BKBK');
    expect(inspectedHeader.formatVersion).toBe(1);
    expect(inspectedHeader.schemaVersion).toBe(CURRENT_DATABASE_SCHEMA_VERSION);

    // 4. Test wrong passphrase rejection
    await expect(
      verifyAndPreviewBackup(db, backupResult.envelopeBytes, 'WrongPassphrase123!')
    ).rejects.toThrow(RestoreError);

    // 5. Test verified preview with correct passphrase
    const previewCtx = await verifyAndPreviewBackup(
      db,
      backupResult.envelopeBytes,
      testPassphrase
    );

    expect(previewCtx.preview.rowCounts.accounts).toBe(2);
    expect(previewCtx.preview.rowCounts.transactions).toBe(3);
    expect(previewCtx.preview.rowCounts.counterparties).toBe(1);
    expect(previewCtx.preview.rowCounts.debts).toBe(1);
    expect(previewCtx.preview.rowCounts.debt_transactions).toBe(1);

    // 6. Test isolated staging database import and integrity verification
    const stagingDb = createBetterSqliteConnection();
    await populateAndVerifyStagingDatabase(stagingDb, previewCtx.manifest);

    // Verify records inside staging database
    const stagedAccounts = await stagingDb.getAllAsync<any>('SELECT * FROM accounts ORDER BY id ASC;');
    expect(stagedAccounts).toHaveLength(2);
    expect(stagedAccounts[0].name).toBe('ইসলামী ব্যাংক (Bank)');
    expect(stagedAccounts[1].name).toBe('নগদ টাকা (Cash)');

    const stagedDebts = await stagingDb.getAllAsync<any>('SELECT * FROM debts;');
    expect(stagedDebts).toHaveLength(1);
    expect(stagedDebts[0].due_date).toBe('2026-12-31');

    const stagedTransfers = await stagingDb.getAllAsync<any>("SELECT * FROM transactions WHERE type = 'transfer';");
    expect(stagedTransfers).toHaveLength(2);

    await db.closeAsync();
    await stagingDb.closeAsync();
  });

  it('rejects backup with invalid civil dates in debt records', async () => {
    const db = createBetterSqliteConnection();
    await runMigrations(db);

    const now = Date.now();
    const manifest = {
      manifestVersion: 1,
      createdAtMs: now,
      appVersion: 10000,
      schemaVersion: 5,
      rowCounts: {
        accounts: 1,
        categories: 0,
        transactions: 0,
        counterparties: 1,
        debts: 1,
        debt_transactions: 0,
        schema_migrations: 5,
      },
      tableChecksums: {
        accounts: 'fake',
        categories: 'fake',
        transactions: 'fake',
        counterparties: 'fake',
        debts: 'fake',
        debt_transactions: 'fake',
        schema_migrations: 'fake',
      },
      payload: {
        accounts: [
          {
            id: 'acc_1',
            name: 'Cash',
            type: 'cash',
            initial_balance: 1000,
            currency: 'BDT',
            created_at: now,
            updated_at: now,
          },
        ],
        categories: [],
        transactions: [],
        counterparties: [
          {
            id: 'cp_1',
            name: 'Karim',
            type: 'person',
            phone: null,
            email: null,
            note: null,
            avatar_color: null,
            is_archived: 0,
            created_at: now,
            updated_at: now,
          },
        ],
        debts: [
          {
            id: 'debt_invalid_date',
            counterparty_id: 'cp_1',
            direction: 'borrowed',
            original_principal: 5000,
            currency: 'BDT',
            opening_mode: 'existing_balance',
            opened_at: now,
            due_date: '2026-02-31', // Impossible date!
            status: 'active',
            note: null,
            created_at: now,
            updated_at: now,
            archived_at: null,
            deleted_at: null,
          },
        ],
        debt_transactions: [],
        schema_migrations: [],
      },
    };

    // Encrypt this crafted payload
    const json = canonicalJsonStringify(manifest);
    const compressed = compressJsonPayload(json);
    const salt = new Uint8Array(16);
    const nonce = new Uint8Array(12);
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);

    const rawHeader = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: fastKdfParams.N,
      kdfR: fastKdfParams.r,
      kdfP: fastKdfParams.p,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: 5,
      appVersion: 10000,
      flags: 1,
      createdAtMs: now,
    });
    const header = parseHeader(rawHeader);

    const envelope = encryptPayloadWithHeader(compressed, key, header);

    await expect(verifyAndPreviewBackup(db, envelope, testPassphrase)).rejects.toThrow(RestoreError);
    await expect(verifyAndPreviewBackup(db, envelope, testPassphrase)).rejects.toThrow(/invalid due_date/i);

    await db.closeAsync();
  });

  it('rejects backup with negative debt balance ledger violation', async () => {
    const db = createBetterSqliteConnection();
    await runMigrations(db);

    const now = Date.now();
    const manifest = {
      manifestVersion: 1,
      createdAtMs: now,
      appVersion: 10000,
      schemaVersion: 5,
      rowCounts: {
        accounts: 1,
        categories: 0,
        transactions: 0,
        counterparties: 1,
        debts: 1,
        debt_transactions: 1,
        schema_migrations: 5,
      },
      tableChecksums: {
        accounts: 'fake',
        categories: 'fake',
        transactions: 'fake',
        counterparties: 'fake',
        debts: 'fake',
        debt_transactions: 'fake',
        schema_migrations: 'fake',
      },
      payload: {
        accounts: [
          {
            id: 'acc_1',
            name: 'Cash',
            type: 'cash',
            initial_balance: 1000,
            currency: 'BDT',
            created_at: now,
            updated_at: now,
          },
        ],
        categories: [],
        transactions: [],
        counterparties: [
          {
            id: 'cp_1',
            name: 'Karim',
            type: 'person',
            phone: null,
            email: null,
            note: null,
            avatar_color: null,
            is_archived: 0,
            created_at: now,
            updated_at: now,
          },
        ],
        debts: [
          {
            id: 'debt_overpaid',
            counterparty_id: 'cp_1',
            direction: 'lent',
            original_principal: 5000,
            currency: 'BDT',
            opening_mode: 'existing_balance',
            opened_at: now,
            due_date: '2026-12-31',
            status: 'active',
            note: null,
            created_at: now,
            updated_at: now,
            archived_at: null,
            deleted_at: null,
          },
        ],
        debt_transactions: [
          {
            id: 'dt_overpay',
            debt_id: 'debt_overpaid',
            transaction_id: null,
            amount: 8000, // Reduced 8,000 against 5,000 principal -> negative outstanding!
            role: 'adjustment_decrease',
            note: null,
            occurred_at: now,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          },
        ],
        schema_migrations: [],
      },
    };

    const json = canonicalJsonStringify(manifest);
    const compressed = compressJsonPayload(json);
    const salt = new Uint8Array(16);
    const nonce = new Uint8Array(12);
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);

    const rawHeader = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: fastKdfParams.N,
      kdfR: fastKdfParams.r,
      kdfP: fastKdfParams.p,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: 5,
      appVersion: 10000,
      flags: 1,
      createdAtMs: now,
    });
    const header = parseHeader(rawHeader);

    const envelope = encryptPayloadWithHeader(compressed, key, header);

    await expect(verifyAndPreviewBackup(db, envelope, testPassphrase)).rejects.toThrow(RestoreError);
    await expect(verifyAndPreviewBackup(db, envelope, testPassphrase)).rejects.toThrow(/negative outstanding balance/i);

    await db.closeAsync();
  });
});
