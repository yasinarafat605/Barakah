import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { setDatabase, closeDatabase } from '../client';
import { DatabaseConnection } from '../types';
import { getCategories } from '../categories';

describe('Migration 003: Debts, Liabilities & Counterparties', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
    setDatabase(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('creates counterparties, debts, and debt_transactions tables', async () => {
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('counterparties', 'debts', 'debt_transactions');"
    );
    const tableNames = new Set(tables.map((t) => t.name));

    expect(tableNames.has('counterparties')).toBe(true);
    expect(tableNames.has('debts')).toBe(true);
    expect(tableNames.has('debt_transactions')).toBe(true);
  });

  it('seeds the 2 new default debt categories (total 22 default categories)', async () => {
    const allCategories = await getCategories();
    expect(allCategories).toHaveLength(22);

    const loanRepaymentReceived = allCategories.find(
      (c) => c.id === 'cat_inc_loan_repayment_received'
    );
    expect(loanRepaymentReceived).toBeDefined();
    expect(loanRepaymentReceived?.name_key).toBe('loan_repayment_received');
    expect(loanRepaymentReceived?.type).toBe('income');
    expect(loanRepaymentReceived?.is_default).toBe(1);

    const loanGiven = allCategories.find((c) => c.id === 'cat_exp_loan_given');
    expect(loanGiven).toBeDefined();
    expect(loanGiven?.name_key).toBe('loan_given');
    expect(loanGiven?.type).toBe('expense');
    expect(loanGiven?.is_default).toBe(1);
  });

  it('strictly rejects fractional and negative amounts in debts table', async () => {
    const now = Date.now();
    // Insert a valid counterparty first
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?);`,
      'cp_1', 'Rahim', 'person', now, now
    );

    // 1. Fractional amount (10.5) must fail CHECK (typeof(original_principal) = 'integer')
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES (?, ?, ?, 10.5, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
        'debt_frac', 'cp_1', 'borrowed', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 2. Negative amount must fail CHECK (original_principal > 0)
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES (?, ?, ?, -1000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
        'debt_neg', 'cp_1', 'borrowed', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 3. Invalid direction must fail CHECK (direction IN ('borrowed', 'lent'))
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES (?, ?, 'invalid_dir', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
        'debt_inv', 'cp_1', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 4. Valid insert succeeds
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
        'debt_valid', 'cp_1', now, now, now
      )
    ).resolves.toBeDefined();
  });

  it('enforces foreign key restrictions on counterparties and debts', async () => {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?);`,
      'cp_fk_test', 'Karim', 'person', now, now
    );

    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
       VALUES (?, ?, 'lent', 50000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
      'debt_fk_test', 'cp_fk_test', now, now, now
    );

    // Attempting to delete counterparty with active debt must fail via ON DELETE RESTRICT
    await expect(
      db.runAsync('DELETE FROM counterparties WHERE id = ?;', 'cp_fk_test')
    ).rejects.toThrow();
  });

  it('enforces civil calendar due_date format GLOB and rejects invalid date strings', async () => {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?);`,
      'cp_date_test', 'Date Tester', 'person', now, now
    );

    // 1. Invalid date format '2026/09/13' (slashes instead of dashes) must fail CHECK
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
         VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, '2026/09/13', 'active', ?, ?);`,
        'debt_bad_date_1', 'cp_date_test', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 2. Arbitrary text 'tomorrow' must fail CHECK
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
         VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'tomorrow', 'active', ?, ?);`,
        'debt_bad_date_2', 'cp_date_test', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 3. Valid YYYY-MM-DD date '2026-09-13' succeeds
    await expect(
      db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
         VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, '2026-09-13', 'active', ?, ?);`,
        'debt_good_date', 'cp_date_test', now, now, now
      )
    ).resolves.toBeDefined();
  });

  it('enforces unique partial index on debt_transactions.transaction_id', async () => {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?);`,
      'cp_uq_test', 'Unique Tester', 'person', now, now
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
       VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
      'debt_uq_test', 'cp_uq_test', now, now, now
    );

    // Create parent account and cash transaction to satisfy foreign keys
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES (?, ?, 'bank', 100000, 'BDT', ?, ?);`,
      'acc_uq_test', 'Test Acc', now, now
    );
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, occurred_on, created_at, updated_at)
       VALUES (?, 'acc_uq_test', 'cat_exp_food_groceries', 5000, 'expense', ?, '2026-01-01', ?, ?);`,
      'tx_single', now, now, now
    );

    // First debt_transaction linking to 'tx_single' succeeds
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES (?, ?, 'tx_single', 5000, 'repayment', ?, ?, ?);`,
      'dtx_1', 'debt_uq_test', now, now, now
    );

    // Second debt_transaction linking to the same 'tx_single' must fail UNIQUE index
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES (?, ?, 'tx_single', 5000, 'repayment', ?, ?, ?);`,
        'dtx_2', 'debt_uq_test', now, now, now
      )
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it('enforces explicit adjustment roles and rejects legacy role names', async () => {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?);`,
      'cp_role_test', 'Role Tester', 'person', now, now
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
       VALUES (?, ?, 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
      'debt_role_test', 'cp_role_test', now, now, now
    );

    // 'adjustment_increase' succeeds
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, amount, role, occurred_at, created_at, updated_at)
         VALUES (?, ?, 1000, 'adjustment_increase', ?, ?, ?);`,
        'dtx_adj_inc', 'debt_role_test', now, now, now
      )
    ).resolves.toBeDefined();

    // 'adjustment_decrease' succeeds
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, amount, role, occurred_at, created_at, updated_at)
         VALUES (?, ?, 500, 'adjustment_decrease', ?, ?, ?);`,
        'dtx_adj_dec', 'debt_role_test', now, now, now
      )
    ).resolves.toBeDefined();

    // Generic 'adjustment' must fail CHECK constraint
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, amount, role, occurred_at, created_at, updated_at)
         VALUES (?, ?, 500, 'adjustment', ?, ?, ?);`,
        'dtx_adj_generic', 'debt_role_test', now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);
  });
});
