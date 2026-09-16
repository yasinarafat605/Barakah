/**
 * Barakah Debts & Liabilities Repository & Data Access Layer
 * Strict adherence to:
 * - Local-first architecture (ADR-001)
 * - Rule 1 / ADR-004: All money stored as INTEGER minor units. No REAL/FLOAT.
 * - Dynamic derived balances: outstanding = original_principal - sum(repayments) +- adjustments.
 *   Zero mutable running total columns.
 * - Automatic settlement at zero; automatic reopening on repayment deletion.
 * - Multi-query atomic operations wrapped in exclusive transactions.
 */

import { getDatabase, runExclusiveTransaction } from './client';
import { assertCivilDate, localCivilDateFromTimestamp } from '../domain/civil-date';
import {
  CreateDebtInput,
  DatabaseConnection,
  DebtDueState,
  DebtFilters,
  DebtOpeningMode,
  DebtSummary,
  DebtTransactionRole,
  DebtTransactionRow,
  DebtTransactionWithDetails,
  DebtWithDetails,
  RecordAdjustmentInput,
  RecordRepaymentInput,
  UpdateDebtInput,
} from './types';

/**
 * Generates a unique collision-resistant debt ID.
 */
export function generateDebtId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `debt_${timestamp}_${randomPart}`;
}

/**
 * Generates a unique collision-resistant debt transaction ID.
 */
export function generateDebtTransactionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `dtx_${timestamp}_${randomPart}`;
}

/**
 * Generates a unique collision-resistant transaction ID.
 */
export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `tx_${timestamp}_${randomPart}`;
}

/**
 * Strict calendar date validation that round-trips year, month, and day without JavaScript rollover.
 * Validates real calendar dates in YYYY-MM-DD format (including leap years).
 */
export function isValidCivilDate(dateStr: string | null | undefined): boolean {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day < 1 || day > daysInMonth[month - 1]) return false;

  // Round trip check using UTC date components to eliminate JS date rollover
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return false;
  }

  return true;
}

/**
 * Computes the due state for a debt given its status, due date, and outstanding balance.
 * Civil calendar date strings (YYYY-MM-DD) eliminate device timezone and DST drift.
 */
export function calculateDueState(
  status: string,
  dueDate: string | number | null,
  outstandingPrincipal: number,
  nowMs: number = Date.now(),
  archivedAt: number | null = null
): DebtDueState {
  if (archivedAt !== null || status === 'archived') return 'archived';
  if (status === 'settled' || outstandingPrincipal === 0) return 'settled';
  if (outstandingPrincipal < 0) return 'active';

  if (!dueDate) return 'active';

  let dueDateStr: string;
  if (typeof dueDate === 'string') {
    if (!isValidCivilDate(dueDate)) return 'active';
    dueDateStr = dueDate;
  } else {
    const d = new Date(dueDate);
    const pad = (n: number) => String(n).padStart(2, '0');
    dueDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!isValidCivilDate(dueDateStr)) return 'active';
  }

  const now = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const sevenDaysLater = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const sevenDaysStr = `${sevenDaysLater.getFullYear()}-${pad(sevenDaysLater.getMonth() + 1)}-${pad(sevenDaysLater.getDate())}`;

  if (dueDateStr < todayStr) {
    return 'overdue';
  }
  if (dueDateStr <= sevenDaysStr) {
    return 'due_soon';
  }
  return 'active';
}

/**
 * Creates a new debt agreement, optionally creating a linked cash transaction atomically.
 */
