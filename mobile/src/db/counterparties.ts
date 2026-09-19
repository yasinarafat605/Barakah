/**
 * Barakah Counterparties Repository & Data Access Layer
 * Neutral entity representing individuals, businesses, or organisations
 * that the user borrows from or lends to.
 * 
 * Strict Privacy & Architectural Rules:
 * - Sensitive contact info (phone, email) is NEVER logged or transmitted.
 * - No contact book permissions requested.
 * - Cannot be hard-deleted if debts exist (ON DELETE RESTRICT).
 */

import { getDatabase } from './client';
import { coerceSafeFinancialInteger, sumFinancialValues } from '../domain/integer-math';
import {
  CounterpartyRow,
  CounterpartyWithDebtSummary,
  CreateCounterpartyInput,
  DatabaseConnection,
  UpdateCounterpartyInput,
} from './types';

/**
 * Generates a unique, collision-resistant counterparty ID.
 */
export function generateCounterpartyId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `cp_${timestamp}_${randomPart}`;
}

/**
 * Creates a new neutral counterparty profile.
 */
export async function createCounterparty(
  input: CreateCounterpartyInput,
  customDb?: DatabaseConnection
): Promise<CounterpartyRow> {
  const db = customDb ?? (await getDatabase());
  const trimmedName = input.name.trim();

  if (!trimmedName) {
    throw new Error('Counterparty name cannot be empty');
  }

  const id = generateCounterpartyId();
  const now = Date.now();
  const type = input.type ?? 'person';
  const phone = input.phone ? input.phone.trim() : null;
  const email = input.email ? input.email.trim() : null;
  const note = input.note ? input.note.trim() : null;
  const avatarColor = input.avatarColor ?? null;

  await db.runAsync(
    `INSERT INTO counterparties (
       id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?);`,
    id,
    trimmedName,
    type,
    phone,
    email,
    note,
    avatarColor,
    now,
    now
  );

  return {
    id,
    name: trimmedName,
    type,
    phone,
    email,
    note,
    avatar_color: avatarColor,
    is_archived: 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Updates an existing counterparty profile.
 */
export async function updateCounterparty(
  id: string,
  input: UpdateCounterpartyInput,
  customDb?: DatabaseConnection
): Promise<CounterpartyRow> {
  const db = customDb ?? (await getDatabase());
  const existing = await getCounterpartyById(id, db);

  if (!existing) {
    throw new Error(`Counterparty not found: ${id}`);
  }

  const now = Date.now();
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) {
    throw new Error('Counterparty name cannot be empty');
  }

  const type = input.type !== undefined ? input.type : existing.type;
  const phone = input.phone !== undefined ? (input.phone ? input.phone.trim() : null) : existing.phone;
  const email = input.email !== undefined ? (input.email ? input.email.trim() : null) : existing.email;
  const note = input.note !== undefined ? (input.note ? input.note.trim() : null) : existing.note;
  const avatarColor = input.avatarColor !== undefined ? input.avatarColor : existing.avatar_color;

  await db.runAsync(
    `UPDATE counterparties
     SET name = ?, type = ?, phone = ?, email = ?, note = ?, avatar_color = ?, updated_at = ?
     WHERE id = ?;`,
    name,
    type,
    phone,
    email,
    note,
    avatarColor,
    now,
    id
  );

  return {
    ...existing,
    name,
    type,
    phone,
    email,
    note,
    avatar_color: avatarColor,
    updated_at: now,
  };
}

/**
 * Archives a counterparty. Preserves historical debts and transactions.
 * Blocked if active unarchived debts exist.
 */
export async function archiveCounterparty(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  // Block archival if active unarchived debts exist
  const activeDebtsRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM debts WHERE counterparty_id = ? AND status = 'active' AND archived_at IS NULL AND deleted_at IS NULL;",
    id
  );

  if ((activeDebtsRow?.count ?? 0) > 0) {
    throw new Error('Cannot archive counterparty with active debts. Settle or archive all active debts first.');
  }

  await db.runAsync(
    'UPDATE counterparties SET is_archived = 1, updated_at = ? WHERE id = ?;',
    now,
    id
  );
}

/**
 * Restores an archived counterparty profile.
 */
export async function restoreCounterparty(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();
  await db.runAsync(
    'UPDATE counterparties SET is_archived = 0, updated_at = ? WHERE id = ?;',
    now,
    id
  );
}

/**
 * Permanently deletes a counterparty ONLY if no debts reference them.
 * If ANY debts exist in history (including soft-deleted debts), deletion is rejected.
 */
