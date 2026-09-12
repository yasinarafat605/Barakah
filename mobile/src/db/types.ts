/**
 * SQLite Database Core Types for Friday Amanah
 * Adheres strictly to:
 * - Local-first architecture (ADR-001)
 * - Rule 1 / ADR-004: All money stored as INTEGER minor units (poisha). No REAL/FLOAT.
 * - PRAGMA foreign_keys = ON;
 * - PRAGMA journal_mode = WAL;
 */

import type { Money } from '../domain/money';

export interface DatabaseConnection {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseConnection) => Promise<void>;
}

export type AccountType = 'cash' | 'bank' | 'mobile_wallet' | 'savings' | 'business' | 'custom';

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number; // Integer minor units (poisha)
  currency: string;
  created_at: number;
  updated_at: number;
}

export interface RawAccountWithBalanceRow extends AccountRow {
  transaction_net: number; // Sum of income - expense
  transaction_count: number;
}

export interface AccountWithBalance extends AccountRow {
  current_balance_poisha: number;
  transaction_count: number;
  balance: Money;
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  initialBalancePoisha: number;
  currency?: string;
}

export interface CategoryRow {
  id: string;
  name_key: string;
  icon: string | null;
  color: string | null;
  type: 'income' | 'expense';
}

export interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  amount: number; // Integer minor units (poisha)
  type: 'income' | 'expense' | 'transfer';
  note: string | null;
  timestamp: number;
  created_at: number;
}