export async function createDebt(
  input: CreateDebtInput,
  customDb?: DatabaseConnection
): Promise<DebtWithDetails> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  // Validate counterparty
  const cp = await db.getFirstAsync<{ id: string; name: string }>(
    'SELECT id, name FROM counterparties WHERE id = ?;',
    input.counterpartyId
  );
  if (!cp) {
    throw new Error(`Counterparty not found: ${input.counterpartyId}`);
  }

  // Validate principal
  if (!Number.isInteger(input.originalPrincipalMinor) || input.originalPrincipalMinor <= 0) {
    throw new Error(
      `originalPrincipalMinor must be a positive integer (received: ${input.originalPrincipalMinor})`
    );
  }

  // Validate civil due date format (YYYY-MM-DD)
  if (input.dueDate !== undefined && input.dueDate !== null) {
    if (!isValidCivilDate(input.dueDate)) {
      throw new Error(`dueDate must be a valid real calendar date in YYYY-MM-DD format (received: ${input.dueDate})`);
    }
  }

  const currency = input.currency || 'BDT';
  const openedAt = input.openedAt ?? now;
  const openedOn = input.openedOn ?? localCivilDateFromTimestamp(openedAt);
  assertCivilDate(openedOn, 'openedOn');
  const dueDate = input.dueDate ?? null;
  const note = input.note ? input.note.trim() : null;
  const debtId = generateDebtId();

  let linkedTransactionId: string | null = null;

  await runExclusiveTransaction(db, async (txn) => {
    // 1. If new_with_cash, validate account and create cash transaction
    if (input.openingMode === 'new_with_cash') {
      if (!input.accountId) {
        throw new Error('Account ID is required when opening a debt with cash movement.');
      }

      const acc = await txn.getFirstAsync<{ id: string; currency: string; archived_at: number | null }>(
        'SELECT id, currency, archived_at FROM accounts WHERE id = ?;',
        input.accountId
      );
      if (!acc) {
        throw new Error(`Account not found: ${input.accountId}`);
      }
      if (acc.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');
      if (acc.currency !== currency) {
        throw new Error(
          `Account currency (${acc.currency}) must match debt currency (${currency})`
        );
      }

      linkedTransactionId = generateTransactionId();

      // Determine category and transaction type
      // Borrowed with cash -> user received money (income, cat_inc_loan_received)
      // Lent with cash -> user gave money (expense, cat_exp_loan_given)
      const txType = input.direction === 'borrowed' ? 'income' : 'expense';
      const categoryId =
        input.direction === 'borrowed' ? 'cat_inc_loan_received' : 'cat_exp_loan_given';

      await txn.runAsync(
        `INSERT INTO transactions (
           id, account_id, category_id, amount, type, transfer_id, transfer_role,
           related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL);`,
        linkedTransactionId,
        input.accountId,
        categoryId,
        input.originalPrincipalMinor,
        txType,
        note,
        openedAt,
        openedOn,
        now,
        now
      );
    }

    // 2. Insert debt row
    await txn.runAsync(
      `INSERT INTO debts (
         id, counterparty_id, direction, original_principal, currency, opening_mode,
         opened_at, due_date, status, note, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL);`,
      debtId,
      input.counterpartyId,
      input.direction,
      input.originalPrincipalMinor,
      currency,
      input.openingMode,
      openedAt,
      dueDate,
      note,
      now,
      now
    );

    // 3. Insert initial disbursement record into debt_transactions ONLY for new_with_cash
    // For existing_balance agreements, the principal is held on debts.original_principal with zero cash movement
    if (input.openingMode === 'new_with_cash' && linkedTransactionId) {
      const dtxId = generateDebtTransactionId();
      await txn.runAsync(
        `INSERT INTO debt_transactions (
           id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, 'disbursement', ?, ?, ?, ?, NULL);`,
        dtxId,
        debtId,
        linkedTransactionId,
        input.originalPrincipalMinor,
        note,
        openedAt,
        now,
        now
      );
    }
  });

  const created = await getDebtById(debtId, db);
  if (!created) {
    throw new Error(`Failed to load created debt: ${debtId}`);
  }
  return created;
}

/**
 * Records a partial or full repayment for a debt.
 * Enforces:
 * - Overpayment rejection (amount <= outstanding) evaluated inside the exclusive transaction.
 * - Automatic settlement when outstanding reaches 0.
 * - Atomic cash transaction creation when accountId is provided.
 */
