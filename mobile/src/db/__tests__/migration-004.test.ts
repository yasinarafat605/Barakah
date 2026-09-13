import { createBetterSqliteConnection } from '../test-adapter';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import {
  migration004,
  convertLegacyDueDateToCivilDate,
} from '../migrations/004_debt_ledger_integrity_upgrade';
import { DatabaseConnection } from '../types';
import { classifyCashFlow } from '../../domain/cashflow';

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

  it('safely upgrades populated v3 database to v4 schema and preserves 100% of rows', async () => {
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
    // Legacy non-cash opening record for existing_balance
    await db.runAsync(
      `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
       VALUES ('dtx_placeholder', 'debt_archived', NULL, 50000, 'disbursement', ?, ?, ?);`,
      now, now, now
    );

    // Record pre-migration counts
    const debtsBefore = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debts;');
    const debtTxBefore = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debt_transactions;');
    expect(debtsBefore?.count).toBe(3);
    expect(debtTxBefore?.count).toBe(5);

    // Execute Migration 004
    await migration004.up(db);

    // 1. Validate 100% Row Preservation (Zero deletions)
    const debtsAfter = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debts;');
    const debtTxAfter = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM debt_transactions;');
    expect(debtsAfter?.count).toBe(3);
    expect(debtTxAfter?.count).toBe(5);

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

    // 4. Verify status 'archived' converted to 'active' with archived_at populated (since outstanding > 0)
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

    // 6. Verify legacy non-cash disbursement was preserved as 'opening_balance'
    const openingBal = await db.getFirstAsync<{ role: string; transaction_id: string | null }>(
      'SELECT role, transaction_id FROM debt_transactions WHERE id = ?;',
      'dtx_placeholder'
    );
    expect(openingBal).not.toBeNull();
    expect(openingBal?.role).toBe('opening_balance');
    expect(openingBal?.transaction_id).toBeNull();
  });

  describe('Archived Debts Lifecycle State Derivation', () => {
    const now = 1757764800000;

    beforeEach(async () => {
      await db.runAsync(
        `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
         VALUES ('cp_arc', 'Archived Tester', 'person', 0, ?, ?);`,
        now, now
      );
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES ('acc_arc', 'Arc Bank', 'bank', 500000, 'BDT', ?, ?);`,
        now, now
      );
    });

    it('preserves archived settled debt as settled with archived_at populated (does not reopen)', async () => {
      // Debt: 50,000 principal, 50,000 repaid, status = 'archived'
      await db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES ('debt_arc_settled', 'cp_arc', 'borrowed', 50000, 'BDT', 'new_with_cash', ?, 'archived', ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_arc_disb', 'acc_arc', 'cat_inc_loan_received', 50000, 'income', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_arc_repay', 'acc_arc', 'cat_exp_loan_repayment', 50000, 'expense', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_arc_disb', 'debt_arc_settled', 'tx_arc_disb', 50000, 'disbursement', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_arc_repay', 'debt_arc_settled', 'tx_arc_repay', 50000, 'repayment', ?, ?, ?);`,
        now, now, now
      );

      await migration004.up(db);

      const debt = await db.getFirstAsync<{ status: string; archived_at: number | null }>(
        'SELECT status, archived_at FROM debts WHERE id = ?;',
        'debt_arc_settled'
      );
      expect(debt?.status).toBe('settled'); // Correctly derived as settled!
      expect(debt?.archived_at).toBe(now); // Preserved archived_at!
    });

    it('derives archived active debt as active with archived_at populated when balance remains', async () => {
      // Debt: 50,000 principal, 20,000 repaid, status = 'archived'
      await db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES ('debt_arc_active', 'cp_arc', 'borrowed', 50000, 'BDT', 'new_with_cash', ?, 'archived', ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_arc_disb2', 'acc_arc', 'cat_inc_loan_received', 50000, 'income', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_arc_repay2', 'acc_arc', 'cat_exp_loan_repayment', 20000, 'expense', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_arc_disb2', 'debt_arc_active', 'tx_arc_disb2', 50000, 'disbursement', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_arc_repay2', 'debt_arc_active', 'tx_arc_repay2', 20000, 'repayment', ?, ?, ?);`,
        now, now, now
      );

      await migration004.up(db);

      const debt = await db.getFirstAsync<{ status: string; archived_at: number | null }>(
        'SELECT status, archived_at FROM debts WHERE id = ?;',
        'debt_arc_active'
      );
      expect(debt?.status).toBe('active');
      expect(debt?.archived_at).toBe(now);
    });

    it('correctly derives active status when repayment was soft-deleted', async () => {
      // Debt: 30,000 principal, repayment of 30,000 was deleted, status = 'archived'
      await db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES ('debt_arc_del_rep', 'cp_arc', 'borrowed', 30000, 'BDT', 'new_with_cash', ?, 'archived', ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_arc_disb3', 'acc_arc', 'cat_inc_loan_received', 30000, 'income', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at, deleted_at)
         VALUES ('tx_arc_repay3', 'acc_arc', 'cat_exp_loan_repayment', 30000, 'expense', ?, ?, ?, ?);`,
        now, now, now, now // soft-deleted in transactions!
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at, deleted_at)
         VALUES ('dtx_arc_disb3', 'debt_arc_del_rep', 'tx_arc_disb3', 30000, 'disbursement', ?, ?, ?, NULL);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at, deleted_at)
         VALUES ('dtx_arc_repay3', 'debt_arc_del_rep', 'tx_arc_repay3', 30000, 'repayment', ?, ?, ?, ?);`,
        now, now, now, now // soft-deleted in debt_transactions!
      );

      await migration004.up(db);

      const debt = await db.getFirstAsync<{ status: string; archived_at: number | null }>(
        'SELECT status, archived_at FROM debts WHERE id = ?;',
        'debt_arc_del_rep'
      );
      // Because the repayment was soft-deleted, outstanding remains 30,000 -> active!
      expect(debt?.status).toBe('active');
      expect(debt?.archived_at).toBe(now);
    });

    it('correctly factors legacy adjustments into archived debt lifecycle calculation', async () => {
      // Debt: 40,000 principal, 30,000 repaid, 10,000 waiver adjustment decrease -> outstanding is 0 -> settled!
      await db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES ('debt_arc_adj', 'cp_arc', 'borrowed', 40000, 'BDT', 'new_with_cash', ?, 'archived', ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_disb_adj', 'acc_arc', 'cat_inc_loan_received', 40000, 'income', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_repay_adj', 'acc_arc', 'cat_exp_loan_repayment', 30000, 'expense', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_disb_adj', 'debt_arc_adj', 'tx_disb_adj', 40000, 'disbursement', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_repay_adj', 'debt_arc_adj', 'tx_repay_adj', 30000, 'repayment', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at)
         VALUES ('dtx_adj_waiver', 'debt_arc_adj', NULL, 10000, 'adjustment', 'final waiver', ?, ?, ?);`,
        now, now, now
      );

      await migration004.up(db);

      const debt = await db.getFirstAsync<{ status: string; archived_at: number | null }>(
        'SELECT status, archived_at FROM debts WHERE id = ?;',
        'debt_arc_adj'
      );
      // 40,000 - 30,000 - 10,000 = 0 -> settled!
      expect(debt?.status).toBe('settled');
      expect(debt?.archived_at).toBe(now);
    });

    it('rolls back atomic migration when a debt has corrupted negative outstanding balance', async () => {
      // Debt: 10,000 principal, 20,000 repaid -> negative balance!
      await db.runAsync(
        `INSERT INTO debts (id, counterparty_id, direction, original_principal, currency, opening_mode, opened_at, status, created_at, updated_at)
         VALUES ('debt_corrupt', 'cp_arc', 'borrowed', 10000, 'BDT', 'new_with_cash', ?, 'active', ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_corrupt_disb', 'acc_arc', 'cat_inc_loan_received', 10000, 'income', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
         VALUES ('tx_corrupt_repay', 'acc_arc', 'cat_exp_loan_repayment', 20000, 'expense', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_corrupt_disb', 'debt_corrupt', 'tx_corrupt_disb', 10000, 'disbursement', ?, ?, ?);`,
        now, now, now
      );
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_corrupt_repay', 'debt_corrupt', 'tx_corrupt_repay', 20000, 'repayment', ?, ?, ?);`,
        now, now, now
      );

      // Migration must fail with descriptive error
      await expect(migration004.up(db)).rejects.toThrow(/corrupted negative outstanding balance/i);

      // Verify schema rollback: v3 schema remains active, debts_new does not exist
      const tables = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'debts_new';"
      );
      expect(tables).toHaveLength(0);

      // The uncorrupted debts table still exists
      const intactDebt = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM debts WHERE id = ?;',
        'debt_corrupt'
      );
      expect(intactDebt).not.toBeNull();
    });
  });

  describe('Civil Due Date Timezone Shift Prevention', () => {
    it('converts legacy timestamps using local calendar components accurately', () => {
      // 1. Text date-only value remains intact
      expect(convertLegacyDueDateToCivilDate('2026-09-25')).toBe('2026-09-25');
      expect(convertLegacyDueDateToCivilDate('2024-02-29')).toBe('2024-02-29');

      // 2. Null or undefined
      expect(convertLegacyDueDateToCivilDate(null)).toBeNull();
      expect(convertLegacyDueDateToCivilDate(undefined)).toBeNull();

      // 3. Local midnight conversion
      const localDate = new Date(2026, 8, 25, 0, 0, 0, 0); // 2026-09-25 local
      expect(convertLegacyDueDateToCivilDate(localDate.getTime())).toBe('2026-09-25');

      // 4. Local 23:59:59 conversion
      const endOfDay = new Date(2026, 8, 25, 23, 59, 59, 999);
      expect(convertLegacyDueDateToCivilDate(endOfDay.getTime())).toBe('2026-09-25');

      // 5. Leap day local midnight
      const leapDay = new Date(2024, 1, 29, 0, 0, 0, 0);
      expect(convertLegacyDueDateToCivilDate(leapDay.getTime())).toBe('2024-02-29');
    });

    it('preserves user civil dates across simulated timezone offsets and DST transitions', () => {
      // Test explicit timestamp representations across key global offsets
      // Asia/Dhaka (+06:00): local midnight on 2026-09-25 was 2026-09-24T18:00:00Z
      // A pure UTC strftime would have yielded 2026-09-24 (1-day back).
      // Testing local calendar interpretation:
      const dhakaMidnightUtcEpoch = 1790272800000;
      const dhakaDate = new Date(dhakaMidnightUtcEpoch);
      const civilStr = `${dhakaDate.getFullYear()}-${String(dhakaDate.getMonth() + 1).padStart(2, '0')}-${String(dhakaDate.getDate()).padStart(2, '0')}`;
      expect(convertLegacyDueDateToCivilDate(dhakaMidnightUtcEpoch)).toBe(civilStr);

      // America/New_York (EDT, -04:00): local midnight on 2026-09-25 was 2026-09-25T04:00:00Z
      const nyMidnightUtcEpoch = 1790308800000;
      const nyDate = new Date(nyMidnightUtcEpoch);
      const nyCivilStr = `${nyDate.getFullYear()}-${String(nyDate.getMonth() + 1).padStart(2, '0')}-${String(nyDate.getDate()).padStart(2, '0')}`;
      expect(convertLegacyDueDateToCivilDate(nyMidnightUtcEpoch)).toBe(nyCivilStr);

      // DST boundary (spring forward e.g. 2026-03-29)
      const dstDate = new Date(2026, 2, 29, 1, 0, 0, 0);
      expect(convertLegacyDueDateToCivilDate(dstDate.getTime())).toBe('2026-03-29');
    });
  });

  describe('Canonical Debt Category IDs & Cash-Flow Integration', () => {
    it('proves all 4 debt cash movements reference canonical category IDs and classify correctly', async () => {
      await migration004.up(db);
      const now = Date.now();

      await db.runAsync(
        `INSERT INTO counterparties (id, name, type, is_archived, created_at, updated_at)
         VALUES ('cp_cat', 'Category Tester', 'person', 0, ?, ?);`,
        now, now
      );
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES ('acc_cat', 'Cash Wallet', 'cash', 1000000, 'BDT', ?, ?);`,
        now, now
      );

      // The 4 canonical categories seeded in migration 002 and 003:
      const canonicalCategories = [
        { id: 'cat_inc_loan_received', type: 'income' as const, name: 'Loan Received' },
        { id: 'cat_exp_loan_given', type: 'expense' as const, name: 'Loan Given' },
        { id: 'cat_exp_loan_repayment', type: 'expense' as const, name: 'Loan Repayment' },
        { id: 'cat_inc_loan_repayment_received', type: 'income' as const, name: 'Loan Repayment Received' },
      ];

      // 1. Verify every canonical category exists in the database
      for (const cat of canonicalCategories) {
        const row = await db.getFirstAsync<{ id: string; type: string }>(
          'SELECT id, type FROM categories WHERE id = ?;',
          cat.id
        );
        expect(row).not.toBeNull();
        expect(row?.id).toBe(cat.id);
        expect(row?.type).toBe(cat.type);
      }

      // 2. Insert transactions referencing each of the 4 canonical categories
      const txs = [
        { id: 'tx_borrow_disb', amount: 50000, type: 'income' as const, categoryId: 'cat_inc_loan_received' },
        { id: 'tx_lent_disb', amount: 30000, type: 'expense' as const, categoryId: 'cat_exp_loan_given' },
        { id: 'tx_borrow_repay', amount: 20000, type: 'expense' as const, categoryId: 'cat_exp_loan_repayment' },
        { id: 'tx_lent_repay', amount: 15000, type: 'income' as const, categoryId: 'cat_inc_loan_repayment_received' },
      ];

      for (const tx of txs) {
        await db.runAsync(
          `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, created_at, updated_at)
           VALUES (?, 'acc_cat', ?, ?, ?, ?, ?, ?);`,
          tx.id, tx.categoryId, tx.amount, tx.type, now, now, now
        );
      }

      // 3. Verify Foreign Key check passes across all 4 transactions
      const fkViolations = await db.getAllAsync('PRAGMA foreign_key_check;');
      expect(fkViolations).toHaveLength(0);

      // 4. Verify Cash-flow classification
      // Total cash inflow = 50,000 (borrowed disb) + 15,000 (lent repayment) = 65,000
      // Earned income = 0 (debt movements are excluded!)
      // Total cash outflow = 30,000 (lent disb) + 20,000 (borrowed repayment) = 50,000
      // Ordinary consumption expenses = 0 (debt movements are excluded!)
      const summary = classifyCashFlow(
        txs.map((t) => ({
          amount: t.amount,
          type: t.type,
          category_id: t.categoryId,
        }))
      );

      expect(summary.totalCashInflow).toBe(65000);
      expect(summary.earnedIncome).toBe(0); // Protected: not earned income!
      expect(summary.totalCashOutflow).toBe(50000);
      expect(summary.ordinaryExpenses).toBe(0); // Protected: not ordinary consumption!
      expect(summary.debtPrincipalInflow).toBe(65000);
      expect(summary.debtPrincipalOutflow).toBe(50000);
    });
  });

  describe('Link-Role Semantics & Constraints', () => {
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

      // Rule 5: opening_balance requires transaction_id IS NULL (valid insertion)
      await db.runAsync(
        `INSERT INTO debt_transactions (id, debt_id, transaction_id, amount, role, occurred_at, created_at, updated_at)
         VALUES ('dtx_valid_op', 'debt_sem', NULL, 10000, 'opening_balance', ?, ?, ?);`,
        now, now, now
      );

      const opRow = await db.getFirstAsync<{ role: string; transaction_id: string | null }>(
        'SELECT role, transaction_id FROM debt_transactions WHERE id = ?;',
        'dtx_valid_op'
      );
      expect(opRow?.role).toBe('opening_balance');
      expect(opRow?.transaction_id).toBeNull();
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
});
