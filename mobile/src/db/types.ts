/**
 * SQLite Database Core Types for Barakah
 * Adheres strictly to:
 * - Local-first architecture (ADR-001)
 * - Rule 1 / ADR-004: All money stored as INTEGER minor units. No REAL/FLOAT.
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
  withExclusiveTransactionAsync(task: () => Promise<void>): Promise<void>;
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
  initial_balance: number; // Integer minor units
  currency: string;
  created_at: number;
  updated_at: number;
}

export interface RawAccountWithBalanceRow extends AccountRow {
  transaction_net: number; // Derived net: income - expense + transfer_destination - transfer_source
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
  name_custom: string | null;
  icon: string | null;
  color: string | null;
  type: 'income' | 'expense';
  is_archived: number; // 0 = active, 1 = archived
  sort_order: number;
  is_default: number; // 1 = seeded system default, 0 = custom
  created_at: number;
  updated_at: number;
}

export interface CreateCategoryInput {
  nameKey?: string;
  nameCustom: string;
  icon?: string | null;
  color?: string | null;
  type: 'income' | 'expense';
}

export interface UpdateCategoryInput {
  nameCustom?: string | null;
  icon?: string | null;
  color?: string | null;
  type?: 'income' | 'expense';
}

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransferRole = 'source' | 'destination';

export interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  amount: number; // Positive integer minor units
  type: TransactionType;
  transfer_id: string | null;
  transfer_role: TransferRole | null;
  related_account_id: string | null;
  note: string | null;
  timestamp: number; // Unix ms
  created_at: number; // Unix ms
  updated_at: number; // Unix ms
  deleted_at: number | null; // Unix ms when soft-deleted
}

export interface TransactionWithDetails extends TransactionRow {
  account_name: string;
  account_currency: string;
  account_type: AccountType;
  category_name_key: string | null;
  category_name_custom: string | null;
  category_icon: string | null;
  category_color: string | null;
  related_account_name: string | null;
  related_account_currency: string | null;
}

export interface CreateTransactionInput {
  accountId: string;
  categoryId: string;
  amountMinor: number; // Positive integer minor units
  type?: 'income' | 'expense';
  note?: string | null;
  timestamp?: number; // Unix ms
  occurredAt?: number; // Alias for timestamp
}

export interface CreateTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number; // Positive integer minor units
  note?: string | null;
  timestamp?: number; // Unix ms
  occurredAt?: number; // Alias for timestamp
}

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  startDate?: number;
  endDate?: number;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}