export async function recordRepayment(
  input: RecordRepaymentInput,
  customDb?: DatabaseConnection
): Promise<DebtTransactionRow> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`Repayment amount must be a positive integer (received: ${input.amountMinor})`);
  }

  const occurredAt = input.occurredAt ?? now;
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(occurredAt);
  assertCivilDate(occurredOn, 'occurredOn');
  const note = input.note ? input.note.trim() : null;
  const dtxId = generateDebtTransactionId();
  let linkedTxId: string | null = null;
  let debtId = input.debtId;

  await runExclusiveTransaction(db, async (txn) => {
    // 1. Re-query debt and current derived balance inside the exclusive transaction lock
    const debtRow = await txn.getFirstAsync<{
      id: string;
      status: string;
      original_principal: number;
      currency: string;
      direction: 'borrowed' | 'lent';
      archived_at: number | null;
      deleted_at: number | null;
      total_repaid: number;
    }>(
      `SELECT
         d.id,
         d.status,
         d.original_principal,
         d.currency,
         d.direction,
         d.archived_at,
         d.deleted_at,
         COALESCE(SUM(
           CASE
             WHEN dt.role = 'repayment' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_decrease' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_increase' AND dt.deleted_at IS NULL THEN -dt.amount
             ELSE 0
           END
         ), 0) AS total_repaid
       FROM debts d
       LEFT JOIN debt_transactions dt ON d.id = dt.debt_id
       WHERE d.id = ? AND d.deleted_at IS NULL
       GROUP BY d.id;`,
      input.debtId
    );

    if (!debtRow) {
      throw new Error(`Debt not found: ${input.debtId}`);
    }

    if (debtRow.archived_at !== null) {
      throw new Error('Cannot record repayment on an archived debt. Restore the debt from archive first.');
    }

    if (debtRow.status === 'settled') {
      throw new Error('Cannot record repayment on an already settled debt.');
    }

    const currentOutstanding = debtRow.original_principal - debtRow.total_repaid;

    if (input.amountMinor > currentOutstanding) {
      throw new Error(
        `Repayment amount (${input.amountMinor}) cannot exceed outstanding principal (${currentOutstanding}).`
      );
    }

    // 2. Validate account and create linked cash transaction (repayment requires transaction_id)
    if (!input.accountId) {
      throw new Error('Account ID is required to record a debt repayment transaction.');
    }

    const acc = await txn.getFirstAsync<{ id: string; currency: string; archived_at: number | null }>(
      'SELECT id, currency, archived_at FROM accounts WHERE id = ?;',
      input.accountId
    );
    if (!acc) {
      throw new Error(`Account not found: ${input.accountId}`);
    }
    if (acc.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');
    if (acc.currency !== debtRow.currency) {
      throw new Error(
        `Account currency (${acc.currency}) must match debt currency (${debtRow.currency})`
      );
    }

    linkedTxId = generateTransactionId();

    // Repayment direction:
    // Borrowed debt repayment -> user pays money out (expense, cat_exp_loan_repayment)
    // Lent debt repayment received -> user receives money in (income, cat_inc_loan_repayment_received)
    const txType = debtRow.direction === 'borrowed' ? 'expense' : 'income';
    const categoryId =
      debtRow.direction === 'borrowed'
        ? 'cat_exp_loan_repayment'
        : 'cat_inc_loan_repayment_received';

    await txn.runAsync(
      `INSERT INTO transactions (
         id, account_id, category_id, amount, type, transfer_id, transfer_role,
         related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL);`,
      linkedTxId,
      input.accountId,
      categoryId,
      input.amountMinor,
      txType,
      note,
      occurredAt,
      occurredOn,
      now,
      now
    );

    // 3. Insert debt_transaction entry
    await txn.runAsync(
      `INSERT INTO debt_transactions (
         id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'repayment', ?, ?, ?, ?, NULL);`,
      dtxId,
      debtRow.id,
      linkedTxId,
      input.amountMinor,
      note,
      occurredAt,
      now,
      now
    );

    // 4. Auto-settle if new outstanding reaches exactly zero
    const newOutstanding = currentOutstanding - input.amountMinor;
    if (newOutstanding === 0) {
      await txn.runAsync(
        "UPDATE debts SET status = 'settled', updated_at = ? WHERE id = ?;",
        now,
        debtRow.id
      );
    }
  });

  return {
    id: dtxId,
    debt_id: debtId,
    transaction_id: linkedTxId,
    amount: input.amountMinor,
    role: 'repayment',
    note,
    occurred_at: occurredAt,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Records a non-cash adjustment (waiver, forgiveness, agreed fee, correction) for a debt.
 * - adjustment_increase: increases balance owed (reopens settled debt to active).
 * - adjustment_decrease: decreases balance owed (enforces non-negative bounds, auto-settles if 0).
 */
export async function recordAdjustment(
  input: RecordAdjustmentInput,
  customDb?: DatabaseConnection
): Promise<DebtTransactionRow> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`Adjustment amount must be a positive integer (received: ${input.amountMinor})`);
  }

  const role: DebtTransactionRole =
    input.direction === 'increase' ? 'adjustment_increase' : 'adjustment_decrease';
  const occurredAt = input.occurredAt ?? now;
  const note = input.note ? input.note.trim() : null;
  const dtxId = generateDebtTransactionId();

  await runExclusiveTransaction(db, async (txn) => {
    const debtRow = await txn.getFirstAsync<{
      id: string;
      status: string;
      original_principal: number;
      archived_at: number | null;
      deleted_at: number | null;
      total_repaid: number;
    }>(
      `SELECT
         d.id,
         d.status,
         d.original_principal,
         d.archived_at,
         d.deleted_at,
         COALESCE(SUM(
           CASE
             WHEN dt.role = 'repayment' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_decrease' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_increase' AND dt.deleted_at IS NULL THEN -dt.amount
             ELSE 0
           END
         ), 0) AS total_repaid
       FROM debts d
       LEFT JOIN debt_transactions dt ON d.id = dt.debt_id
       WHERE d.id = ? AND d.deleted_at IS NULL
       GROUP BY d.id;`,
      input.debtId
    );

    if (!debtRow) {
      throw new Error(`Debt not found: ${input.debtId}`);
    }

    if (debtRow.archived_at !== null) {
      throw new Error('Cannot record adjustment on an archived debt. Restore the debt from archive first.');
    }

    const currentOutstanding = debtRow.original_principal - debtRow.total_repaid;

    if (input.direction === 'decrease') {
      if (input.amountMinor > currentOutstanding) {
        throw new Error(
          `Adjustment decrease (${input.amountMinor}) cannot exceed outstanding principal (${currentOutstanding}). Non-negative bounds enforced.`
        );
      }
    }

    // Insert debt_transaction
    await txn.runAsync(
      `INSERT INTO debt_transactions (
         id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL);`,
      dtxId,
      debtRow.id,
      input.amountMinor,
      role,
      note,
      occurredAt,
      now,
      now
    );

    const newOutstanding =
      input.direction === 'increase'
        ? currentOutstanding + input.amountMinor
        : currentOutstanding - input.amountMinor;

    if (newOutstanding === 0) {
      await txn.runAsync(
        "UPDATE debts SET status = 'settled', updated_at = ? WHERE id = ?;",
        now,
        debtRow.id
      );
    } else if (newOutstanding > 0 && debtRow.status === 'settled') {
      await txn.runAsync(
        "UPDATE debts SET status = 'active', updated_at = ? WHERE id = ?;",
        now,
        debtRow.id
      );
    }
  });

  return {
    id: dtxId,
    debt_id: input.debtId,
    transaction_id: null,
    amount: input.amountMinor,
    role,
    note,
    occurred_at: occurredAt,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Archives a debt independently from its active/settled lifecycle status.
 */
export async function archiveDebt(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();
  const res = await db.runAsync(
    'UPDATE debts SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL;',
    now,
    now,
    id
  );
  if (res.changes === 0) {
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM debts WHERE id = ?;', id);
    if (!existing) {
      throw new Error(`Debt not found: ${id}`);
    }
  }
}

/**
 * Restores an archived debt to active viewing.
 */
export async function restoreArchivedDebt(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();
  const res = await db.runAsync(
    'UPDATE debts SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL;',
    now,
    id
  );
  if (res.changes === 0) {
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM debts WHERE id = ?;', id);
    if (!existing) {
      throw new Error(`Debt not found: ${id}`);
    }
  }
}

/**
 * Soft-deletes a debt transaction (repayment or adjustment) and its linked cash transaction atomically.
 * Automatically reopens a settled debt if outstanding balance becomes > 0.
 */
export async function softDeleteRepayment(
  debtTransactionId: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  const dtx = await db.getFirstAsync<{
    id: string;
    debt_id: string;
    transaction_id: string | null;
    role: string;
  }>('SELECT id, debt_id, transaction_id, role FROM debt_transactions WHERE id = ?;', debtTransactionId);

  if (!dtx) {
    throw new Error(`Debt transaction not found: ${debtTransactionId}`);
  }

  await runExclusiveTransaction(db, async (txn) => {
    if (dtx.role === 'disbursement') {
      throw new Error(
        'Cannot delete a debt disbursement transaction directly. Use the debt cancellation operation instead.'
      );
    }

    // Check parent debt is not archived
    const parentDebt = await txn.getFirstAsync<{ id: string; archived_at: number | null }>(
      'SELECT id, archived_at FROM debts WHERE id = ?;',
      dtx.debt_id
    );
    if (!parentDebt) {
      throw new Error(`Debt not found: ${dtx.debt_id}`);
    }
    if (parentDebt.archived_at !== null) {
      throw new Error('Cannot delete transaction belonging to an archived debt. Restore the debt from archive first.');
    }

    // Soft delete debt transaction
    await txn.runAsync(
      'UPDATE debt_transactions SET deleted_at = ?, updated_at = ? WHERE id = ?;',
      now,
      now,
      debtTransactionId
    );

    // Soft delete linked cash transaction if present
    if (dtx.transaction_id) {
      await txn.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?;',
        now,
        now,
        dtx.transaction_id
      );
    }

    // Recheck debt status: if debt was settled, re-derive outstanding and reopen if > 0
    const debt = await getDebtById(dtx.debt_id, txn);
    if (debt && debt.status === 'settled' && debt.outstanding_principal > 0) {
      await txn.runAsync(
        "UPDATE debts SET status = 'active', updated_at = ? WHERE id = ?;",
        now,
        debt.id
      );
    }
  });
}

