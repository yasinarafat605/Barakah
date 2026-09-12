import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { DatabaseConnection } from '../types';

describe('Migration 002: Rebuild & Transfer Constraints', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
  });

  it('migrates from 001 to 002 preserving existing records, row counts, and foreign keys', async () => {
    // 1. Initialize schema_migrations and run migration 001
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    await migration001.up(db);
    await db.runAsync(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, '001_initial_schema', ?);`,
      Date.now()
    );

    // 2. Seed pre-migration data into 001 schema
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      'acc_legacy_1',
      'Legacy Bank',
      'bank',
      200000,
      'BDT',
      now,
      now
    );

    await db.runAsync(
      `INSERT INTO categories (id, name_key, icon, color, type)
       VALUES (?, ?, ?, ?, ?);`,
      'cat_legacy_1',
      'categories.old_category',
      'cash',
      '#000000',
      'income'
    );

    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      'tx_legacy_1',
      'acc_legacy_1',
      'cat_legacy_1',
      55000,
      'income',
      'Old income record',
      now,
      now
    );

    // Verify row count before migration
    const countBefore = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions;'
    );
    expect(countBefore?.count).toBe(1);

    // 3. Apply migration 002
    await migration002.up(db);
    await db.runAsync(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, '002_categories_and_transfers', ?);`,
      Date.now()
    );

    // 4. Validate row count after migration
    const countAfter = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions;'
    );
    expect(countAfter?.count).toBe(1);

    // Validate legacy record preserved without alterations
    const tx = await db.getFirstAsync<any>(
      'SELECT * FROM transactions WHERE id = ?;',
      'tx_legacy_1'
    );
    expect(tx).not.toBeNull();
    expect(tx.id).toBe('tx_legacy_1');
    expect(tx.account_id).toBe('acc_legacy_1');
    expect(tx.category_id).toBe('cat_legacy_1');
    expect(tx.amount).toBe(55000);
    expect(tx.type).toBe('income');
    expect(tx.transfer_id).toBeNull();
    expect(tx.transfer_role).toBeNull();
    expect(tx.related_account_id).toBeNull();
    expect(tx.deleted_at).toBeNull();

    // 5. Check foreign key integrity
    const fkErrors = await db.getAllAsync('PRAGMA foreign_key_check;');
    expect(fkErrors).toHaveLength(0);
  });

  describe('Database-Level Integrity Constraints (Migration 002)', () => {
    beforeEach(async () => {
      await runMigrations(db);

      // Create two test accounts
      const now = Date.now();
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?);`,
        'acc_source', 'Source Acc', 'bank', 100000, 'BDT', now, now,
        'acc_dest', 'Dest Acc', 'cash', 50000, 'BDT', now, now
      );
    });

    it('enforces amount > 0 for all transactions', async () => {
      const now = Date.now();
      // Zero amount must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          'tx_zero', 'acc_source', 'cat_inc_salary_wages', 0, 'income', now, now
        )
      ).rejects.toThrow(/CHECK/i);

      // Negative amount must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          'tx_neg', 'acc_source', 'cat_inc_salary_wages', -500, 'income', now, now
        )
      ).rejects.toThrow(/CHECK/i);
    });

    it('enforces category_id IS NOT NULL for income and expense', async () => {
      const now = Date.now();
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          'tx_no_cat', 'acc_source', null, 1000, 'income', now, now
        )
      ).rejects.toThrow(/CHECK/i);
    });

    it('enforces category_id IS NULL and transfer fields for transfer type', async () => {
      const now = Date.now();

      // Transfer with a category_id must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_tr_cat', 'acc_source', 'cat_inc_salary_wages', 1000, 'transfer', 'tr_1', 'source', 'acc_dest', now, now
        )
      ).rejects.toThrow(/CHECK/i);

      // Transfer without transfer_id must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_tr_no_id', 'acc_source', null, 1000, 'transfer', null, 'source', 'acc_dest', now, now
        )
      ).rejects.toThrow(/CHECK/i);

      // Transfer with invalid transfer_role must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_tr_bad_role', 'acc_source', null, 1000, 'transfer', 'tr_1', 'invalid_role', 'acc_dest', now, now
        )
      ).rejects.toThrow(/CHECK/i);

      // Transfer with same account as related_account_id must be rejected by check constraint
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_tr_same_acc', 'acc_source', null, 1000, 'transfer', 'tr_1', 'source', 'acc_source', now, now
        )
      ).rejects.toThrow(/CHECK/i);
    });

    it('rejects transfer fields on normal income and expense', async () => {
      const now = Date.now();
      // Income with transfer_id must be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_inc_tr', 'acc_source', 'cat_inc_salary_wages', 1000, 'income', 'tr_some_id', now, now
        )
      ).rejects.toThrow(/CHECK/i);
    });

    it('enforces partial unique index on (transfer_id, transfer_role) to prevent duplicate roles', async () => {
      const now = Date.now();

      // Insert first source leg
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_s1', 'acc_source', null, 5000, 'transfer', 'tr_unique_test', 'source', 'acc_dest', now, now
      );

      // Attempting to insert a second 'source' leg for the SAME transfer_id must fail unique constraint
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_s2', 'acc_source', null, 5000, 'transfer', 'tr_unique_test', 'source', 'acc_dest', now, now
        )
      ).rejects.toThrow(/UNIQUE/i);

      // Inserting first destination leg for the same transfer_id succeeds
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_d1', 'acc_dest', null, 5000, 'transfer', 'tr_unique_test', 'destination', 'acc_source', now, now
      );

      // Attempting to insert a second 'destination' leg for the SAME transfer_id must fail unique constraint
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          'tx_d2', 'acc_dest', null, 5000, 'transfer', 'tr_unique_test', 'destination', 'acc_source', now, now
        )
      ).rejects.toThrow(/UNIQUE/i);
    });

    it('enforces strict integer storage at the database boundary and rejects fractional values like 10.5', async () => {
      const now = Date.now();
      // Inserting a float (10.5) must be rejected by CHECK (typeof(amount) = 'integer')
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          'tx_float', 'acc_source', 'cat_inc_salary_wages', 10.5, 'income', now, now
        )
      ).rejects.toThrow(/CHECK/i);

      // Inserting 0.01 fractional value must also be rejected
      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          'tx_fractional', 'acc_source', 'cat_inc_salary_wages', 0.01, 'income', now, now
        )
      ).rejects.toThrow(/CHECK/i);
    });
  });
});
