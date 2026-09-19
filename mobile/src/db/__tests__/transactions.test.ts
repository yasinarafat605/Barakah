import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { setDatabase, closeDatabase } from '../client';
import {
  createAccount,
  getAccountsWithBalances,
} from '../accounts';
import {
  createIncomeTransaction,
  createExpenseTransaction,
  createTransfer,
  getTransactions,
  getTransactionById,
  softDeleteTransaction,
  restoreTransaction,
} from '../transactions';
import { DatabaseConnection } from '../types';

describe('Transactions & Paired Transfer Repository (Milestone 2)', () => {
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

  describe('Income & Expense Operations', () => {
    it('rejects unsafe transaction amounts and timestamps before SQLite', async () => {
      const first = await createAccount({ name: 'First', type: 'cash', initialBalancePoisha: 0, currency: 'BDT' });
      const second = await createAccount({ name: 'Second', type: 'cash', initialBalancePoisha: 0, currency: 'BDT' });
      await expect(createIncomeTransaction({ accountId:first.id,categoryId:'cat_inc_salary_wages',amountMinor:Number.MAX_SAFE_INTEGER+1,occurredOn:'2026-01-01' })).rejects.toThrow(/safe integer/i);
      await expect(createExpenseTransaction({ accountId:first.id,categoryId:'cat_exp_food_groceries',amountMinor:Number.MAX_SAFE_INTEGER+1,occurredOn:'2026-01-01' })).rejects.toThrow(/safe integer/i);
      await expect(createTransfer({ sourceAccountId:first.id,destinationAccountId:second.id,amountMinor:Number.MAX_SAFE_INTEGER+1,occurredOn:'2026-01-01' })).rejects.toThrow(/safe integer/i);
      await expect(createIncomeTransaction({ accountId:first.id,categoryId:'cat_inc_salary_wages',amountMinor:1,occurredAt:Number.MAX_SAFE_INTEGER+1,occurredOn:'2026-01-01' })).rejects.toThrow(/UNSAFE_TIMESTAMP/);
    });
    it('creates an income transaction and increases derived account balance', async () => {
      const acc = await createAccount({
        name: 'Daily Checking',
        type: 'bank',
        initialBalancePoisha: 10000, // 100.00 BDT
        currency: 'BDT',
      });

      const tx = await createIncomeTransaction({
        accountId: acc.id,
        categoryId: 'cat_inc_salary_wages',
        amountMinor: 50000, // 500.00 BDT
        occurredAt: Date.now(),
        note: 'Freelance pay',
      });

      expect(tx.id).toBeDefined();
      expect(tx.type).toBe('income');
      expect(tx.amount).toBe(50000);
      expect(tx.transfer_id).toBeNull();
      expect(tx.transfer_role).toBeNull();

      // Verify derived balance
      const [updatedAcc] = await getAccountsWithBalances();
      expect(updatedAcc.current_balance_poisha).toBe(60000); // 100 + 500 = 600 BDT
    });

    it('creates an expense transaction and decreases derived account balance', async () => {
      const acc = await createAccount({
        name: 'Cash Pocket',
        type: 'cash',
        initialBalancePoisha: 20000, // 200.00 BDT
        currency: 'BDT',
      });

      const tx = await createExpenseTransaction({
        accountId: acc.id,
        categoryId: 'cat_exp_food_groceries',
        amountMinor: 7500, // 75.00 BDT
        occurredAt: Date.now(),
        note: 'Supermarket',
      });

      expect(tx.type).toBe('expense');
      expect(tx.amount).toBe(7500);

      const [updatedAcc] = await getAccountsWithBalances();
      expect(updatedAcc.current_balance_poisha).toBe(12500); // 200 - 75 = 125 BDT
    });
  });

  describe('Paired Transfer Ledger (Dual-Entry Transfer)', () => {
    let sourceAccId: string;
    let destAccId: string;

    beforeEach(async () => {
      const source = await createAccount({
        name: 'Main Bank',
        type: 'bank',
        initialBalancePoisha: 100000, // 1,000.00 BDT
        currency: 'BDT',
      });
      const dest = await createAccount({
        name: 'bKash Wallet',
        type: 'mobile_wallet',
        initialBalancePoisha: 20000, // 200.00 BDT
        currency: 'BDT',
      });

      sourceAccId = source.id;
      destAccId = dest.id;
    });

    it('creates two paired positive-amount rows linked by transfer_id', async () => {
      const { sourceTransaction, destinationTransaction, transferId } = await createTransfer({
        sourceAccountId: sourceAccId,
        destinationAccountId: destAccId,
        amountMinor: 30000, // 300.00 BDT
        occurredAt: Date.now(),
        note: 'ATM transfer to bKash',
      });

      expect(transferId).toBeDefined();

      // Source leg
      expect(sourceTransaction.account_id).toBe(sourceAccId);
      expect(sourceTransaction.related_account_id).toBe(destAccId);
      expect(sourceTransaction.transfer_role).toBe('source');
      expect(sourceTransaction.transfer_id).toBe(transferId);
      expect(sourceTransaction.amount).toBe(30000); // Positive integer minor units
      expect(sourceTransaction.type).toBe('transfer');
      expect(sourceTransaction.category_id).toBeNull();

      // Destination leg
      expect(destinationTransaction.account_id).toBe(destAccId);
      expect(destinationTransaction.related_account_id).toBe(sourceAccId);
      expect(destinationTransaction.transfer_role).toBe('destination');
      expect(destinationTransaction.transfer_id).toBe(transferId);
      expect(destinationTransaction.amount).toBe(30000); // Positive integer minor units
      expect(destinationTransaction.type).toBe('transfer');
      expect(destinationTransaction.category_id).toBeNull();

      // Verify derived balances
      const accounts = await getAccountsWithBalances();
      const sourceAcc = accounts.find((a) => a.id === sourceAccId);
      const destAcc = accounts.find((a) => a.id === destAccId);

      expect(sourceAcc?.current_balance_poisha).toBe(70000); // 1000 - 300 = 700 BDT
      expect(destAcc?.current_balance_poisha).toBe(50000); // 200 + 300 = 500 BDT

      // Net total across accounts remains conserved
      const totalBalance = accounts.reduce((sum, a) => sum + a.current_balance_poisha, 0);
      expect(totalBalance).toBe(120000); // 1000 + 200 = 1200 BDT
    });

    it('rejects transfer between the exact same account', async () => {
      await expect(
        createTransfer({
          sourceAccountId: sourceAccId,
          destinationAccountId: sourceAccId,
          amountMinor: 10000,
        })
      ).rejects.toThrow(/must be different/i);
    });

    it('rejects cross-currency transfers', async () => {
      const usdAcc = await createAccount({
        name: 'USD Account',
        type: 'bank',
        initialBalancePoisha: 50000,
        currency: 'USD',
      });

      await expect(
        createTransfer({
          sourceAccountId: sourceAccId,
          destinationAccountId: usdAcc.id,
          amountMinor: 10000,
        })
      ).rejects.toThrow(/Cross-currency transfers are not supported/i);
    });
  });

  describe('Soft Delete and Atomic Transfer Removal', () => {
    it('atomically soft deletes both legs of a paired transfer', async () => {
      const source = await createAccount({
        name: 'Bank',
        type: 'bank',
        initialBalancePoisha: 50000,
        currency: 'BDT',
      });
      const dest = await createAccount({
        name: 'Cash',
        type: 'cash',
        initialBalancePoisha: 10000,
        currency: 'BDT',
      });

      const { sourceTransaction, destinationTransaction } = await createTransfer({
        sourceAccountId: source.id,
        destinationAccountId: dest.id,
        amountMinor: 15000,
      });

      // Soft delete using the source transaction ID
      await softDeleteTransaction(sourceTransaction.id);

      // Both transactions must now have deleted_at populated
      const sourceRow = await getTransactionById(sourceTransaction.id);
      const destRow = await getTransactionById(destinationTransaction.id);

      expect(sourceRow?.deleted_at).not.toBeNull();
      expect(destRow?.deleted_at).not.toBeNull();

      // Active transactions list excludes them
      const activeList = await getTransactions();
      expect(activeList).toHaveLength(0);

      // Balances revert back to initial
      const accounts = await getAccountsWithBalances();
      const src = accounts.find((a) => a.id === source.id);
      const dst = accounts.find((a) => a.id === dest.id);
      expect(src?.current_balance_poisha).toBe(50000);
      expect(dst?.current_balance_poisha).toBe(10000);
    });

    it('atomically restores both legs of a soft-deleted transfer', async () => {
      const source = await createAccount({
        name: 'Bank',
        type: 'bank',
        initialBalancePoisha: 50000,
        currency: 'BDT',
      });
      const dest = await createAccount({
        name: 'Cash',
        type: 'cash',
        initialBalancePoisha: 10000,
        currency: 'BDT',
      });

      const { sourceTransaction, destinationTransaction } = await createTransfer({
        sourceAccountId: source.id,
        destinationAccountId: dest.id,
        amountMinor: 15000,
      });

      await softDeleteTransaction(sourceTransaction.id);

      // Restore using destination ID
      await restoreTransaction(destinationTransaction.id);

      const sourceRow = await getTransactionById(sourceTransaction.id);
      const destRow = await getTransactionById(destinationTransaction.id);

      expect(sourceRow?.deleted_at).toBeNull();
      expect(destRow?.deleted_at).toBeNull();

      // Ungrouped internal ledger has 2 rows
      const rawLedger = await getTransactions({ groupByTransfer: false });
      expect(rawLedger).toHaveLength(2);

      // Global feed groups into 1 logical item
      const globalFeed = await getTransactions();
      expect(globalFeed).toHaveLength(1);
    });

    it('proves that one transfer creates two database rows but one global history item', async () => {
      const source = await createAccount({
        name: 'Bank A',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });
      const dest = await createAccount({
        name: 'Wallet B',
        type: 'mobile_wallet',
        initialBalancePoisha: 50000,
        currency: 'BDT',
      });

      await createTransfer({
        sourceAccountId: source.id,
        destinationAccountId: dest.id,
        amountMinor: 25000,
        note: 'Savings allocation',
      });

      // 1. Direct database check: exactly 2 rows exist in the transactions table
      const countRow = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM transactions;'
      );
      expect(countRow?.count).toBe(2);

      // 2. Ungrouped query (e.g. for audit/raw ledger): returns 2 rows
      const rawList = await getTransactions({ groupByTransfer: false });
      expect(rawList).toHaveLength(2);

      // 3. Global transactions history feed: returns exactly 1 grouped transfer item
      const globalList = await getTransactions();
      expect(globalList).toHaveLength(1);

      const [item] = globalList;
      expect(item.type).toBe('transfer');
      expect(item.amount).toBe(25000);
      expect(item.source_account_name).toBe('Bank A');
      expect(item.destination_account_name).toBe('Wallet B');
      expect(item.related_account_name).toBe('Wallet B');
      expect(item.note).toBe('Savings allocation');

      // 4. Account-specific query (e.g. Bank A only): returns 1 leg specific to Bank A
      const bankList = await getTransactions({ accountId: source.id });
      expect(bankList).toHaveLength(1);
      expect(bankList[0].transfer_role).toBe('source');

      const walletList = await getTransactions({ accountId: dest.id });
      expect(walletList).toHaveLength(1);
      expect(walletList[0].transfer_role).toBe('destination');
    });

    it('treats empty or whitespace-only notes as null and preserves non-empty notes', async () => {
      const acc = await createAccount({
        name: 'Note Test Bank',
        type: 'bank',
        initialBalancePoisha: 50000,
        currency: 'BDT',
      });

      // Whitespace-only note
      const txWhitespace = await createIncomeTransaction({
        accountId: acc.id,
        categoryId: 'cat_inc_salary_wages',
        amountMinor: 1000,
        note: '     ',
      });
      expect(txWhitespace.note).toBeNull();

      // Empty string note
      const txEmpty = await createIncomeTransaction({
        accountId: acc.id,
        categoryId: 'cat_inc_salary_wages',
        amountMinor: 1000,
        note: '',
      });
      expect(txEmpty.note).toBeNull();

      // Real note preserved
      const txNote = await createIncomeTransaction({
        accountId: acc.id,
        categoryId: 'cat_inc_salary_wages',
        amountMinor: 1000,
        note: 'Legitimate note with spaces',
      });
      expect(txNote.note).toBe('Legitimate note with spaces');

      // Check retrieved row
      const retrieved = await getTransactionById(txNote.id);
      expect(retrieved?.note).toBe('Legitimate note with spaces');
    });

    it('preserves visibility of archived categories on historical transactions', async () => {
      // 1. Create account and transaction
      const acc = await createAccount({
        name: 'Historic Account',
        type: 'cash',
        initialBalancePoisha: 10000,
        currency: 'BDT',
      });

      const tx = await createIncomeTransaction({
        accountId: acc.id,
        categoryId: 'cat_inc_salary_wages',
        amountMinor: 5000,
        note: 'Paycheck before archiving',
      });

      // 2. Archive category
      await db.runAsync('UPDATE categories SET is_archived = 1 WHERE id = ?;', 'cat_inc_salary_wages');

      // 3. Query historical transactions
      const history = await getTransactions();
      const match = history.find((t) => t.id === tx.id);

      expect(match).toBeDefined();
      expect(match?.category_name_key).toBe('salary_wages');
      expect(match?.account_name).toBe('Historic Account');

      // 4. Referenced account cannot be hard-deleted (ON DELETE RESTRICT)
      await expect(
        db.runAsync('DELETE FROM accounts WHERE id = ?;', acc.id)
      ).rejects.toThrow();
    });

    it('rejects cross-currency transfers', async () => {
      const bdtAcc = await createAccount({
        name: 'BDT Account',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });

      // Create a USD account manually
      const now = Date.now();
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_usd_test', 'USD Savings', 'savings', 50000, 'USD', now, now
      );

      await expect(
        createTransfer({
          sourceAccountId: bdtAcc.id,
          destinationAccountId: 'acc_usd_test',
          amountMinor: 1000,
        })
      ).rejects.toThrow(/Cross-currency transfers are not supported/i);
    });
  });
});
