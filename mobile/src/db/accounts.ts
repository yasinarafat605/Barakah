/**
 * Friday Amanah Accounts Repository & Data Access Layer
 * Strict Rules:
 * - ADR-001: Local-first SQLite database source of truth.
 * - ADR-004 / Rule 1: All money values are integer minor units (poisha).
 * - ADR-005 / Rule 2: Balances are derived from initial_balance + sum(transactions).
 *   Never stored as a mutable running total.
 */

import { getDatabase } from './client';
import {
  AccountType,
  AccountWithBalance,
  CreateAccountInput,
  DatabaseConnection,
  RawAccountWithBalanceRow,
} from './types';
import { Money } from '../domain/money';

/**
 * Generates a unique, collision-resistant account ID.
 */
export function generateAccountId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `acc_${timestamp}_${randomPart}`;
}

/**
 * Creates a new account with integer initial balance in minor units (poisha).
 */
export async function createAccount(
  data: CreateAccountInput,
  customDb?: DatabaseConnection
): Promise<AccountWithBalance> {
  const db = customDb ?? (await getDatabase());
  const trimmedName = data.name.trim();

  if (!trimmedName) {
    throw new Error('Account name cannot be empty');
  }

  if (!Number.isInteger(data.initialBalancePoisha)) {
    throw new TypeError(
      `initialBalancePoisha must be an integer (received: ${data.initialBalancePoisha}). ADR-004 violation.`
    );
  }

  const id = generateAccountId();
  const currency = data.currency ? data.currency.trim().toUpperCase() : 'BDT';
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    id,
    trimmedName,
    data.type,
    data.initialBalancePoisha,
    currency,
    now,
    now
  );

  return {
    id,
    name: trimmedName,
    type: data.type,
    initial_balance: data.initialBalancePoisha,
    currency,
    created_at: now,
    updated_at: now,
    current_balance_poisha: data.initialBalancePoisha,
    transaction_count: 0,
    balance: new Money(data.initialBalancePoisha, currency),
  };
}

/**
 * Returns all accounts with their derived current balance and transaction count.
 * Derived formula: initial_balance + sum(income) - sum(expense).
 */
export async function getAccountsWithBalances(
  customDb?: DatabaseConnection
): Promise<AccountWithBalance[]> {
  const db = customDb ?? (await getDatabase());

  const rows = await db.getAllAsync<RawAccountWithBalanceRow>(
    `SELECT
       a.id,
       a.name,
       a.type,
       a.initial_balance,
       a.currency,
       a.created_at,
       a.updated_at,
       COALESCE(
         SUM(
           CASE
             WHEN t.type = 'income' THEN t.amount
             WHEN t.type = 'expense' THEN -t.amount
             ELSE 0
           END
         ),
         0
       ) AS transaction_net,
       COUNT(t.id) AS transaction_count
     FROM accounts a
     LEFT JOIN transactions t ON a.id = t.account_id
     GROUP BY a.id
     ORDER BY a.created_at ASC;`
  );

  return rows.map((row) => {
    const net = Number(row.transaction_net);
    const count = Number(row.transaction_count);
    const currentBalancePoisha = row.initial_balance + net;

    return {
      id: row.id,
      name: row.name,
      type: row.type as AccountType,
      initial_balance: row.initial_balance,
      currency: row.currency,
      created_at: row.created_at,
      updated_at: row.updated_at,
      current_balance_poisha: currentBalancePoisha,
      transaction_count: count,
      balance: new Money(currentBalancePoisha, row.currency),
    };
  });
}

/**
 * Retrieves a single account by ID with its derived current balance.
 */
export async function getAccountById(
  id: string,
  customDb?: DatabaseConnection
): Promise<AccountWithBalance | null> {
  const db = customDb ?? (await getDatabase());

  const row = await db.getFirstAsync<RawAccountWithBalanceRow>(
    `SELECT
       a.id,
       a.name,
       a.type,
       a.initial_balance,
       a.currency,
       a.created_at,
       a.updated_at,
       COALESCE(
         SUM(
           CASE
             WHEN t.type = 'income' THEN t.amount
             WHEN t.type = 'expense' THEN -t.amount
             ELSE 0
           END
         ),
         0
       ) AS transaction_net,
       COUNT(t.id) AS transaction_count
     FROM accounts a
     LEFT JOIN transactions t ON a.id = t.account_id
     WHERE a.id = ?
     GROUP BY a.id;`,
    id
  );

  if (!row) {
    return null;
  }

  const net = Number(row.transaction_net);
  const count = Number(row.transaction_count);
  const currentBalancePoisha = row.initial_balance + net;

  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    initial_balance: row.initial_balance,
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
    current_balance_poisha: currentBalancePoisha,
    transaction_count: count,
    balance: new Money(currentBalancePoisha, row.currency),
  };
}

/**
 * Deletes an account.
 * Rejects if transactions exist for this account due to PRAGMA foreign_keys = ON / ON DELETE RESTRICT.
 */
export async function deleteAccount(
  id: string,
  customDb?: DatabaseConnection
): Promise<boolean> {
  const db = customDb ?? (await getDatabase());
  const result = await db.runAsync('DELETE FROM accounts WHERE id = ?;', id);
  return result.changes > 0;
}
