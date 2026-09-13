import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { setDatabase, closeDatabase } from '../client';
import { DatabaseConnection } from '../types';
import { createAccount, getAccountById } from '../accounts';
import { createCounterparty } from '../counterparties';
import {
  calculateDueState,
  createDebt,
  getDebtById,
  getDebts,
  getDebtTimeline,
  recordRepayment,
  restoreRepayment,
  cancelDebt,
  restoreCancelledDebt,
  softDeleteRepayment,
  updateDebt,
  getDebtSummary,
  recordAdjustment,
  archiveDebt,
  restoreArchivedDebt,
  isValidCivilDate,
} from '../debts';
import { getTransactions, softDeleteTransaction, restoreTransaction } from '../transactions';

describe('Debts & Repayments Repository (Phase 3)', () => {
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

  describe('Debt Creation & Account Cash Integration', () => {
    it('creates a borrowed debt with cash disbursement and increases account balance', async () => {
      const cp = await createCounterparty({ name: 'Brother Farhan' });
      const acc = await createAccount({
        name: 'Primary Bank',
        type: 'bank',
        initialBalancePoisha: 50000, // ৳500.00
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 200000, // ৳2,000.00
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
        note: 'Emergency personal loan',
      });

      expect(debt.id).toMatch(/^debt_/);
      expect(debt.direction).toBe('borrowed');
      expect(debt.original_principal).toBe(200000);
      expect(debt.outstanding_principal).toBe(200000);
      expect(debt.total_repaid).toBe(0);
      expect(debt.status).toBe('active');

      // Account balance increased: 500 + 2,000 = 2,500 (250000 poisha)
      const updatedAcc = await getAccountById(acc.id);
      expect(updatedAcc?.current_balance_poisha).toBe(250000);

      // Verify transaction row was created with cat_inc_loan_received
      const txs = await getTransactions({ accountId: acc.id });
      expect(txs).toHaveLength(1);
      expect(txs[0].type).toBe('income');
      expect(txs[0].category_name_key).toBe('loan_received');
      expect(txs[0].amount).toBe(200000);
    });

    it('creates a lent debt with cash disbursement and decreases account balance', async () => {
      const cp = await createCounterparty({ name: 'Cousin Tariq' });
      const acc = await createAccount({
        name: 'Main Wallet',
        type: 'mobile_wallet',
        initialBalancePoisha: 500000, // ৳5,000.00
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'lent',
        originalPrincipalMinor: 150000, // ৳1,500.00
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      expect(debt.direction).toBe('lent');
      expect(debt.outstanding_principal).toBe(150000);

      // Account balance decreased: 5,000 - 1,500 = 3,500 (350000 poisha)
      const updatedAcc = await getAccountById(acc.id);
      expect(updatedAcc?.current_balance_poisha).toBe(350000);

      // Transaction created with cat_exp_loan_given
      const txs = await getTransactions({ accountId: acc.id });
      expect(txs).toHaveLength(1);
      expect(txs[0].type).toBe('expense');
      expect(txs[0].category_name_key).toBe('loan_given');
      expect(txs[0].amount).toBe(150000);
    });

    it('creates an existing debt without cash transaction and leaves account balances unchanged', async () => {
      const cp = await createCounterparty({ name: 'Old Lender' });
      const acc = await createAccount({
        name: 'Cash Box',
        type: 'cash',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 300000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      expect(debt.opening_mode).toBe('existing_balance');
      expect(debt.outstanding_principal).toBe(300000);

      // Account balance remains 100000
      const updatedAcc = await getAccountById(acc.id);
      expect(updatedAcc?.current_balance_poisha).toBe(100000);

      // Zero transactions created
      const txs = await getTransactions();
      expect(txs).toHaveLength(0);
    });

    it('rejects cross-currency account disbursement', async () => {
      const cp = await createCounterparty({ name: 'Foreign Friend' });
      const bdtAcc = await createAccount({
        name: 'BDT Account',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });

      await expect(
        createDebt({
          counterpartyId: cp.id,
          direction: 'borrowed',
          originalPrincipalMinor: 1000,
          currency: 'USD', // USD debt opened with BDT account
          openingMode: 'new_with_cash',
          accountId: bdtAcc.id,
        })
      ).rejects.toThrow(/Account currency \(BDT\) must match debt currency \(USD\)/i);
    });
  });

  describe('Repayments, Invariants & Automatic Settlement', () => {
    it('handles partial repayment, updates account balance, and derives outstanding balance', async () => {
      const cp = await createCounterparty({ name: 'Shops' });
      const acc = await createAccount({
        name: 'Repay Bank',
        type: 'bank',
        initialBalancePoisha: 1000000, // ৳10,000.00
        currency: 'BDT',
      });

      // Existing borrowed debt of ৳5,000 (500000 poisha)
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 500000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      // Repay ৳2,000 (200000 poisha) from bank
      const repayment = await recordRepayment({
        debtId: debt.id,
        amountMinor: 200000,
        accountId: acc.id,
        note: 'First installment',
      });

      expect(repayment.amount).toBe(200000);

      // Debt outstanding updated: 5,000 - 2,000 = 3,000
      const updatedDebt = await getDebtById(debt.id);
      expect(updatedDebt?.total_repaid).toBe(200000);
      expect(updatedDebt?.outstanding_principal).toBe(300000);
      expect(updatedDebt?.status).toBe('active');

      // Account balance reduced: 10,000 - 2,000 = 8,000
      const updatedAcc = await getAccountById(acc.id);
      expect(updatedAcc?.current_balance_poisha).toBe(800000);

      // Verify transaction created with cat_exp_loan_repayment
      const txs = await getTransactions({ accountId: acc.id });
      expect(txs).toHaveLength(1);
      expect(txs[0].type).toBe('expense');
      expect(txs[0].category_name_key).toBe('loan_repayment');
    });

    it('strictly rejects overpayment beyond current outstanding principal', async () => {
      const cp = await createCounterparty({ name: 'Landlord' });
      const acc = await createAccount({
        name: 'Landlord Account',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000, // ৳1,000.00
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      // Attempting to repay ৳1,500 on ৳1,000 debt must fail
      await expect(
        recordRepayment({
          debtId: debt.id,
          amountMinor: 150000,
          accountId: acc.id,
        })
      ).rejects.toThrow(/cannot exceed outstanding principal/i);
    });

    it('automatically transitions debt status to settled when fully repaid', async () => {
      const cp = await createCounterparty({ name: 'Colleague' });
      const acc = await createAccount({
        name: 'Colleague Account',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'lent',
        originalPrincipalMinor: 200000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 200000, // Exact full amount
        accountId: acc.id,
      });

      const settledDebt = await getDebtById(debt.id);
      expect(settledDebt?.outstanding_principal).toBe(0);
      expect(settledDebt?.total_repaid).toBe(200000);
      expect(settledDebt?.status).toBe('settled');
      expect(settledDebt?.due_state).toBe('settled');
    });

    it('soft-deletes repayment, restores balance, and automatically reopens settled debt', async () => {
      const cp = await createCounterparty({ name: 'Relative' });
      const acc = await createAccount({
        name: 'Relative Account',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      const repayment = await recordRepayment({
        debtId: debt.id,
        amountMinor: 100000,
        accountId: acc.id,
      });

      // Verified settled
      const settled = await getDebtById(debt.id);
      expect(settled?.status).toBe('settled');

      // Soft-delete the repayment
      await softDeleteRepayment(repayment.id);

      // Reopened back to active with full outstanding balance
      const reopened = await getDebtById(debt.id);
      expect(reopened?.status).toBe('active');
      expect(reopened?.outstanding_principal).toBe(100000);
      expect(reopened?.total_repaid).toBe(0);

      // Restore repayment (Undo)
      await restoreRepayment(repayment.id);
      const reSettled = await getDebtById(debt.id);
      expect(reSettled?.status).toBe('settled');
      expect(reSettled?.outstanding_principal).toBe(0);
    });

    it('prevents deleting debt with repayment history', async () => {
      const cp = await createCounterparty({ name: 'Partner' });
      const acc = await createAccount({
        name: 'Partner Account',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 50000,
        accountId: acc.id,
      });

      await expect(cancelDebt(debt.id)).rejects.toThrow(
        /Cannot cancel a debt that has repayments/i
      );
    });

    it('allows deleting debt without repayments and soft-deletes disbursement', async () => {
      const cp = await createCounterparty({ name: 'Accidental Debt' });
      const acc = await createAccount({
        name: 'Temp Bank',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      await cancelDebt(debt.id);

      const activeDebts = await getDebts({ includeDeleted: false });
      expect(activeDebts.some((d) => d.id === debt.id)).toBe(false);

      // Account balance reverted because linked transaction was soft-deleted
      const updatedAcc = await getAccountById(acc.id);
      expect(updatedAcc?.current_balance_poisha).toBe(100000);
    });

    it('calculates due states correctly based on local calendar dates', () => {
      const now = new Date(2026, 8, 13, 12, 0).getTime(); // Sep 13, 2026 12:00
      const pastDateStr = '2026-09-10'; // Sep 10, 2026 (overdue)
      const soonDateStr = '2026-09-16'; // Sep 16, 2026 (due soon: <= 7 days)
      const futureDateStr = '2026-09-30'; // Sep 30, 2026 (active)

      expect(calculateDueState('active', null, 5000, now)).toBe('active');
      expect(calculateDueState('active', pastDateStr, 5000, now)).toBe('overdue');
      expect(calculateDueState('active', soonDateStr, 5000, now)).toBe('due_soon');
      expect(calculateDueState('active', futureDateStr, 5000, now)).toBe('active');
      expect(calculateDueState('settled', pastDateStr, 0, now)).toBe('settled');
      expect(calculateDueState('active', pastDateStr, 5000, now, Date.now())).toBe('archived');
      // Negative balance is not settled
      expect(calculateDueState('active', pastDateStr, -1000, now)).toBe('active');
    });

    it('retrieves debt timeline with disbursement and repayment events', async () => {
      const cp = await createCounterparty({ name: 'Timeline Friend' });
      const acc = await createAccount({
        name: 'Timeline Bank',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 500000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
        note: 'Initial agreement',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 100000,
        accountId: acc.id,
        note: 'Payment 1',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 150000,
        accountId: acc.id,
        note: 'Payment 2',
      });

      const timeline = await getDebtTimeline(debt.id);
      expect(timeline).toHaveLength(3); // 1 disbursement + 2 repayments
      expect(timeline.filter((t) => t.role === 'repayment')).toHaveLength(2);
      expect(timeline.filter((t) => t.role === 'disbursement')).toHaveLength(1);
    });

    it('updates debt note and civil due date correctly', async () => {
      const cp = await createCounterparty({ name: 'Editable Debt Cp' });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        openingMode: 'existing_balance',
        note: 'Old note',
      });

      const updated = await updateDebt(debt.id, {
        note: 'New agreement note',
        dueDate: '2026-09-25',
      });

      expect(updated.note).toBe('New agreement note');
      expect(updated.due_date).toBe('2026-09-25');
    });

    it('retrieves aggregate debt summary grouped by currency', async () => {
      const cp = await createCounterparty({ name: 'Summary Cp' });
      await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 200000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });
      await createDebt({
        counterpartyId: cp.id,
        direction: 'lent',
        originalPrincipalMinor: 350000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      const summary = await getDebtSummary();
      expect(summary.totalBorrowedByCurrency['BDT']).toBeGreaterThanOrEqual(200000);
      expect(summary.totalLentByCurrency['BDT']).toBeGreaterThanOrEqual(350000);
    });

    it('records explicit adjustments and enforces non-negative bounds on decrease', async () => {
      const cp = await createCounterparty({ name: 'Adjustment Cp' });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000, // ৳1,000.00
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      // 1. Adjustment decrease (e.g. debt waiver/forgiveness of ৳400.00)
      const adjDec = await recordAdjustment({
        debtId: debt.id,
        amountMinor: 40000,
        direction: 'decrease',
        note: 'Agreed partial waiver',
      });
      expect(adjDec.role).toBe('adjustment_decrease');

      const afterDec = await getDebtById(debt.id);
      expect(afterDec?.outstanding_principal).toBe(60000);
      expect(afterDec?.status).toBe('active');

      // 2. Adjustment decrease exceeding remaining balance must be rejected
      await expect(
        recordAdjustment({
          debtId: debt.id,
          amountMinor: 70000, // exceeds 60000
          direction: 'decrease',
        })
      ).rejects.toThrow(/Adjustment decrease .* cannot exceed outstanding principal/i);

      // 3. Adjustment decrease that brings balance to 0 settles the debt
      await recordAdjustment({
        debtId: debt.id,
        amountMinor: 60000,
        direction: 'decrease',
        note: 'Full remainder forgiveness',
      });

      const afterSettled = await getDebtById(debt.id);
      expect(afterSettled?.outstanding_principal).toBe(0);
      expect(afterSettled?.status).toBe('settled');

      // 4. Adjustment increase on a settled debt reopens it to active
      await recordAdjustment({
        debtId: debt.id,
        amountMinor: 20000,
        direction: 'increase',
        note: 'Additional agreed fee/cost',
      });

      const afterInc = await getDebtById(debt.id);
      expect(afterInc?.outstanding_principal).toBe(20000);
      expect(afterInc?.status).toBe('active');
    });

    it('archives and restores debts independently from lifecycle status', async () => {
      const cp = await createCounterparty({ name: 'Archival Cp' });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      expect(debt.status).toBe('active');
      expect(debt.archived_at).toBeNull();

      // Archive debt
      await archiveDebt(debt.id);
      const archived = await getDebtById(debt.id);
      expect(archived?.archived_at).not.toBeNull();
      expect(archived?.status).toBe('active'); // status preserved

      // getDebts without archived excluded it
      const activeDebts = await getDebts({ isArchived: false });
      expect(activeDebts.some((d) => d.id === debt.id)).toBe(false);

      // getDebts with isArchived: true returns it
      const archivedDebts = await getDebts({ isArchived: true });
      expect(archivedDebts.some((d) => d.id === debt.id)).toBe(true);

      // Restore archived debt
      await restoreArchivedDebt(debt.id);
      const restored = await getDebtById(debt.id);
      expect(restored?.archived_at).toBeNull();
      expect(restored?.status).toBe('active');
    });

    it('synchronizes soft-deleting and restoring repayment via generic transaction repository', async () => {
      const cp = await createCounterparty({ name: 'Sync Repayment Cp' });
      const acc = await createAccount({
        name: 'Sync Wallet',
        type: 'mobile_wallet',
        initialBalancePoisha: 100000, // ৳1,000.00
        currency: 'BDT',
      });

      // Borrow ৳500
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      // Account: 1000 + 500 = 1500
      let curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(150000);

      // Repay ৳500 with cash
      const repayment = await recordRepayment({
        debtId: debt.id,
        amountMinor: 50000,
        accountId: acc.id,
      });

      expect(repayment.transaction_id).not.toBeNull();
      const settledDebt = await getDebtById(debt.id);
      expect(settledDebt?.status).toBe('settled');
      expect(settledDebt?.outstanding_principal).toBe(0);

      // Account balance: 1500 - 500 = 1000
      curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(100000);

      // Now soft-delete this repayment from the GENERIC transactions screen!
      await softDeleteTransaction(repayment.transaction_id!);

      // 1. Debt balance is restored and reopened
      const reopenedDebt = await getDebtById(debt.id);
      expect(reopenedDebt?.status).toBe('active');
      expect(reopenedDebt?.outstanding_principal).toBe(50000);
      expect(reopenedDebt?.total_repaid).toBe(0);

      // 2. Account balance is restored: 1000 + 500 = 1500
      curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(150000);

      // 3. Restore transaction from generic transactions screen
      await restoreTransaction(repayment.transaction_id!);

      // Debt is settled again
      const reSettled = await getDebtById(debt.id);
      expect(reSettled?.status).toBe('settled');
      expect(reSettled?.outstanding_principal).toBe(0);

      // Account balance returns to 1000
      curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(100000);
    });

    it('strictly blocks generic deletion of every debt disbursement transaction via transactions screen', async () => {
      const cp = await createCounterparty({ name: 'Disbursement Safeguard Cp' });
      const acc = await createAccount({
        name: 'Disb Wallet',
        type: 'mobile_wallet',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      // Get disbursement transaction ID
      const timeline = await getDebtTimeline(debt.id);
      const disbursementTx = timeline.find((t) => t.role === 'disbursement');
      expect(disbursementTx?.transaction_id).toBeDefined();

      // 1. Generic deletion without repayments must be BLOCKED
      await expect(
        softDeleteTransaction(disbursementTx!.transaction_id!)
      ).rejects.toThrow(/Cannot delete a debt disbursement transaction directly/i);

      // 2. Generic deletion with repayments must also be BLOCKED
      await recordRepayment({
        debtId: debt.id,
        amountMinor: 20000,
        accountId: acc.id,
      });

      await expect(
        softDeleteTransaction(disbursementTx!.transaction_id!)
      ).rejects.toThrow(/Cannot delete a debt disbursement transaction directly/i);

      // 3. Generic restoration of disbursement must also be BLOCKED
      await expect(
        restoreTransaction(disbursementTx!.transaction_id!)
      ).rejects.toThrow(/Cannot restore a debt disbursement transaction directly/i);
    });
  });

  describe('Dedicated Debt Cancellation & Atomicity', () => {
    it('blocks cancellation of a debt that has active repayments', async () => {
      const cp = await createCounterparty({ name: 'Cancel Repayment Test' });
      const acc = await createAccount({
        name: 'Cancel Repay Acc',
        type: 'bank',
        initialBalancePoisha: 500000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 20000,
        accountId: acc.id,
      });

      await expect(cancelDebt(debt.id)).rejects.toThrow(
        /Cannot cancel a debt that has repayments/i
      );
    });

    it('blocks cancellation of a debt that has adjustments', async () => {
      const cp = await createCounterparty({ name: 'Cancel Adj Test' });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      await recordAdjustment({
        debtId: debt.id,
        amountMinor: 10000,
        direction: 'decrease',
      });

      await expect(cancelDebt(debt.id)).rejects.toThrow(
        /Cannot cancel a debt that has adjustments/i
      );
    });

    it('atomically cancels newly entered debt and updates account, debt, and link, then restores completely', async () => {
      const cp = await createCounterparty({ name: 'Atomic Cancel Cp' });
      const acc = await createAccount({
        name: 'Atomic Bank',
        type: 'bank',
        initialBalancePoisha: 200000, // ৳2,000
        currency: 'BDT',
      });

      // 1. Create debt with cash: ৳1,000 borrowed -> account balance becomes ৳3,000
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      let curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(300000);

      // 2. Atomically cancel newly entered debt
      await cancelDebt(debt.id);

      // Debt is soft-deleted
      const activeDebts = await getDebts({ includeDeleted: false });
      expect(activeDebts.some((d) => d.id === debt.id)).toBe(false);

      const deletedDebt = await getDebtById(debt.id);
      expect(deletedDebt?.deleted_at).not.toBeNull();

      // Account balance reverted to initial ৳2,000
      curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(200000);

      // 3. Atomically restore cancelled debt
      await restoreCancelledDebt(debt.id);

      const restoredDebt = await getDebtById(debt.id);
      expect(restoredDebt?.deleted_at).toBeNull();
      expect(restoredDebt?.status).toBe('active');

      // Account balance restored back to ৳3,000
      curAcc = await getAccountById(acc.id);
      expect(curAcc?.current_balance_poisha).toBe(300000);
    });
  });

  describe('Strict Real Calendar Date Validation', () => {
    it('accurately validates real calendar dates and rejects rollover anomalies', () => {
      // Valid leap day
      expect(isValidCivilDate('2024-02-29')).toBe(true);
      expect(isValidCivilDate('2000-02-29')).toBe(true);

      // Invalid leap day (2026 and 1900 are not leap years)
      expect(isValidCivilDate('2026-02-29')).toBe(false);
      expect(isValidCivilDate('1900-02-29')).toBe(false);

      // Invalid day (February 31, April 31)
      expect(isValidCivilDate('2026-02-31')).toBe(false);
      expect(isValidCivilDate('2026-04-31')).toBe(false);

      // Invalid month
      expect(isValidCivilDate('2026-13-10')).toBe(false);
      expect(isValidCivilDate('2026-00-10')).toBe(false);
      expect(isValidCivilDate('2026-13-40')).toBe(false);

      // Valid standard dates
      expect(isValidCivilDate('2026-01-31')).toBe(true);
      expect(isValidCivilDate('2026-12-31')).toBe(true);
      expect(isValidCivilDate('2026-09-13')).toBe(true);

      // Malformed shapes
      expect(isValidCivilDate('tomorrow')).toBe(false);
      expect(isValidCivilDate('2026/09/13')).toBe(false);
      expect(isValidCivilDate(null)).toBe(false);
      expect(isValidCivilDate(undefined)).toBe(false);
    });

    it('rejects invalid civil dates on debt creation and update', async () => {
      const cp = await createCounterparty({ name: 'Date Validation Cp' });

      // Create with non-existent leap day
      await expect(
        createDebt({
          counterpartyId: cp.id,
          direction: 'borrowed',
          originalPrincipalMinor: 50000,
          openingMode: 'existing_balance',
          dueDate: '2026-02-29',
        })
      ).rejects.toThrow(/valid real calendar date/i);

      // Create with invalid month/day
      await expect(
        createDebt({
          counterpartyId: cp.id,
          direction: 'borrowed',
          originalPrincipalMinor: 50000,
          openingMode: 'existing_balance',
          dueDate: '2026-13-40',
        })
      ).rejects.toThrow(/valid real calendar date/i);

      const validDebt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        openingMode: 'existing_balance',
        dueDate: '2026-09-20',
      });

      // Update with invalid day
      await expect(
        updateDebt(validDebt.id, { dueDate: '2026-04-31' })
      ).rejects.toThrow(/valid real calendar date/i);
    });

    it('evaluates due today, due soon, and overdue states across timezones and locales', () => {
      const baseMs = new Date(2026, 8, 13, 15, 30).getTime(); // Sep 13, 2026

      // Due today (same civil calendar date)
      expect(calculateDueState('active', '2026-09-13', 10000, baseMs)).toBe('due_soon');

      // Due tomorrow / within 7 days
      expect(calculateDueState('active', '2026-09-14', 10000, baseMs)).toBe('due_soon');
      expect(calculateDueState('active', '2026-09-20', 10000, baseMs)).toBe('due_soon');

      // Overdue (yesterday or earlier)
      expect(calculateDueState('active', '2026-09-12', 10000, baseMs)).toBe('overdue');
      expect(calculateDueState('active', '2025-09-13', 10000, baseMs)).toBe('overdue');

      // Future active (> 7 days)
      expect(calculateDueState('active', '2026-09-21', 10000, baseMs)).toBe('active');
    });
  });

  describe('Adjustment Lifecycle & Restoration Bounds', () => {
    it('strictly enforces bounds when restoring a decreasing adjustment', async () => {
      const cp = await createCounterparty({ name: 'Adj Bounds Cp' });
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000, // ৳1,000
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      // 1. Record decreasing adjustment of ৳600
      const adj1 = await recordAdjustment({
        debtId: debt.id,
        amountMinor: 60000,
        direction: 'decrease',
      });

      // Outstanding is now ৳400
      let cur = await getDebtById(debt.id);
      expect(cur?.outstanding_principal).toBe(40000);

      // 2. Soft-delete the adjustment -> outstanding returns to ৳1,000
      await softDeleteRepayment(adj1.id);
      cur = await getDebtById(debt.id);
      expect(cur?.outstanding_principal).toBe(100000);

      // 3. Record another decreasing adjustment of ৳700 -> outstanding is now ৳300
      await recordAdjustment({
        debtId: debt.id,
        amountMinor: 70000,
        direction: 'decrease',
      });
      cur = await getDebtById(debt.id);
      expect(cur?.outstanding_principal).toBe(30000);

      // 4. Attempting to restore adj1 (৳600) when only ৳300 is outstanding MUST FAIL bounds check!
      await expect(restoreRepayment(adj1.id)).rejects.toThrow(
        /Cannot restore adjustment_decrease: would exceed outstanding principal/i
      );
    });
  });

  describe('Archived-Debt Financial Mutation Rules', () => {
    it('rejects all financial mutations and edits on an archived debt', async () => {
      const cp = await createCounterparty({ name: 'Archived Mutation Cp' });
      const acc = await createAccount({
        name: 'Archived Mutation Acc',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      // Record a partial repayment, then soft-delete it so we can test restoring it later
      const rep = await recordRepayment({
        debtId: debt.id,
        amountMinor: 20000,
        accountId: acc.id,
      });
      await softDeleteRepayment(rep.id);

      // Archive the debt
      await archiveDebt(debt.id);

      // 1. Reject recording repayment
      await expect(
        recordRepayment({
          debtId: debt.id,
          amountMinor: 10000,
          accountId: acc.id,
        })
      ).rejects.toThrow(/Cannot record repayment on an archived debt/i);

      // 2. Reject restoring repayment
      await expect(restoreRepayment(rep.id)).rejects.toThrow(
        /Cannot restore transaction on an archived debt/i
      );

      // 3. Reject recording adjustment
      await expect(
        recordAdjustment({
          debtId: debt.id,
          amountMinor: 5000,
          direction: 'decrease',
        })
      ).rejects.toThrow(/Cannot record adjustment on an archived debt/i);

      // 4. Reject updating debt
      await expect(
        updateDebt(debt.id, { note: 'Attempted edit' })
      ).rejects.toThrow(/Cannot edit an archived debt/i);

      // 5. Reject cancelling debt
      await expect(cancelDebt(debt.id)).rejects.toThrow(
        /Cannot cancel an archived debt/i
      );

      // 6. Unarchive restores mutation capability
      await restoreArchivedDebt(debt.id);
      await expect(
        recordRepayment({
          debtId: debt.id,
          amountMinor: 10000,
          accountId: acc.id,
        })
      ).resolves.toBeDefined();
    });
  });

  describe('Link-Role Semantics & Cross-Currency Safeguards', () => {
    it('rejects cross-currency debt creation and repayments', async () => {
      const cp = await createCounterparty({ name: 'Cross Currency Cp' });
      const bdtAcc = await createAccount({
        name: 'BDT Bank',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'BDT',
      });
      const usdAcc = await createAccount({
        name: 'USD Bank',
        type: 'bank',
        initialBalancePoisha: 100000,
        currency: 'USD',
      });

      // 1. Opening debt in BDT with USD account fails
      await expect(
        createDebt({
          counterpartyId: cp.id,
          direction: 'borrowed',
          originalPrincipalMinor: 50000,
          currency: 'BDT',
          openingMode: 'new_with_cash',
          accountId: usdAcc.id,
        })
      ).rejects.toThrow(/must match debt currency/i);

      // 2. Valid BDT debt creation
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: bdtAcc.id,
      });

      // 3. Repayment in BDT debt with USD account fails
      await expect(
        recordRepayment({
          debtId: debt.id,
          amountMinor: 10000,
          accountId: usdAcc.id,
        })
      ).rejects.toThrow(/must match debt currency/i);
    });

    it('requires accountId on repayment and verifies transaction attributes match', async () => {
      const cp = await createCounterparty({ name: 'Repayment Attributes Cp' });
      const acc = await createAccount({
        name: 'Repayment Bank',
        type: 'bank',
        initialBalancePoisha: 200000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      // Borrowed debt repayment creates an expense with cat_exp_loan_repayment
      const rep = await recordRepayment({
        debtId: debt.id,
        amountMinor: 30000,
        accountId: acc.id,
      });

      expect(rep.transaction_id).not.toBeNull();
      const txs = await getTransactions({ accountId: acc.id });
      const repTx = txs.find((t) => t.id === rep.transaction_id);
      expect(repTx).toBeDefined();
      expect(repTx?.amount).toBe(30000);
      expect(repTx?.type).toBe('expense');
      expect(repTx?.category_id).toBe('cat_exp_loan_repayment');
    });
  });

  describe('Concurrent Overpayment Rejection', () => {
    it('re-reads outstanding balance within exclusive transaction to reject overpayment', async () => {
      const cp = await createCounterparty({ name: 'Concurrency Cp' });
      const acc = await createAccount({
        name: 'Concurrency Bank',
        type: 'bank',
        initialBalancePoisha: 1000000,
        currency: 'BDT',
      });

      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 50000,
        currency: 'BDT',
        openingMode: 'new_with_cash',
        accountId: acc.id,
      });

      // First repayment of 40,000 succeeds (leaves 10,000 outstanding)
      await recordRepayment({
        debtId: debt.id,
        amountMinor: 40000,
        accountId: acc.id,
      });

      // Subsequent attempt of 20,000 fails because outstanding is now 10,000
      await expect(
        recordRepayment({
          debtId: debt.id,
          amountMinor: 20000,
          accountId: acc.id,
        })
      ).rejects.toThrow(/cannot exceed outstanding principal/i);
    });
  });
});