export const softDeleteDebtTransaction = softDeleteRepayment;

/**
 * Restores a soft-deleted repayment or adjustment and its linked cash transaction atomically.
 * Automatically settles debt if outstanding reaches 0, or reopens if adjustment_increase is restored.
 */
export async function restoreRepayment(
  debtTransactionId: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  const dtx = await db.getFirstAsync<{
    id: string;
    debt_id: string;
    transaction_id: string | null;
    role: string;
    amount: number;
    deleted_at: number | null;
  }>('SELECT id, debt_id, transaction_id, role, amount, deleted_at FROM debt_transactions WHERE id = ?;', debtTransactionId);

  if (!dtx || dtx.deleted_at === null) {
    throw new Error(`Deleted debt transaction not found: ${debtTransactionId}`);
  }

  if (dtx.role === 'disbursement') {
    throw new Error(
      'Cannot restore a debt disbursement transaction directly. Use the debt restoration operation instead.'
    );
  }

  await runExclusiveTransaction(db, async (txn) => {
    const debtRow = await txn.getFirstAsync<{
      id: string;
      status: string;
      original_principal: number;
      archived_at: number | null;
      deleted_at: number | null;
      total_repaid: number;
    }>(
      `SELECT
         d.id,
         d.status,
         d.original_principal,
         d.archived_at,
         d.deleted_at,
         COALESCE(SUM(
           CASE
             WHEN dt.role = 'repayment' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_decrease' AND dt.deleted_at IS NULL THEN dt.amount
             WHEN dt.role = 'adjustment_increase' AND dt.deleted_at IS NULL THEN -dt.amount
             ELSE 0
           END
         ), 0) AS total_repaid
       FROM debts d
       LEFT JOIN debt_transactions dt ON d.id = dt.debt_id
       WHERE d.id = ? AND d.deleted_at IS NULL
       GROUP BY d.id;`,
      dtx.debt_id
    );

    if (!debtRow || debtRow.deleted_at !== null) {
      throw new Error(`Debt not found: ${dtx.debt_id}`);
    }

    if (debtRow.archived_at !== null) {
      throw new Error('Cannot restore transaction on an archived debt. Restore the debt from archive first.');
    }

    const currentOutstanding = debtRow.original_principal - debtRow.total_repaid;

    // Bounds checking for repayment and adjustment_decrease
    if (dtx.role === 'repayment' || dtx.role === 'adjustment_decrease') {
      if (dtx.amount > currentOutstanding) {
        throw new Error(
          `Cannot restore ${dtx.role}: would exceed outstanding principal by ${dtx.amount - currentOutstanding} minor units.`
        );
      }
    }

    await txn.runAsync(
      'UPDATE debt_transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?;',
      now,
      debtTransactionId
    );

    if (dtx.transaction_id) {
      await txn.runAsync(
        'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL;',
        now,
        dtx.transaction_id
      );
    }

    const newOutstanding =
      dtx.role === 'adjustment_increase'
        ? currentOutstanding + dtx.amount
        : currentOutstanding - dtx.amount;

    if (newOutstanding === 0) {
      await txn.runAsync(
        "UPDATE debts SET status = 'settled', updated_at = ? WHERE id = ?;",
        now,
        debtRow.id
      );
    } else if (newOutstanding > 0 && debtRow.status === 'settled') {
      await txn.runAsync(
        "UPDATE debts SET status = 'active', updated_at = ? WHERE id = ?;",
        now,
        debtRow.id
      );
    }
  });
}

