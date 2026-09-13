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
  source_account_name?: string | null;
  destination_account_name?: string | null;
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
  groupByTransfer?: boolean;
  limit?: number;
  offset?: number;
}

// ----------------------------------------------------------------------
// Phase 3: Counterparties, Debts & Liabilities Types
// ----------------------------------------------------------------------

export type CounterpartyType = 'person' | 'business' | 'organisation' | 'other';

export interface CounterpartyRow {
  id: string;
  name: string;
  type: CounterpartyType;
  phone: string | null;
  email: string | null;
  note: string | null;
  avatar_color: string | null;
  is_archived: number; // 0 = active, 1 = archived
  created_at: number;
  updated_at: number;
}

export interface CreateCounterpartyInput {
  name: string;
  type?: CounterpartyType;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  avatarColor?: string | null;
}

export interface UpdateCounterpartyInput {
  name?: string;
  type?: CounterpartyType;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  avatarColor?: string | null;
}

export interface CounterpartyWithDebtSummary extends CounterpartyRow {
  active_debt_count: number;
  settled_debt_count: number;
  total_borrowed_by_currency: Record<string, number>; // Total I owe them
  total_lent_by_currency: Record<string, number>;     // Total they owe me
}

export type DebtDirection = 'borrowed' | 'lent';
export type DebtOpeningMode = 'new_with_cash' | 'existing_balance';
export type DebtStatus = 'active' | 'settled';
export type DebtDueState = 'active' | 'due_soon' | 'overdue' | 'settled' | 'archived';

export interface DebtRow {
  id: string;
  counterparty_id: string;
  direction: DebtDirection;
  original_principal: number; // Positive integer minor units
  currency: string;
  opening_mode: DebtOpeningMode;
  opened_at: number; // Unix ms
  due_date: string | null; // Calendar date 'YYYY-MM-DD'
  status: DebtStatus;
  note: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null; // Unix ms
  deleted_at: number | null; // Unix ms
}

export interface DebtWithDetails extends DebtRow {
  counterparty_name: string;
  counterparty_type: CounterpartyType;
  total_repaid: number;
  outstanding_principal: number;
  due_state: DebtDueState;
  linked_account_id?: string | null;
  linked_account_name?: string | null;
}

export interface CreateDebtInput {
  counterpartyId: string;
  direction: DebtDirection;
  originalPrincipalMinor: number;
  currency?: string;
  openingMode: DebtOpeningMode;
  openedAt?: number;
  dueDate?: string | null; // Calendar date 'YYYY-MM-DD'
  note?: string | null;
  // If openingMode === 'new_with_cash':
  accountId?: string;
}

export interface UpdateDebtInput {
  dueDate?: string | null; // Calendar date 'YYYY-MM-DD'
  note?: string | null;
  counterpartyId?: string;
}

export interface DebtSummary {
  totalBorrowedByCurrency: Record<string, number>;
  totalLentByCurrency: Record<string, number>;
}

export type DebtWithCounterparty = DebtWithDetails;
export type DebtTimelineItem = DebtTransactionWithDetails;

export interface DebtFilters {
  direction?: DebtDirection;
  status?: DebtStatus | 'all';
  counterpartyId?: string;
  currency?: string;
  isArchived?: boolean;
  includeDeleted?: boolean;
}

export type DebtTransactionRole =
  | 'disbursement'
  | 'repayment'
  | 'adjustment_increase'
  | 'adjustment_decrease'
  | 'opening_balance';

export interface DebtTransactionRow {
  id: string;
  debt_id: string;
  transaction_id: string | null;
  amount: number; // Positive integer minor units
  role: DebtTransactionRole;
  note: string | null;
  occurred_at: number; // Unix ms
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface DebtTransactionWithDetails extends DebtTransactionRow {
  account_id?: string | null;
  account_name?: string | null;
  account_currency?: string | null;
}

export interface RecordRepaymentInput {
  debtId: string;
  amountMinor: number; // Positive integer minor units
  accountId: string; // Required: repayment requires cash transaction link
  occurredAt?: number;
  note?: string | null;
}

export interface RecordAdjustmentInput {
  debtId: string;
  amountMinor: number; // Positive integer minor units
  direction: 'increase' | 'decrease'; // 'increase' adds to balance owed, 'decrease' reduces balance owed
  note?: string | null;
  occurredAt?: number;
}

