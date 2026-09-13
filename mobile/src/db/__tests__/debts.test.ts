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
  softDeleteDebt,
  softDeleteRepayment,
  updateDebt,
  getDebtSummary,
  recordAdjustment,
  archiveDebt,
  restoreArchivedDebt,
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
        })
      ).rejects.toThrow(/cannot exceed outstanding principal/i);
    });

    it('automatically transitions debt status to settled when fully repaid', async () => {
      const cp = await createCounterparty({ name: 'Colleague' });
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
      });

      const settledDebt = await getDebtById(debt.id);
      expect(settledDebt?.outstanding_principal).toBe(0);
      expect(settledDebt?.total_repaid).toBe(200000);
      expect(settledDebt?.status).toBe('settled');
      expect(settledDebt?.due_state).toBe('settled');
    });

    it('soft-deletes repayment, restores balance, and automatically reopens settled debt', async () => {
      const cp = await createCounterparty({ name: 'Relative' });
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
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 100000,
        currency: 'BDT',
        openingMode: 'existing_balance',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 50000,
      });

      await expect(softDeleteDebt(debt.id)).rejects.toThrow(
        /Cannot delete debt with repayment history/i
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

      await softDeleteDebt(debt.id);

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
      const debt = await createDebt({
        counterpartyId: cp.id,
        direction: 'borrowed',
        originalPrincipalMinor: 500000,
        currency: 'BDT',
        openingMode: 'existing_balance',
        note: 'Initial agreement',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 100000,
        note: 'Payment 1',
      });

      await recordRepayment({
        debtId: debt.id,
        amountMinor: 150000,
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

    it('rejects soft-deleting a debt disbursement transaction via transactions screen when repayments exist', async () => {
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

      // Record a partial repayment
      await recordRepayment({
        debtId: debt.id,
        amountMinor: 20000,
      });

      // Attempting to delete the disbursement from generic transactions must fail
      await expect(
        softDeleteTransaction(disbursementTx!.transaction_id!)
      ).rejects.toThrow(
        /Cannot delete debt disbursement transaction while repayments exist/i
      );
    });
  });
});
