import { createBetterSqliteConnection } from '../test-adapter';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import { migration004 } from '../migrations/004_debt_ledger_integrity_upgrade';
import { DatabaseConnection } from '../types';

describe('Migration 004: Debt Ledger Integrity Upgrade', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);

    // Run migrations 001, 002, and 003 to establish exact v3 baseline
    await migration001.up(db);
    await migration002.up(db);
    await migration003.up(db);
  });

  it('safely upgrades populated v3 database to v4 schema and preserves all data', async () => {
    const now = 1757764800000; // 2025-09-13T12:00:00.000Z

    // Insert baseline counterparties
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES ('cp_1', 'Rahim', 'person', 0, ?, ?);`,
      now, now
    );
    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES ('cp_2', 'Karim Ltd', 'business', 0, ?, ?);`,
      now, now
    );

    // Insert accounts and transactions
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_1', 'City Bank', 'bank', 500000, 'BDT', ?, ?);`,
      now, now
    );

    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
       VALUES ('tx_disb_1', 'acc_1', 'cat_inc_loan_received', 100000, 'income', ?, ?, ?);`,
      now, now, now
    );
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
       VALUES ('tx_repay_1', 'acc_1', 'cat_exp_loan_repayment', 40000, 'expense', ?, ?, ?);`,
      now, now, now
    );

    // Insert v3 debts (one with integer due_date, one with status 'archived', one settled)
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
       VALUES ('debt_int_date', 'cp_1', 'borrowed', 100000, 'BDT', 'new_with_cash', ?, ?, 'active', ?, ?);`,
      now, now, now, now // due_date is integer timestamp
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
       VALUES ('debt_archived', 'cp_2', 'lent', 50000, 'BDT', 'existing_balance', ?, NULL, 'archived', ?, ?);`,
      now, now, now // status is 'archived'
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, due_date, status, created_at, updated_at)
       VALUES ('debt_settled', 'cp_1', 'lent', 20000, 'BDT', 'existing_balance', ?, NULL, 'settled', ?, ?);`,
      now, now, now
    );

    // Insert v3 debt_transactions (disbursement, repayment, old 'adjustment' roles, and synthetic placeholder disbursement)
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES ('dtx_disb', 'debt_int_date', 'tx_disb_1', 100000, 'disbursement', ?, ?, ?);`,
      now, now, now
    );
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES ('dtx_repay', 'debt_int_date', 'tx_repay_1', 40000, 'repayment', ?, ?, ?);`,
      now, now, now
    );
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at)
       VALUES ('dtx_adj_dec', 'debt_int_date', NULL, 5000, 'adjustment', 'agreed discount waiver', ?, ?, ?);`,
      now, now, now
    );
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at)
       VALUES ('dtx_adj_inc', 'debt_int_date', NULL, 2000, 'adjustment', 'late fee increase added', ?, ?, ?);`,
      now, now, now
    );
    // Synthetic non-cash placeholder disbursement for existing_balance
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES ('dtx_placeholder', 'debt_archived', NULL, 50000, 'disbursement', ?, ?, ?);`,
      now, now, now
    );

    // Record pre-migration counts
    const debtsBefore = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debts;');
    const repaymentsBefore = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM debt_transactions WHERE role = 'repayment';"
    );
    expect(debtsBefore?.count).toBe(3);
    expect(repaymentsBefore?.count).toBe(1);

    // Execute Migration 004
    await migration004.up(db);

    // 1. Validate Row Counts & Row Preservation
    const debtsAfter = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debts;');
    const repaymentsAfter = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM debt_transactions WHERE role = 'repayment';"
    );
    expect(debtsAfter?.count).toBe(3);
    expect(repaymentsAfter?.count).toBe(1);

    // 2. Foreign Key Check
    const fkViolations = await db.getAllAsync('PRAGMA foreign_key_check;');
    expect(fkViolations).toHaveLength(0);

    // 3. Verify Integer due_date converted to YYYY-MM-DD
    const debt1 = await db.getFirstAsync<{ due_date: string; status: string; archived_at: number | null }>(
      'SELECT due_date, status, archived_at FROM debts WHERE id = ?;',
      'debt_int_date'
    );
    expect(debt1?.due_date).toBe('2025-09-13');
    expect(debt1?.status).toBe('active');
    expect(debt1?.archived_at).toBeNull();

    // 4. Verify status 'archived' converted to 'active' with archived_at populated
    const debt2 = await db.getFirstAsync<{ status: string; archived_at: number | null }>(
      'SELECT status, archived_at FROM debts WHERE id = ?;',
      'debt_archived'
    );
    expect(debt2?.status).toBe('active');
    expect(debt2?.archived_at).toBe(now);

    // 5. Verify old adjustment roles converted correctly
    const adjDec = await db.getFirstAsync<{ role: string; transaction_id: string | null }>(
      'SELECT role, transaction_id FROM debt_transactions WHERE id = ?;',
      'dtx_adj_dec'
    );
    expect(adjDec?.role).toBe('adjustment_decrease');
    expect(adjDec?.transaction_id).toBeNull();

    const adjInc = await db.getFirstAsync<{ role: string; transaction_id: string | null }>(
      'SELECT role, transaction_id FROM debt_transactions WHERE id = ?;',
      'dtx_adj_inc'
    );
    expect(adjInc?.role).toBe('adjustment_increase');
    expect(adjInc?.transaction_id).toBeNull();

    // 6. Verify synthetic placeholder disbursement was removed
    const placeholder = await db.getFirstAsync(
      'SELECT id FROM debt_transactions WHERE id = ?;',
      'dtx_placeholder'
    );
    expect(placeholder).toBeNull();
  });

  it('enforces link-role semantics check constraint on upgraded schema', async () => {
    await migration004.up(db);
    const now = Date.now();

    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES ('cp_sem', 'Semantics Tester', 'person', 0, ?, ?);`,
      now, now
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
       VALUES ('debt_sem', 'cp_sem', 'borrowed', 10000, 'BDT', 'existing_balance', ?, 'active', ?, ?);`,
      now, now, now
    );

    // Rule 1: disbursement requires transaction_id NOT NULL
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_fail_1', 'debt_sem', NULL, 10000, 'disbursement', ?, ?, ?);`,
        now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // Rule 2: repayment requires transaction_id NOT NULL
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_fail_2', 'debt_sem', NULL, 2000, 'repayment', ?, ?, ?);`,
        now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // Rule 3: adjustment_increase requires transaction_id IS NULL
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_sem', 'Semantics Acc', 'bank', 50000, 'BDT', ?, ?);`,
      now, now
    );
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
       VALUES ('tx_sem', 'acc_sem', 'cat_inc_loan_received', 1000, 'income', ?, ?, ?);`,
      now, now, now
    );

    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_fail_3', 'debt_sem', 'tx_sem', 1000, 'adjustment_increase', ?, ?, ?);`,
        now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);

    // Rule 4: adjustment_decrease requires transaction_id IS NULL
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_fail_4', 'debt_sem', 'tx_sem', 1000, 'adjustment_decrease', ?, ?, ?);`,
        now, now, now
      )
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('enforces unique index uq_debt_tx_transaction_id', async () => {
    await migration004.up(db);
    const now = Date.now();

    await db.runAsync(
      `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
       VALUES ('cp_uq', 'Unique Tester', 'person', 0, ?, ?);`,
      now, now
    );
    await db.runAsync(
      `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
       VALUES ('debt_uq', 'cp_uq', 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
      now, now, now
    );
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_uq', 'Acc', 'bank', 50000, 'BDT', ?, ?);`,
      now, now
    );
    await db.runAsync(
      `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
       VALUES ('tx_unique_link', 'acc_uq', 'cat_inc_loan_received', 5000, 'income', ?, ?, ?);`,
      now, now, now
    );

    // First link succeeds
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES ('dtx_uq_1', 'debt_uq', 'tx_unique_link', 5000, 'disbursement', ?, ?, ?);`,
      now, now, now
    );

    // Second link with duplicate transaction_id fails unique constraint
    await expect(
      db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_uq_2', 'debt_uq', 'tx_unique_link', 5000, 'repayment', ?, ?, ?);`,
        now, now, now
      )
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });
});
