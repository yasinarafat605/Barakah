import { getDatabase, closeDatabase, setDatabase, DEFAULT_DATABASE_NAME } from '../client';
import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations, getAppliedMigrations } from '../migrations';
import { AccountRow, CategoryRow, TransactionRow, DatabaseConnection } from '../types';
import { Money } from '../../domain/money';

describe('Barakah Database Core & Migrations (ADR-001, ADR-004)', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    // Isolated in-memory database for each test
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
    setDatabase(db);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('Migration Engine', () => {
    it('applies migrations from scratch cleanly and tracks them in schema_migrations', async () => {
      const result = await runMigrations(db);
      expect(result.applied).toBe(9);
      expect(result.versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      const applied = await getAppliedMigrations(db);
      expect(applied).toHaveLength(9);
      expect(applied[0].version).toBe(1);
      expect(applied[0].name).toBe('001_initial_schema');
      expect(applied[1].version).toBe(2);
      expect(applied[1].name).toBe('002_categories_and_transfers');
      expect(applied[2].version).toBe(3);
      expect(applied[2].name).toBe('003_debts_and_counterparties');
      expect(applied[3].version).toBe(4);
      expect(applied[3].name).toBe('004_debt_ledger_integrity_upgrade');
      expect(applied[4].version).toBe(5);
      expect(applied[4].name).toBe('005_backup_metadata_and_checksums');
      expect(applied[5].version).toBe(6);
      expect(applied[5].name).toBe('006_backup_integrity_hardening');
      expect(applied[6].version).toBe(7);
      expect(applied[6].name).toBe('007_backup_export_statuses');
      expect(applied[8].name).toBe('009_planning_integrity_corrections');
      expect(typeof applied[0].applied_at).toBe('number');
    });

    it('is idempotent: running migrations a second time applies 0 new migrations', async () => {
      await runMigrations(db);
      const secondRun = await runMigrations(db);
      expect(secondRun.applied).toBe(0);
      expect(secondRun.versions).toEqual([]);
    });

    it('uses singleton connection correctly via getDatabase()', async () => {
      const conn1 = await getDatabase();
      const conn2 = await getDatabase();
      expect(conn1).toBe(conn2);
    });
  });

  describe('Integrity & Integer Money Storage (ADR-004 / Rule 1)', () => {
    beforeEach(async () => {
      await runMigrations(db);
    });

    it('inserts and retrieves account with integer minor units (poisha)', async () => {
      const now = Date.now();
      const initialBalance = 150000; // 1,500.00 BDT in poisha

      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_main_bank',
        'Main Bank Account',
        'bank',
        initialBalance,
        'BDT',
        now,
        now
      );

      const account = await db.getFirstAsync<AccountRow>('SELECT * FROM accounts WHERE id = ?;', 'acc_main_bank');

      expect(account).not.toBeNull();
      expect(account?.name).toBe('Main Bank Account');
      expect(account?.initial_balance).toBe(150000);
      expect(Number.isInteger(account?.initial_balance)).toBe(true);

      // Verify domain Money integration
      const money = new Money(account!.initial_balance, account!.currency);
      expect(money.toMajorUnitString()).toBe('1500.00');
      expect(money.format('en')).toBe('৳1,500.00');
      expect(money.format('bn')).toBe('৳১,৫০০.০০');
    });

    it('inserts and retrieves transactions with integer minor units', async () => {
      const now = Date.now();

      // Setup account and category
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_cash',
        'Cash Wallet',
        'cash',
        50000, // 500.00 BDT
        'BDT',
        now,
        now
      );

      await db.runAsync(
        `INSERT INTO categories (id, name_key, icon, color, type)
         VALUES (?, ?, ?, ?, ?);`,
        'cat_food',
        'categories.food',
        'fast-food',
        '#087A62',
        'expense'
      );

      const category = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?;', 'cat_food');
      expect(category?.name_key).toBe('categories.food');
      expect(category?.type).toBe('expense');

      // Insert transaction with integer minor units
      const txAmount = 12550; // 125.50 BDT
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, occurred_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
        'tx_001',
        'acc_cash',
        'cat_food',
        txAmount,
        'expense',
        'Lunch with colleagues',
        now,
        now
      );

      const tx = await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id = ?;', 'tx_001');

      expect(tx).not.toBeNull();
      expect(tx?.amount).toBe(12550);
      expect(Number.isInteger(tx?.amount)).toBe(true);
      expect(tx?.type).toBe('expense');

      // Verify derived balance calculation (ADR-005: balances are derived, never stored)
      const opening = new Money(50000);
      const expense = new Money(tx!.amount);
      const remaining = opening.subtract(expense);

      expect(remaining.amount).toBe(37450); // 374.50 BDT
      expect(remaining.format('bn')).toBe('৳৩৭৪.৫০');
      expect(remaining.format('en')).toBe('৳374.50');
    });

    it('enforces CHECK constraints on category and transaction types', async () => {
      // Invalid category type
      await expect(
        db.runAsync(
          `INSERT INTO categories (id, name_key, icon, color, type)
           VALUES (?, ?, ?, ?, ?);`,
          'cat_invalid',
          'test',
          null,
          null,
          'invalid_kind'
        )
      ).rejects.toThrow();
    });
  });

  describe('Foreign Key Enforcement (PRAGMA foreign_keys = ON)', () => {
    beforeEach(async () => {
      await runMigrations(db);
    });

    it('rejects transactions with an orphaned account_id', async () => {
      const now = Date.now();

      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, occurred_on, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
          'tx_orphan',
          'non_existent_account',
          'cat_exp_food_groceries',
          1000,
          'expense',
          'Orphan test',
          now,
          now
        )
      ).rejects.toThrow(/FOREIGN KEY/i);
    });

    it('rejects transactions with an invalid category_id', async () => {
      const now = Date.now();

      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_valid',
        'Valid Account',
        'bank',
        0,
        'BDT',
        now,
        now
      );

      await expect(
        db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, occurred_on, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
          'tx_bad_cat',
          'acc_valid',
          'non_existent_category',
          500,
          'income',
          'Bad category',
          now,
          now
        )
      ).rejects.toThrow(/FOREIGN KEY/i);
    });

    it('prevents deleting an account that has existing transactions (ON DELETE RESTRICT)', async () => {
      const now = Date.now();

      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_parent',
        'Parent Account',
        'bank',
        10000,
        'BDT',
        now,
        now
      );

      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, occurred_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
        'tx_child',
        'acc_parent',
        'cat_inc_salary_wages',
        2000,
        'income',
        'Salary deposit',
        now,
        now
      );

      // Attempting to delete account must fail due to RESTRICT
      await expect(db.runAsync('DELETE FROM accounts WHERE id = ?;', 'acc_parent')).rejects.toThrow(/FOREIGN KEY/i);
    });
  });

  describe('Database Configuration', () => {
    it('defines barakah.db as the default clean database name', () => {
      expect(DEFAULT_DATABASE_NAME).toBe('barakah.db');
    });
  });
});
