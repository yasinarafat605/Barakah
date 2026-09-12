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
import {
  CreateTransactionInput,
  CreateTransferInput,
  DatabaseConnection,
  TransactionFilters,
  TransactionRow,
  TransactionWithDetails,
} from './types';

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

/**
 * Creates an income transaction.
 */
export async function createIncomeTransaction(
  input: CreateTransactionInput,
  customDb?: DatabaseConnection
): Promise<TransactionRow> {
  const db = customDb ?? (await getDatabase());

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transaction amount must be a positive integer in minor units. Received: ${input.amountMinor}`);
  }

  const account = await getAccountById(input.accountId, db);
  if (!account) {
    throw new Error(`Account not found: ${input.accountId}`);
  }

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
  const note = input.note?.trim() || null;

  await db.runAsync(
    `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'income', NULL, NULL, NULL, ?, ?, ?, ?, NULL);`,
    id,
    input.accountId,
    input.categoryId,
    input.amountMinor,
    note,
    timestamp,
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

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transaction amount must be a positive integer in minor units. Received: ${input.amountMinor}`);
  }

  const account = await getAccountById(input.accountId, db);
  if (!account) {
    throw new Error(`Account not found: ${input.accountId}`);
  }

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
  const note = input.note?.trim() || null;

  await db.runAsync(
    `INSERT INTO transactions (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'expense', NULL, NULL, NULL, ?, ?, ?, ?, NULL);`,
    id,
    input.accountId,
    input.categoryId,
    input.amountMinor,
    note,
    timestamp,
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

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TypeError(`Transfer amount must be a positive integer in minor units. Received: ${input.amountMinor}`);
  }

  const sourceAccount = await getAccountById(input.sourceAccountId, db);
  if (!sourceAccount) {
    throw new Error(`Source account not found: ${input.sourceAccountId}`);
  }

  const destinationAccount = await getAccountById(input.destinationAccountId, db);
  if (!destinationAccount) {
    throw new Error(`Destination account not found: ${input.destinationAccountId}`);
  }

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
  const note = input.note?.trim() || null;

  await runExclusiveTransaction(db, async () => {
    // 1. Insert source debit entry
    await db.runAsync(
      `INSERT INTO transactions (
         id, account_id, category_id, amount, type, transfer_id, transfer_role,
         related_account_id, note, timestamp, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, 'transfer', ?, 'source', ?, ?, ?, ?, ?, NULL);`,
      sourceTxId,
      input.sourceAccountId,
      input.amountMinor,
      transferId,
      input.destinationAccountId,
      note,
      timestamp,
      now,
      now
    );

    // 2. Insert destination credit entry
    await db.runAsync(
      `INSERT INTO transactions (
         id, account_id, category_id, amount, type, transfer_id, transfer_role,
         related_account_id, note, timestamp, created_at, updated_at, deleted_at
       ) VALUES (?, ?, NULL, ?, 'transfer', ?, 'destination', ?, ?, ?, ?, ?, NULL);`,
      destTxId,
      input.destinationAccountId,
      input.amountMinor,
      transferId,
      input.sourceAccountId,
      note,
      timestamp,
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
  await runExclusiveTransaction(db, async () => {
    if (existing.transfer_id) {
      const res = await db.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE transfer_id = ? AND deleted_at IS NULL;',
        now,
        now,
        existing.transfer_id
      );
      changes = res.changes;
    } else {
      const res = await db.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
        now,
        now,
        id
      );
      changes = res.changes;
    }
  });

  return changes > 0;
}

/**
 * Restores a soft-deleted transaction.
 * If the transaction is part of a transfer, BOTH paired entries are restored atomically.
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
  await runExclusiveTransaction(db, async () => {
    if (existing.transfer_id) {
      const res = await db.runAsync(
        'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE transfer_id = ? AND deleted_at IS NOT NULL;',
        now,
        existing.transfer_id
      );
      changes = res.changes;
    } else {
      const res = await db.runAsync(
        'UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL;',
        now,
        id
      );
      changes = res.changes;
    }
  });

  return changes > 0;
}