export async function deleteCounterparty(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());

  // Check if referenced by ANY debts to protect referential integrity
  const debtCountRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM debts WHERE counterparty_id = ?;',
    id
  );

  if ((debtCountRow?.count ?? 0) > 0) {
    throw new Error('Cannot delete counterparty with existing debts or debt history. Archive instead.');
  }

  await db.runAsync('DELETE FROM counterparties WHERE id = ?;', id);
}

/**
 * Retrieves all counterparties with aggregated debt summaries.
 */
export async function getCounterparties(
  filters?: { isArchived?: boolean; search?: string },
  customDb?: DatabaseConnection
): Promise<CounterpartyWithDebtSummary[]> {
  const db = customDb ?? (await getDatabase());

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.isArchived !== undefined) {
    conditions.push('cp.is_archived = ?');
    params.push(filters.isArchived ? 1 : 0);
  }

  if (filters?.search && filters.search.trim()) {
    conditions.push('cp.name LIKE ?');
    params.push(`%${filters.search.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      cp.id,
      cp.name,
      cp.type,
      cp.phone,
      cp.email,
      cp.note,
      cp.avatar_color,
      cp.is_archived,
      cp.created_at,
      cp.updated_at,
      COALESCE(SUM(CASE WHEN d.status = 'active' AND d.archived_at IS NULL AND d.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active_debt_count,
      COALESCE(SUM(CASE WHEN d.status = 'settled' AND d.archived_at IS NULL AND d.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS settled_debt_count
    FROM counterparties cp
    LEFT JOIN debts d ON cp.id = d.counterparty_id AND d.deleted_at IS NULL
    ${whereClause}
    GROUP BY cp.id
    ORDER BY cp.is_archived ASC, cp.name ASC;
  `;

  const rows = await db.getAllAsync<any>(query, ...params);

  // Fetch active debt balances grouped by counterparty and currency
  const debtBalancesQuery = `
    SELECT
      d.counterparty_id,
      d.direction,
      d.currency,
      (d.original_principal - COALESCE(SUM(
        CASE
          WHEN dt.role = 'repayment' AND dt.deleted_at IS NULL THEN dt.amount
          WHEN dt.role = 'adjustment_decrease' AND dt.deleted_at IS NULL THEN dt.amount
          WHEN dt.role = 'adjustment_increase' AND dt.deleted_at IS NULL THEN -dt.amount
          ELSE 0
        END
      ), 0)) AS outstanding_amount
    FROM debts d
    LEFT JOIN debt_transactions dt ON d.id = dt.debt_id AND dt.deleted_at IS NULL
    WHERE d.status = 'active' AND d.archived_at IS NULL AND d.deleted_at IS NULL
    GROUP BY d.id;
  `;

  const activeDebts = await db.getAllAsync<{
    counterparty_id: string;
    direction: 'borrowed' | 'lent';
    currency: string;
    outstanding_amount: number;
  }>(debtBalancesQuery);

  // Map debt balances by counterparty
  const balanceMap = new Map<
    string,
    { borrowed: Record<string, number>; lent: Record<string, number> }
  >();

  for (const row of activeDebts) {
    if (!balanceMap.has(row.counterparty_id)) {
      balanceMap.set(row.counterparty_id, { borrowed: {}, lent: {} });
    }
    const entry = balanceMap.get(row.counterparty_id)!;
    const curr = row.currency || 'BDT';
    const amount = coerceSafeFinancialInteger(row.outstanding_amount, 'counterparty outstanding amount');
    if (amount <= 0) continue;

    if (row.direction === 'borrowed') {
      entry.borrowed[curr] = sumFinancialValues([entry.borrowed[curr] || 0, amount], 'counterparty borrowed total');
    } else {
      entry.lent[curr] = sumFinancialValues([entry.lent[curr] || 0, amount], 'counterparty lent total');
    }
  }

  return rows.map((r) => {
    const balances = balanceMap.get(r.id) || { borrowed: {}, lent: {} };
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      phone: r.phone,
      email: r.email,
      note: r.note,
      avatar_color: r.avatar_color,
      is_archived: Number(r.is_archived),
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      active_debt_count: Number(r.active_debt_count),
      settled_debt_count: Number(r.settled_debt_count),
      total_borrowed_by_currency: balances.borrowed,
      total_lent_by_currency: balances.lent,
    };
  });
}

/**
 * Retrieves a single counterparty by ID with aggregated debt summaries.
 */
export async function getCounterpartyById(
  id: string,
  customDb?: DatabaseConnection
): Promise<CounterpartyWithDebtSummary | null> {
  const list = await getCounterparties(undefined, customDb);
  return list.find((c) => c.id === id) ?? null;
}
