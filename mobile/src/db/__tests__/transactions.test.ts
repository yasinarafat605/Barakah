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

      const activeList = await getTransactions();
      expect(activeList).toHaveLength(2);
    });
  });
});