export const restoreDebtTransaction = restoreRepayment;

/**
 * Retrieves all debts matching the specified filters with derived balances.
 */
export async function getDebts(
  filters?: DebtFilters,
  customDb?: DatabaseConnection
): Promise<DebtWithDetails[]> {
  const db = customDb ?? (await getDatabase());

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!filters?.includeDeleted) {
    conditions.push('d.deleted_at IS NULL');
  }

  if (filters?.direction) {
    conditions.push('d.direction = ?');
    params.push(filters.direction);
  }

  if (filters?.status && filters.status !== 'all') {
    conditions.push('d.status = ?');
    params.push(filters.status);
  }

  if (filters?.counterpartyId) {
    conditions.push('d.counterparty_id = ?');
    params.push(filters.counterpartyId);
  }

  if (filters?.currency) {
    conditions.push('d.currency = ?');
    params.push(filters.currency);
  }

  if (filters?.isArchived !== undefined) {
    if (filters.isArchived) {
      conditions.push('d.archived_at IS NOT NULL');
    } else {
      conditions.push('d.archived_at IS NULL');
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      d.id,
      d.counterparty_id,
      d.direction,
      d.original_principal,
      d.currency,
      d.opening_mode,
      d.opened_at,
      d.due_date,
      d.status,
      d.note,
      d.created_at,
      d.updated_at,
      d.archived_at,
      d.deleted_at,
      cp.name AS counterparty_name,
      cp.type AS counterparty_type,
      COALESCE(SUM(
        CASE
          WHEN dt.role = 'repayment' AND dt.deleted_at IS NULL THEN dt.amount
          WHEN dt.role = 'adjustment_decrease' AND dt.deleted_at IS NULL THEN dt.amount
          WHEN dt.role = 'adjustment_increase' AND dt.deleted_at IS NULL THEN -dt.amount
          ELSE 0
        END
      ), 0) AS total_repaid,
      init_tx.account_id AS linked_account_id,
      acc.name AS linked_account_name
    FROM debts d
    INNER JOIN counterparties cp ON d.counterparty_id = cp.id
    LEFT JOIN debt_transactions dt ON d.id = dt.debt_id
    LEFT JOIN debt_transactions init_dt ON d.id = init_dt.debt_id AND init_dt.role = 'disbursement' AND init_dt.deleted_at IS NULL
    LEFT JOIN transactions init_tx ON init_dt.transaction_id = init_tx.id
    LEFT JOIN accounts acc ON init_tx.account_id = acc.id
    ${whereClause}
    GROUP BY d.id
    ORDER BY d.opened_at DESC, d.created_at DESC;
  `;

  const rows = await db.getAllAsync<any>(query, ...params);

  return rows.map((r) => {
    const original = Number(r.original_principal);
    const repaid = Number(r.total_repaid);
    // Never conceal negative balances with Math.max(0, ...)
    const outstanding = original - repaid;
    if (outstanding < 0 && __DEV__) {
      console.warn(`[Barakah Integrity Warning] Debt ${r.id} has negative outstanding balance: ${outstanding}`);
    }

    const dueDateStr = r.due_date ? String(r.due_date) : null;
    const archivedAt = r.archived_at ? Number(r.archived_at) : null;
    const dueState = calculateDueState(r.status, dueDateStr, outstanding, Date.now(), archivedAt);

    return {
      id: r.id,
      counterparty_id: r.counterparty_id,
      direction: r.direction,
      original_principal: original,
      currency: r.currency,
      opening_mode: r.opening_mode,
      opened_at: Number(r.opened_at),
      due_date: dueDateStr,
      status: r.status,
      note: r.note,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      archived_at: archivedAt,
      deleted_at: r.deleted_at ? Number(r.deleted_at) : null,
      counterparty_name: r.counterparty_name,
      counterparty_type: r.counterparty_type,
      total_repaid: repaid,
      outstanding_principal: outstanding,
      due_state: dueState,
      linked_account_id: r.linked_account_id ?? null,
      linked_account_name: r.linked_account_name ?? null,
    };
  });
}

/**
 * Retrieves a single debt by ID with full derived details.
 */
export async function getDebtById(
  id: string,
  customDb?: DatabaseConnection
): Promise<DebtWithDetails | null> {
  const debts = await getDebts({ includeDeleted: true }, customDb);
  return debts.find((d) => d.id === id) ?? null;
}

/**
 * Updates a debt's due date, note, or counterparty.
 */
export async function updateDebt(
  id: string,
  input: UpdateDebtInput,
  customDb?: DatabaseConnection
): Promise<DebtWithDetails> {
  const db = customDb ?? (await getDatabase());
  const existing = await getDebtById(id, db);

  if (!existing || existing.deleted_at !== null) {
    throw new Error(`Debt not found: ${id}`);
  }

  if (existing.archived_at !== null) {
    throw new Error('Cannot edit an archived debt. Restore the debt from archive first.');
  }

  // Validate civil due date format (YYYY-MM-DD) if provided
  if (input.dueDate !== undefined && input.dueDate !== null) {
    if (!isValidCivilDate(input.dueDate)) {
      throw new Error(`dueDate must be a valid real calendar date in YYYY-MM-DD format (received: ${input.dueDate})`);
    }
  }

  const now = Date.now();
  const dueDate = input.dueDate !== undefined ? input.dueDate : existing.due_date;
  const note = input.note !== undefined ? (input.note ? input.note.trim() : null) : existing.note;
  const counterpartyId = input.counterpartyId !== undefined ? input.counterpartyId : existing.counterparty_id;

  await db.runAsync(
    `UPDATE debts
     SET due_date = ?, note = ?, counterparty_id = ?, updated_at = ?
     WHERE id = ?;`,
    dueDate,
    note,
    counterpartyId,
    now,
    id
  );

  const updated = await getDebtById(id, db);
  if (!updated) {
    throw new Error(`Failed to retrieve updated debt: ${id}`);
  }
  return updated;
}

/**
 * Dedicated cancellation operation for a newly entered debt agreement.
 * Strictly enforces:
 * - Debt cannot be archived.
 * - Debt cannot have any repayment history or adjustments.
 * - Atomically soft-deletes the debt, disbursement link, and linked cash transaction.
 * - Entire operation is atomic and rolled back on any error.
 */
export async function cancelDebt(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  await runExclusiveTransaction(db, async (txn) => {
    const debt = await txn.getFirstAsync<{
      id: string;
      opening_mode: DebtOpeningMode;
      archived_at: number | null;
      deleted_at: number | null;
    }>(
      'SELECT id, opening_mode, archived_at, deleted_at FROM debts WHERE id = ?;',
      id
    );

    if (!debt || debt.deleted_at !== null) {
      throw new Error(`Debt not found: ${id}`);
    }

    if (debt.archived_at !== null) {
      throw new Error('Cannot cancel an archived debt. Restore the debt from archive first.');
    }

    const txCounts = await txn.getFirstAsync<{ repayments: number; adjustments: number }>(
      `SELECT
         COUNT(CASE WHEN role = 'repayment' AND deleted_at IS NULL THEN 1 END) AS repayments,
         COUNT(CASE WHEN role IN ('adjustment_increase', 'adjustment_decrease') AND deleted_at IS NULL THEN 1 END) AS adjustments
       FROM debt_transactions
       WHERE debt_id = ?;`,
      id
    );

    if ((txCounts?.repayments ?? 0) > 0) {
      throw new Error('Cannot cancel a debt that has repayments.');
    }

    if ((txCounts?.adjustments ?? 0) > 0) {
      throw new Error('Cannot cancel a debt that has adjustments.');
    }

    // 1. Soft-delete the debt record
    await txn.runAsync(
      'UPDATE debts SET deleted_at = ?, updated_at = ? WHERE id = ?;',
      now,
      now,
      id
    );

    // 2. If new_with_cash, atomically soft-delete disbursement and linked cash transaction
    if (debt.opening_mode === 'new_with_cash') {
      const disbursements = await txn.getAllAsync<{ id: string; transaction_id: string | null }>(
        "SELECT id, transaction_id FROM debt_transactions WHERE debt_id = ? AND role = 'disbursement' AND deleted_at IS NULL;",
        id
      );

      for (const dtx of disbursements) {
        await txn.runAsync(
          'UPDATE debt_transactions SET deleted_at = ?, updated_at = ? WHERE id = ?;',
          now,
          now,
          dtx.id
        );

        if (dtx.transaction_id) {
          await txn.runAsync(
            'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
            now,
            now,
            dtx.transaction_id
          );
        }
      }
    }
  });
}

/**
 * Restores a cancelled debt agreement, its disbursement link, and cash transaction atomically.
 */
export async function restoreCancelledDebt(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  await runExclusiveTransaction(db, async (txn) => {
    const debt = await txn.getFirstAsync<{
      id: string;
      opening_mode: DebtOpeningMode;
      deleted_at: number | null;
    }>(
      'SELECT id, opening_mode, deleted_at FROM debts WHERE id = ?;',
      id
    );

    if (!debt || debt.deleted_at === null) {
      throw new Error(`Cancelled debt not found or not deleted: ${id}`);
    }

    // 1. Restore the debt record
    await txn.runAsync(
      'UPDATE debts SET deleted_at = NULL, updated_at = ? WHERE id = ?;',
      now,
      id
    );

    // 2. If new_with_cash, restore disbursement and linked cash transaction
    if (debt.opening_mode === 'new_with_cash') {
      const disbursements = await txn.getAllAsync<{ id: string; transaction_id: string | null }>(
        "SELECT id, transaction_id FROM debt_transactions WHERE debt_id = ? AND role = 'disbursement' AND deleted_at IS NOT NULL;",
        id
      );

      for (const dtx of disbursements) {
        await txn.runAsync(
          'UPDATE debt_transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?;',
          now,
          dtx.id
        );

        if (dtx.transaction_id) {
          await txn.runAsync(
            'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL;',
            now,
            dtx.transaction_id
          );
        }
      }
    }
  });
}

export const softDeleteDebt = cancelDebt;

/**
 * Retrieves the full repayment and disbursement timeline for a debt.
 */
export async function getDebtTimeline(
  debtId: string,
  customDb?: DatabaseConnection
): Promise<DebtTransactionWithDetails[]> {
  const db = customDb ?? (await getDatabase());

  const query = `
    SELECT
      dt.id,
      dt.debt_id,
      dt.transaction_id,
      dt.amount,
      dt.role,
      dt.note,
      dt.occurred_at,
      dt.created_at,
      dt.updated_at,
      dt.deleted_at,
      t.account_id,
      acc.name AS account_name,
      acc.currency AS account_currency
    FROM debt_transactions dt
    LEFT JOIN transactions t ON dt.transaction_id = t.id
    LEFT JOIN accounts acc ON t.account_id = acc.id
    WHERE dt.debt_id = ? AND dt.deleted_at IS NULL
    ORDER BY dt.occurred_at DESC, dt.created_at DESC;
  `;

  const rows = await db.getAllAsync<any>(query, debtId);

  return rows.map((r) => ({
    id: r.id,
    debt_id: r.debt_id,
    transaction_id: r.transaction_id,
    amount: Number(r.amount),
    role: r.role,
    note: r.note,
    occurred_at: Number(r.occurred_at),
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
    deleted_at: r.deleted_at ? Number(r.deleted_at) : null,
    account_id: r.account_id ?? null,
    account_name: r.account_name ?? null,
    account_currency: r.account_currency ?? null,
  }));
}

/**
 * Retrieves aggregate debt totals grouped strictly by currency.
 * Zero cross-currency summation.
 */
export async function getDebtSummary(
  customDb?: DatabaseConnection
): Promise<DebtSummary> {
  const debts = await getDebts({ status: 'active', isArchived: false }, customDb);
  const totalBorrowedByCurrency: Record<string, number> = {};
  const totalLentByCurrency: Record<string, number> = {};

  for (const d of debts) {
    if (d.outstanding_principal <= 0) continue;
    const curr = d.currency || 'BDT';
    if (d.direction === 'borrowed') {
      totalBorrowedByCurrency[curr] = (totalBorrowedByCurrency[curr] || 0) + d.outstanding_principal;
    } else {
      totalLentByCurrency[curr] = (totalLentByCurrency[curr] || 0) + d.outstanding_principal;
    }
  }

  return {
    totalBorrowedByCurrency,
    totalLentByCurrency,
  };
}
