/**
 * Barakah Transactions Repository & Paired Transfer Ledger
 * Strict adherence to:
 * - Local-first architecture (ADR-001)
 * - ADR-004: Pure integer minor units (never floating-point, amount > 0)
 * - ADR-005: Balances derived from ledger entries, no mutable balance column
 * - Dual-entry account transfer: atomic paired rows linked by shared transfer_id
 * - Currency compatibility enforcement (no silent conversions)
 * - Exclusive transactions for transfers, soft-delete, and restoration
 */

import { getDatabase, runExclusiveTransaction } from './client';
import { getAccountById } from './accounts';
import { getCategoryById } from './categories';
import { assertCivilDate, localCivilDateFromTimestamp } from '../domain/civil-date';
import {
  CreateTransactionInput,
  CreateTransferInput,
  DatabaseConnection,
  TransactionFilters,
  TransactionRow,
  TransactionWithDetails,
  SavingsGoalEntryRow,
  SavingsGoalRow,
} from './types';
import { deriveGoalProgress } from '../domain/savings-goal';

function generateTxId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `tx_${prefix}_${ts}_${rand}`;
}

function generateTransferId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `tr_${ts}_${rand}`;
}

export async function createTransferInTransaction(
  input: CreateTransferInput,
  db: DatabaseConnection
): Promise<{ sourceTransaction: TransactionRow; destinationTransaction: TransactionRow; transferId: string }> {
  if (input.sourceAccountId === input.destinationAccountId) throw new Error('Source and destination accounts must be different for a transfer.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Transfer amount must be a positive safe integer.');
  const source = await getAccountById(input.sourceAccountId, db);
  const destination = await getAccountById(input.destinationAccountId, db);
  if (!source || !destination) throw new Error('Transfer account not found.');
  if (source.archived_at !== null || destination.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');
  if (source.currency !== destination.currency) throw new Error('Cross-currency transfers are not supported.');
  const transferId = generateTransferId();
  const sourceId = generateTxId('tr_src');
  const destinationId = generateTxId('tr_dst');
  const now = Date.now();
  const timestamp = input.occurredAt ?? input.timestamp ?? now;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('TRANSACTION_ERR_UNSAFE_TIMESTAMP');
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(timestamp);
  assertCivilDate(occurredOn, 'occurredOn');
  const note = input.note?.trim() || null;
  await db.runAsync(
    `INSERT INTO transactions (id,account_id,category_id,amount,type,transfer_id,transfer_role,related_account_id,note,timestamp,occurred_on,created_at,updated_at,deleted_at)
     VALUES (?,?,NULL,?,'transfer',?,'source',?,?,?,?,?,?,NULL);`,
    sourceId, input.sourceAccountId, input.amountMinor, transferId, input.destinationAccountId,
    note, timestamp, occurredOn, now, now
  );
  await db.runAsync(
    `INSERT INTO transactions (id,account_id,category_id,amount,type,transfer_id,transfer_role,related_account_id,note,timestamp,occurred_on,created_at,updated_at,deleted_at)
     VALUES (?,?,NULL,?,'transfer',?,'destination',?,?,?,?,?,?,NULL);`,
    destinationId, input.destinationAccountId, input.amountMinor, transferId, input.sourceAccountId,
    note, timestamp, occurredOn, now, now
  );
  return {
    transferId,
    sourceTransaction: { id: sourceId, account_id: input.sourceAccountId, category_id: null, amount: input.amountMinor, type: 'transfer', transfer_id: transferId, transfer_role: 'source', related_account_id: input.destinationAccountId, note, timestamp, occurred_on: occurredOn, created_at: now, updated_at: now, deleted_at: null },
    destinationTransaction: { id: destinationId, account_id: input.destinationAccountId, category_id: null, amount: input.amountMinor, type: 'transfer', transfer_id: transferId, transfer_role: 'destination', related_account_id: input.sourceAccountId, note, timestamp, occurred_on: occurredOn, created_at: now, updated_at: now, deleted_at: null },
  };
}

/**
 * Creates an income transaction.
 */
export async function createIncomeTransaction(
  input: CreateTransactionInput,
  customDb?: DatabaseConnection
): Promise<TransactionRow> {
  const db = customDb ?? (await getDatabase());

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transaction amount must be a positive safe integer in minor units. Received: ${input.amountMinor}`);
  }

  const account = await getAccountById(input.accountId, db);
  if (!account) {
    throw new Error(`Account not found: ${input.accountId}`);
  }
  if (account.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');

  const category = await getCategoryById(input.categoryId, db);
  if (!category) {
    throw new Error(`Category not found: ${input.categoryId}`);
  }
  if (category.type !== 'income') {
    throw new Error(`Category ${input.categoryId} is not an income category`);
  }
  if (category.is_archived === 1) {
    throw new Error(`Cannot assign archived category '${category.name_key}' to new transactions`);
  }

  const id = generateTxId('inc');
  const now = Date.now();
  const timestamp = input.occurredAt ?? input.timestamp ?? now;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('TRANSACTION_ERR_UNSAFE_TIMESTAMP');
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(timestamp);
  assertCivilDate(occurredOn, 'occurredOn');
  const note = input.note?.trim() || null;

  await db.runAsync(
    `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'income', NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL);`,
    id,
    input.accountId,
    input.categoryId,
    input.amountMinor,
    note,
    timestamp,
    occurredOn,
    now,
    now
  );

  return {
    id,
    account_id: input.accountId,
    category_id: input.categoryId,
    amount: input.amountMinor,
    type: 'income',
    transfer_id: null,
    transfer_role: null,
    related_account_id: null,
    note,
    timestamp,
    occurred_on: occurredOn,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Creates an expense transaction.
 */
export async function createExpenseTransaction(
  input: CreateTransactionInput,
  customDb?: DatabaseConnection
): Promise<TransactionRow> {
  const db = customDb ?? (await getDatabase());

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transaction amount must be a positive safe integer in minor units. Received: ${input.amountMinor}`);
  }

  const account = await getAccountById(input.accountId, db);
  if (!account) {
    throw new Error(`Account not found: ${input.accountId}`);
  }
  if (account.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');

  const category = await getCategoryById(input.categoryId, db);
  if (!category) {
    throw new Error(`Category not found: ${input.categoryId}`);
  }
  if (category.type !== 'expense') {
    throw new Error(`Category ${input.categoryId} is not an expense category`);
  }
  if (category.is_archived === 1) {
    throw new Error(`Cannot assign archived category '${category.name_key}' to new transactions`);
  }

  const id = generateTxId('exp');
  const now = Date.now();
  const timestamp = input.occurredAt ?? input.timestamp ?? now;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('TRANSACTION_ERR_UNSAFE_TIMESTAMP');
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(timestamp);
  assertCivilDate(occurredOn, 'occurredOn');
  const note = input.note?.trim() || null;

  await db.runAsync(
    `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'expense', NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL);`,
    id,
    input.accountId,
    input.categoryId,
    input.amountMinor,
    note,
    timestamp,
    occurredOn,
    now,
    now
  );

  return {
    id,
    account_id: input.accountId,
    category_id: input.categoryId,
    amount: input.amountMinor,
    type: 'expense',
    transfer_id: null,
    transfer_role: null,
    related_account_id: null,
    note,
    timestamp,
    occurred_on: occurredOn,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Creates a paired transfer between two accounts within an exclusive transaction.
 * Strictly adheres to:
 * - Dual-entry paired transfer ledger (Milestone 2)
 * - Source leg: positive integer minor units, transfer_role = 'source'
 * - Destination leg: positive integer minor units, transfer_role = 'destination'
 * - Single transfer_id linking both entries
 * - Zero sign inversion on storage (sign derived in query)
 * - Strict same-currency requirement
 */
export async function createTransfer(
  input: CreateTransferInput,
  customDb?: DatabaseConnection
): Promise<{
  sourceTransaction: TransactionRow;
  destinationTransaction: TransactionRow;
  transferId: string;
}> {
  const db = customDb ?? (await getDatabase());

  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error('Source and destination accounts must be different for a transfer.');
  }

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transfer amount must be a positive safe integer in minor units. Received: ${input.amountMinor}`);
  }

  const sourceAccount = await getAccountById(input.sourceAccountId, db);
  if (!sourceAccount) {
    throw new Error(`Source account not found: ${input.sourceAccountId}`);
  }
  if (sourceAccount.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');

  const destinationAccount = await getAccountById(input.destinationAccountId, db);
  if (!destinationAccount) {
    throw new Error(`Destination account not found: ${input.destinationAccountId}`);
  }
  if (destinationAccount.archived_at !== null) throw new Error('ACCOUNT_ERR_ARCHIVED');

  // Enforce currency compatibility (Milestone 2, Correction 5)
  if (sourceAccount.currency !== destinationAccount.currency) {
    throw new Error(
      `Cross-currency transfers are not supported. Source currency is '${sourceAccount.currency}', destination currency is '${destinationAccount.currency}'.`
    );
  }

  const transferId = generateTransferId();
  const sourceTxId = generateTxId('tr_src');
  const destTxId = generateTxId('tr_dst');
  const now = Date.now();
  const timestamp = input.occurredAt ?? input.timestamp ?? now;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('TRANSACTION_ERR_UNSAFE_TIMESTAMP');
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(timestamp);
  assertCivilDate(occurredOn, 'occurredOn');
  const note = input.note?.trim() || null;

  await runExclusiveTransaction(db, async (txn) => {
    // 1. Insert source debit entry
    await txn.runAsync(
      `INSERT INTO transactions (
         id, account_id, category_id, amount, type, transfer_id, transfer_role,
         related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, 'transfer', ?, 'source', ?, ?, ?, ?, ?, ?, NULL);`,
      sourceTxId,
      input.sourceAccountId,
      input.amountMinor,
      transferId,
      input.destinationAccountId,
      note,
      timestamp,
      occurredOn,
      now,
      now
    );

    // 2. Insert destination credit entry
    await txn.runAsync(
      `INSERT INTO transactions (
         id, account_id, category_id, amount, type, transfer_id, transfer_role,
         related_account_id, note, timestamp, occurred_on, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, 'transfer', ?, 'destination', ?, ?, ?, ?, ?, ?, NULL);`,
      destTxId,
      input.destinationAccountId,
      input.amountMinor,
      transferId,
      input.sourceAccountId,
      note,
      timestamp,
      occurredOn,
      now,
      now
    );
  });

  const sourceTransaction: TransactionRow = {
    id: sourceTxId,
    account_id: input.sourceAccountId,
    category_id: null,
    amount: input.amountMinor,
    type: 'transfer',
    transfer_id: transferId,
    transfer_role: 'source',
    related_account_id: input.destinationAccountId,
    note,
    timestamp,
    occurred_on: occurredOn,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  const destinationTransaction: TransactionRow = {
    id: destTxId,
    account_id: input.destinationAccountId,
    category_id: null,
    amount: input.amountMinor,
    type: 'transfer',
    transfer_id: transferId,
    transfer_role: 'destination',
    related_account_id: input.sourceAccountId,
    note,
    timestamp,
    occurred_on: occurredOn,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  return {
    transferId,
    sourceTransaction,
    destinationTransaction,
  };
}

/**
 * Retrieves transactions with joined account, category, and related account details.
 */
export async function getTransactions(
  filters?: TransactionFilters,
  customDb?: DatabaseConnection
): Promise<TransactionWithDetails[]> {
  const db = customDb ?? (await getDatabase());

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!filters?.includeDeleted) {
    conditions.push('t.deleted_at IS NULL');
  }

  if (filters?.accountId) {
    conditions.push('t.account_id = ?');
    params.push(filters.accountId);
  }

  if (filters?.categoryId) {
    conditions.push('t.category_id = ?');
    params.push(filters.categoryId);
  }

  if (filters?.type) {
    conditions.push('t.type = ?');
    params.push(filters.type);
  }

  if (filters?.startDate !== undefined) {
    conditions.push('t.timestamp >= ?');
    params.push(filters.startDate);
  }

  if (filters?.endDate !== undefined) {
    conditions.push('t.timestamp <= ?');
    params.push(filters.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = filters?.limit ? `LIMIT ${filters.limit}` : '';
  const offsetClause = filters?.offset ? `OFFSET ${filters.offset}` : '';

  const sql = `
    SELECT
      t.id,
      t.account_id,
      t.category_id,
      t.amount,
      t.type,
      t.transfer_id,
      t.transfer_role,
      t.related_account_id,
      t.note,
      t.timestamp,
      t.occurred_on,
      t.created_at,
      t.updated_at,
      t.deleted_at,
      a.name AS account_name,
      a.currency AS account_currency,
      a.type AS account_type,
      c.name_key AS category_name_key,
      c.name_custom AS category_name_custom,
      c.icon AS category_icon,
      c.color AS category_color,
      rel.name AS related_account_name,
      rel.currency AS related_account_currency
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts rel ON t.related_account_id = rel.id
    ${whereClause}
    ORDER BY t.timestamp DESC, t.created_at DESC
    ${limitClause} ${offsetClause};
  `;

  const rawList = await db.getAllAsync<TransactionWithDetails>(sql, ...params);

  // If groupByTransfer is requested (or default for global list when accountId is not provided)
  const shouldGroupTransfers = filters?.groupByTransfer ?? (!filters?.accountId);

  if (!shouldGroupTransfers) {
    return rawList;
  }

  // Group transfer rows by transfer_id to present one logical transaction on the global feed
  const result: TransactionWithDetails[] = [];
  const processedTransferIds = new Set<string>();

  for (const item of rawList) {
    if (item.type !== 'transfer' || !item.transfer_id) {
      result.push(item);
      continue;
    }

    if (processedTransferIds.has(item.transfer_id)) {
      continue;
    }

    processedTransferIds.add(item.transfer_id);

    // Find all rows in rawList with this transfer_id
    const pairRows = rawList.filter((r) => r.transfer_id === item.transfer_id);

    if (pairRows.length === 1) {
      // Incomplete transfer pair found
      if (__DEV__) {
        console.error(
          `[Barakah Database Integrity Error] Incomplete transfer pair detected for transfer_id: ${item.transfer_id}. Only row ${item.id} exists.`
        );
      }
      // Never silently drop corrupted or unmatched transfer rows
      result.push(item);
      continue;
    }

    const sourceRow = pairRows.find((r) => r.transfer_role === 'source') ?? pairRows[0];
    const destRow = pairRows.find((r) => r.transfer_role === 'destination') ?? pairRows[1];

    result.push({
      ...sourceRow,
      source_account_name: sourceRow.account_name,
      destination_account_name: destRow.account_name,
      related_account_name: destRow.account_name,
    });
  }

  return result;
}

/**
 * Retrieves a single transaction with joined details by ID.
 */
export async function getTransactionById(
  id: string,
  customDb?: DatabaseConnection
): Promise<TransactionWithDetails | null> {
  const db = customDb ?? (await getDatabase());

  const sql = `
    SELECT
      t.id,
      t.account_id,
      t.category_id,
      t.amount,
      t.type,
      t.transfer_id,
      t.transfer_role,
      t.related_account_id,
      t.note,
      t.timestamp,
      t.occurred_on,
      t.created_at,
      t.updated_at,
      t.deleted_at,
      a.name AS account_name,
      a.currency AS account_currency,
      a.type AS account_type,
      c.name_key AS category_name_key,
      c.name_custom AS category_name_custom,
      c.icon AS category_icon,
      c.color AS category_color,
      rel.name AS related_account_name,
      rel.currency AS related_account_currency
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts rel ON t.related_account_id = rel.id
    WHERE t.id = ?;
  `;

  return await db.getFirstAsync<TransactionWithDetails>(sql, id);
}

/**
 * Soft deletes a transaction.
 * If the transaction is part of a transfer, BOTH paired entries are soft deleted atomically.
 */
export async function softDeleteTransaction(
  id: string,
  customDb?: DatabaseConnection,
  options: { confirmExistingGoalLink?: boolean } = {}
): Promise<boolean> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  const existing = await db.getFirstAsync<{ id: string; transfer_id: string | null }>(
    'SELECT id, transfer_id FROM transactions WHERE id = ?;',
    id
  );
  if (!existing) {
    return false;
  }

  let changes = 0;
  await runExclusiveTransaction(db, async (txn) => {
    const goalEntry = await txn.getFirstAsync<SavingsGoalEntryRow>(
      `SELECT e.* FROM savings_goal_entries e
       JOIN transactions linked ON linked.id=e.transaction_id
       WHERE e.deleted_at IS NULL AND (linked.id=? OR linked.transfer_id=?) LIMIT 1;`,
      id, existing.transfer_id
    );
    if (goalEntry?.link_mode === 'existing_transfer' && !options.confirmExistingGoalLink) {
      throw new Error('GOAL_ERR_LINKED_TRANSFER_CONFIRMATION_REQUIRED');
    }
    if (goalEntry) {
      await txn.runAsync(
        'UPDATE savings_goal_entries SET deleted_at=?,cascade_deleted_at=?,updated_at=? WHERE id=?;',
        now, now, now, goalEntry.id
      );
    }
    // Check if linked to a debt_transaction
    const dtx = await txn.getFirstAsync<{
      id: string;
      debt_id: string;
      role: string;
      amount: number;
      deleted_at: number | null;
    }>(
      'SELECT id, debt_id, role, amount, deleted_at FROM debt_transactions WHERE transaction_id = ?;',
      id
    );

    if (dtx) {
      if (dtx.role === 'disbursement') {
        throw new Error(
          'Cannot delete a debt disbursement transaction directly from transactions. Use the debt cancellation operation if the debt has no repayments.'
        );
      } else if (dtx.role === 'repayment') {
        if (dtx.deleted_at === null) {
          // Check if parent debt is archived
          const parentDebt = await txn.getFirstAsync<{ id: string; archived_at: number | null }>(
            'SELECT id, archived_at FROM debts WHERE id = ?;',
            dtx.debt_id
          );
          if (parentDebt && parentDebt.archived_at !== null) {
            throw new Error('Cannot delete repayment belonging to an archived debt. Restore the debt from archive first.');
          }

          // Soft-delete linked debt transaction
          await txn.runAsync(
            'UPDATE debt_transactions SET deleted_at = ?, updated_at = ? WHERE id = ?;',
            now,
            now,
            dtx.id
          );

          // Recalibrate parent debt outstanding balance and reopen if settled
          const debtRow = await txn.getFirstAsync<{
            status: string;
            original_principal: number;
            total_repaid: number;
          }>(
            `SELECT
               d.status,
               d.original_principal,
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
             WHERE d.id = ?
             GROUP BY d.id;`,
            dtx.debt_id
          );

          if (debtRow && debtRow.status === 'settled') {
            const outstanding = debtRow.original_principal - debtRow.total_repaid;
            if (outstanding > 0) {
              await txn.runAsync(
                "UPDATE debts SET status = 'active', updated_at = ? WHERE id = ?;",
                now,
                dtx.debt_id
              );
            }
          }
        }
      }
    }

    if (existing.transfer_id) {
      // Soft-delete BOTH legs of the transfer atomically (ADR-005)
      const res = await txn.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE transfer_id = ? AND deleted_at IS NULL;',
        now,
        now,
        existing.transfer_id
      );
      changes = res.changes;
    } else {
      const res = await txn.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
        now,
        now,
        id
      );
      changes = res.changes;
    }
    if (goalEntry) {
      const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=?;', goalEntry.goal_id);
      if (goal) {
        const entries = await txn.getAllAsync<SavingsGoalEntryRow>('SELECT * FROM savings_goal_entries WHERE goal_id=? AND deleted_at IS NULL ORDER BY occurred_at,created_at,id;', goal.id);
        const progress = deriveGoalProgress(entries, goal.target_amount);
        await txn.runAsync(
          `UPDATE savings_goals SET lifecycle_status=?,completed_at=?,updated_at=? WHERE id=?;`,
          progress.lifecycleStatus, progress.lifecycleStatus === 'completed' ? now : null, now, goal.id
        );
      }
    }
  });

  return changes > 0;
}

/**
 * Restores a soft-deleted transaction by ID.
 * - If part of a transfer pair, restores both legs atomically.
 * - If role === 'disbursement', throws an error blocking direct restoration.
 * - If role === 'repayment', verifies restoring does not exceed outstanding balance,
 *   restores the debt_transaction, and auto-settles the parent debt if outstanding reaches 0.
 */
export async function restoreTransaction(
  id: string,
  customDb?: DatabaseConnection
): Promise<boolean> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  const existing = await db.getFirstAsync<{ id: string; transfer_id: string | null }>(
    'SELECT id, transfer_id FROM transactions WHERE id = ?;',
    id
  );
  if (!existing) {
    return false;
  }

  let changes = 0;
  await runExclusiveTransaction(db, async (txn) => {
    const cascadedGoalEntry = await txn.getFirstAsync<SavingsGoalEntryRow>(
      `SELECT e.* FROM savings_goal_entries e
       JOIN transactions linked ON linked.id=e.transaction_id
       WHERE e.deleted_at IS NOT NULL AND e.cascade_deleted_at IS NOT NULL
         AND (linked.id=? OR linked.transfer_id=?) LIMIT 1;`,
      id, existing.transfer_id
    );
    const linkedGoal = cascadedGoalEntry
      ? await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', cascadedGoalEntry.goal_id)
      : null;
    if (cascadedGoalEntry && (!linkedGoal || linkedGoal.archived_at !== null)) throw new Error('GOAL_ERR_UNAVAILABLE');
    // Check if linked to a debt_transaction
    const dtx = await txn.getFirstAsync<{
      id: string;
      debt_id: string;
      role: string;
      amount: number;
      deleted_at: number | null;
    }>(
      'SELECT id, debt_id, role, amount, deleted_at FROM debt_transactions WHERE transaction_id = ?;',
      id
    );

    if (dtx) {
      if (dtx.role === 'disbursement') {
        throw new Error(
          'Cannot restore a debt disbursement transaction directly from transactions. Use the debt restoration operation.'
        );
      } else if (dtx.role === 'repayment') {
        if (dtx.deleted_at !== null) {
          // Check if parent debt is archived
          const parentDebt = await txn.getFirstAsync<{ id: string; archived_at: number | null }>(
            'SELECT id, archived_at FROM debts WHERE id = ?;',
            dtx.debt_id
          );
          if (parentDebt && parentDebt.archived_at !== null) {
            throw new Error('Cannot restore repayment belonging to an archived debt. Restore the debt from archive first.');
          }
          // Check if restoring this repayment would exceed outstanding principal
          const debtRow = await txn.getFirstAsync<{
            status: string;
            original_principal: number;
            total_repaid: number;
          }>(
            `SELECT
               d.status,
               d.original_principal,
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
             WHERE d.id = ?
             GROUP BY d.id;`,
            dtx.debt_id
          );

          if (debtRow) {
            const newOutstanding = debtRow.original_principal - (debtRow.total_repaid + dtx.amount);
            if (newOutstanding < 0) {
              throw new Error(
                `Cannot restore repayment: would exceed outstanding principal by ${Math.abs(newOutstanding)} minor units.`
              );
            }

            // Restore linked debt transaction
            await txn.runAsync(
              'UPDATE debt_transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?;',
              now,
              dtx.id
            );

            if (newOutstanding === 0) {
              await txn.runAsync(
                "UPDATE debts SET status = 'settled', updated_at = ? WHERE id = ?;",
                now,
                dtx.debt_id
              );
            }
          }
        }
      }
    }

    if (existing.transfer_id) {
      const res = await txn.runAsync(
        'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE transfer_id = ? AND deleted_at IS NOT NULL;',
        now,
        existing.transfer_id
      );
      changes = res.changes;
    } else {
      const res = await txn.runAsync(
        'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL;',
        now,
        id
      );
      changes = res.changes;
    }
    if (cascadedGoalEntry && linkedGoal) {
      const currentEntries = await txn.getAllAsync<SavingsGoalEntryRow>(
        'SELECT * FROM savings_goal_entries WHERE goal_id=? AND deleted_at IS NULL ORDER BY occurred_at,created_at,id;',
        linkedGoal.id
      );
      const current = deriveGoalProgress(currentEntries, linkedGoal.target_amount).current;
      if (cascadedGoalEntry.entry_type === 'withdrawal' && cascadedGoalEntry.amount > current) {
        throw new Error('GOAL_ERR_OVER_WITHDRAWAL');
      }
      await txn.runAsync(
        'UPDATE savings_goal_entries SET deleted_at=NULL,cascade_deleted_at=NULL,updated_at=? WHERE id=?;',
        now, cascadedGoalEntry.id
      );
      const restoredEntries = [...currentEntries, { ...cascadedGoalEntry, deleted_at: null }];
      const progress = deriveGoalProgress(restoredEntries, linkedGoal.target_amount);
      await txn.runAsync(
        'UPDATE savings_goals SET lifecycle_status=?,completed_at=?,updated_at=? WHERE id=?;',
        progress.lifecycleStatus, progress.lifecycleStatus === 'completed' ? now : null, now, linkedGoal.id
      );
    }
  });

  return changes > 0;
}
