/**
 * Strict Validation Engine for Barakah Backup Payloads
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - Row-level schema validation for all 7 database tables
 * - Safe integer boundaries (ADR-004)
 * - Strict civil date validation without rollover (ADR-013)
 * - Foreign-key and cross-table referential integrity
 * - Transfer pair synchronization and parity (ADR-005)
 * - Same-currency transfer account validation and exact timestamp equality
 * - Debt lifecycle status validation against derived balance (outstanding >= 0)
 * - Debt transaction link amount, currency, account, and direction semantics
 * - Rejection of active debt repayments linked to soft-deleted transactions
 * - Rejection of duplicate transaction links (even across soft-deleted debt transactions)
 * - Migration ledger uniqueness and canonical checksum enforcement
 * - Zero silent repairs: never trim or normalize stored data (ADR-016)
 */

import {
  AccountRow,
  CategoryRow,
  TransactionRow,
  CounterpartyRow,
  DebtRow,
  DebtTransactionRow,
  BudgetRow,
  BudgetCategoryRow,
  SavingsGoalRow,
  SavingsGoalEntryRow,
} from '../../db/types';
import {
  BackupPayloadData,
  SchemaMigrationRow,
  RestoreError,
} from './types';
import { isValidCivilDate } from '../../domain/civil-date';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../../db/migrations/registry';
import { isSupportedCurrency } from '../../domain/money';

// ID validator: non-empty string, reasonable length (1 to 128 characters)
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128;
}

// Positive safe integer validator (> 0)
function isPositiveSafeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0;
}

// Non-negative safe integer validator (>= 0)
function isNonNegativeSafeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

// Any safe integer (positive, zero, or negative)
function isSafeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val);
}

// Currency validator: Barakah intentionally supports the declared two-decimal currency set only.
function isValidCurrency(val: unknown): val is string {
  return typeof val === 'string' && isSupportedCurrency(val);
}

// Safe timestamp validator
function isValidTimestamp(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0 && val <= 253402300799000;
}

/**
 * Validates an AccountRow without modifying strings.
 */
export function validateAccountRow(row: unknown, index: number): AccountRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid account record at index ${index}.`);
  }
  const a = row as Record<string, unknown>;

  if (!isValidId(a.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account at index ${index} has invalid id: ${String(a.id)}`);
  }
  if (typeof a.name !== 'string' || a.name.length === 0 || a.name.length > 256) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid name.`);
  }
  const validTypes = ['cash', 'bank', 'mobile_wallet', 'savings', 'business', 'custom'];
  if (typeof a.type !== 'string' || !validTypes.includes(a.type)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid type: ${String(a.type)}`);
  }
  if (!isSafeInteger(a.initial_balance)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid initial_balance.`);
  }
  if (!isValidCurrency(a.currency)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid currency: ${String(a.currency)}`);
  }
  if (!isValidTimestamp(a.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid created_at.`);
  }
  if (!isValidTimestamp(a.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid updated_at.`);
  }
  if (a.archived_at !== null && a.archived_at !== undefined && !isValidTimestamp(a.archived_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account ${a.id} has invalid archived_at.`);
  }

  return {
    id: a.id,
    name: a.name,
    type: a.type as AccountRow['type'],
    initial_balance: a.initial_balance,
    currency: a.currency,
    created_at: a.created_at,
    updated_at: a.updated_at,
    archived_at: typeof a.archived_at === 'number' ? a.archived_at : null,
  };
}

/**
 * Validates a CategoryRow without modifying strings.
 */
export function validateCategoryRow(row: unknown, index: number): CategoryRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid category record at index ${index}.`);
  }
  const c = row as Record<string, unknown>;

  if (!isValidId(c.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category at index ${index} has invalid id.`);
  }
  if (typeof c.name_key !== 'string' || c.name_key.length === 0) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid name_key.`);
  }
  if (c.name_custom !== null && c.name_custom !== undefined && typeof c.name_custom !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid name_custom.`);
  }
  if (c.icon !== null && c.icon !== undefined && typeof c.icon !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid icon.`);
  }
  if (c.color !== null && c.color !== undefined && typeof c.color !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid color.`);
  }
  if (c.type !== 'income' && c.type !== 'expense') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid type: ${String(c.type)}`);
  }
  if (c.is_archived !== 0 && c.is_archived !== 1) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid is_archived: ${String(c.is_archived)}`);
  }
  if (!isSafeInteger(c.sort_order)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid sort_order.`);
  }
  if (c.is_default !== 0 && c.is_default !== 1) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid is_default.`);
  }
  if (!isNonNegativeSafeInteger(c.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid created_at.`);
  }
  if (!isNonNegativeSafeInteger(c.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category ${c.id} has invalid updated_at.`);
  }

  return {
    id: c.id,
    name_key: c.name_key,
    name_custom: typeof c.name_custom === 'string' ? c.name_custom : null,
    icon: typeof c.icon === 'string' ? c.icon : null,
    color: typeof c.color === 'string' ? c.color : null,
    type: c.type,
    is_archived: c.is_archived,
    sort_order: c.sort_order,
    is_default: c.is_default,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/**
 * Validates a TransactionRow without modifying strings.
 */
export function validateTransactionRow(row: unknown, index: number): TransactionRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid transaction record at index ${index}.`);
  }
  const t = row as Record<string, unknown>;

  if (!isValidId(t.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction at index ${index} has invalid id.`);
  }
  if (!isValidId(t.account_id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid account_id.`);
  }
  if (!isPositiveSafeInteger(t.amount)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid amount: ${String(t.amount)}. Must be a positive safe integer.`);
  }
  if (t.type !== 'income' && t.type !== 'expense' && t.type !== 'transfer') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid type: ${String(t.type)}`);
  }

  // Transfer integrity constraints
  if (t.type === 'transfer') {
    if (!isValidId(t.transfer_id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transfer transaction ${t.id} missing transfer_id.`);
    }
    if (t.transfer_role !== 'source' && t.transfer_role !== 'destination') {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transfer transaction ${t.id} has invalid transfer_role: ${String(t.transfer_role)}`);
    }
    if (!isValidId(t.related_account_id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transfer transaction ${t.id} missing related_account_id.`);
    }
    if (t.related_account_id === t.account_id) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transfer transaction ${t.id} has identical account_id and related_account_id.`);
    }
    if (t.category_id !== null && t.category_id !== undefined) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transfer transaction ${t.id} must not have a category_id.`);
    }
  } else {
    // Income or Expense
    if (t.transfer_id !== null && t.transfer_id !== undefined) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Non-transfer transaction ${t.id} must not have transfer_id.`);
    }
    if (t.transfer_role !== null && t.transfer_role !== undefined) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Non-transfer transaction ${t.id} must not have transfer_role.`);
    }
    if (t.related_account_id !== null && t.related_account_id !== undefined) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Non-transfer transaction ${t.id} must not have related_account_id.`);
    }
    if (!isValidId(t.category_id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} missing category_id.`);
    }
  }

  if (t.note !== null && t.note !== undefined && typeof t.note !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid note.`);
  }
  if (!isValidTimestamp(t.timestamp)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid timestamp.`);
  }
  if (!isValidCivilDate(t.occurred_on as string)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid occurred_on.`);
  }
  if (!isValidTimestamp(t.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid created_at.`);
  }
  if (!isNonNegativeSafeInteger(t.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid updated_at.`);
  }
  if (t.deleted_at !== null && t.deleted_at !== undefined && !isValidTimestamp(t.deleted_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Transaction ${t.id} has invalid deleted_at.`);
  }

  return {
    id: t.id,
    account_id: t.account_id,
    category_id: typeof t.category_id === 'string' ? t.category_id : null,
    amount: t.amount,
    type: t.type,
    transfer_id: typeof t.transfer_id === 'string' ? t.transfer_id : null,
    transfer_role: (t.transfer_role as TransactionRow['transfer_role']) ?? null,
    related_account_id: typeof t.related_account_id === 'string' ? t.related_account_id : null,
    note: typeof t.note === 'string' ? t.note : null,
    timestamp: t.timestamp,
    occurred_on: t.occurred_on as string,
    created_at: t.created_at,
    updated_at: t.updated_at,
    deleted_at: typeof t.deleted_at === 'number' ? t.deleted_at : null,
  };
}

/**
 * Validates a CounterpartyRow without modifying strings.
 */
export function validateCounterpartyRow(row: unknown, index: number): CounterpartyRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid counterparty record at index ${index}.`);
  }
  const cp = row as Record<string, unknown>;

  if (!isValidId(cp.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty at index ${index} has invalid id.`);
  }
  if (typeof cp.name !== 'string' || cp.name.length === 0 || cp.name.length > 256) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid name.`);
  }
  const validTypes = ['person', 'business', 'organisation', 'other'];
  if (typeof cp.type !== 'string' || !validTypes.includes(cp.type)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid type: ${String(cp.type)}`);
  }
  if (cp.phone !== null && cp.phone !== undefined && typeof cp.phone !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid phone.`);
  }
  if (cp.email !== null && cp.email !== undefined && typeof cp.email !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid email.`);
  }
  if (cp.note !== null && cp.note !== undefined && typeof cp.note !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid note.`);
  }
  if (cp.avatar_color !== null && cp.avatar_color !== undefined && typeof cp.avatar_color !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid avatar_color.`);
  }
  if (cp.is_archived !== 0 && cp.is_archived !== 1) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid is_archived: ${String(cp.is_archived)}`);
  }
  if (!isValidTimestamp(cp.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid created_at.`);
  }
  if (!isValidTimestamp(cp.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty ${cp.id} has invalid updated_at.`);
  }

  return {
    id: cp.id,
    name: cp.name,
    type: cp.type as CounterpartyRow['type'],
    phone: typeof cp.phone === 'string' ? cp.phone : null,
    email: typeof cp.email === 'string' ? cp.email : null,
    note: typeof cp.note === 'string' ? cp.note : null,
    avatar_color: typeof cp.avatar_color === 'string' ? cp.avatar_color : null,
    is_archived: cp.is_archived,
    created_at: cp.created_at,
    updated_at: cp.updated_at,
  };
}

/**
 * Validates a DebtRow without modifying strings.
 */
export function validateDebtRow(row: unknown, index: number): DebtRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid debt record at index ${index}.`);
  }
  const d = row as Record<string, unknown>;

  if (!isValidId(d.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt at index ${index} has invalid id.`);
  }
  if (!isValidId(d.counterparty_id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid counterparty_id.`);
  }
  if (d.direction !== 'borrowed' && d.direction !== 'lent') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid direction: ${String(d.direction)}`);
  }
  if (!isPositiveSafeInteger(d.original_principal)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid original_principal: ${String(d.original_principal)}. Must be > 0.`);
  }
  if (!isValidCurrency(d.currency)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid currency: ${String(d.currency)}`);
  }
  if (d.opening_mode !== 'new_with_cash' && d.opening_mode !== 'existing_balance') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid opening_mode: ${String(d.opening_mode)}`);
  }
  if (!isValidTimestamp(d.opened_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid opened_at.`);
  }
  if (d.due_date !== null && d.due_date !== undefined) {
    if (typeof d.due_date !== 'string' || !isValidCivilDate(d.due_date)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid due_date: "${String(d.due_date)}". Must be valid YYYY-MM-DD.`);
    }
  }
  if (d.status !== 'active' && d.status !== 'settled') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid status: ${String(d.status)}. Must be active or settled.`);
  }
  if (d.note !== null && d.note !== undefined && typeof d.note !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid note.`);
  }
  if (!isValidTimestamp(d.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid created_at.`);
  }
  if (!isValidTimestamp(d.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid updated_at.`);
  }
  if (d.archived_at !== null && d.archived_at !== undefined && !isValidTimestamp(d.archived_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid archived_at.`);
  }
  if (d.deleted_at !== null && d.deleted_at !== undefined && !isValidTimestamp(d.deleted_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt ${d.id} has invalid deleted_at.`);
  }

  return {
    id: d.id,
    counterparty_id: d.counterparty_id,
    direction: d.direction,
    original_principal: d.original_principal,
    currency: d.currency,
    opening_mode: d.opening_mode,
    opened_at: d.opened_at,
    due_date: typeof d.due_date === 'string' ? d.due_date : null,
    status: d.status,
    note: typeof d.note === 'string' ? d.note : null,
    created_at: d.created_at,
    updated_at: d.updated_at,
    archived_at: typeof d.archived_at === 'number' ? d.archived_at : null,
    deleted_at: typeof d.deleted_at === 'number' ? d.deleted_at : null,
  };
}

/**
 * Validates a DebtTransactionRow without modifying strings.
 */
export function validateDebtTransactionRow(row: unknown, index: number): DebtTransactionRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid debt transaction record at index ${index}.`);
  }
  const dt = row as Record<string, unknown>;

  if (!isValidId(dt.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction at index ${index} has invalid id.`);
  }
  if (!isValidId(dt.debt_id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid debt_id.`);
  }
  if (dt.transaction_id !== null && dt.transaction_id !== undefined && !isValidId(dt.transaction_id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid transaction_id.`);
  }
  if (!isPositiveSafeInteger(dt.amount)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid amount: ${String(dt.amount)}. Must be > 0.`);
  }
  const validRoles = ['disbursement', 'repayment', 'adjustment_increase', 'adjustment_decrease', 'opening_balance'];
  if (typeof dt.role !== 'string' || !validRoles.includes(dt.role)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid role: ${String(dt.role)}`);
  }

  // Enforce chk_debt_tx_link_role: disbursement & repayment MUST have transaction_id; adjustments & opening_balance MUST NOT
  if (dt.role === 'disbursement' || dt.role === 'repayment') {
    if (!isValidId(dt.transaction_id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} with role '${dt.role}' must reference an account transaction_id.`);
    }
  } else {
    if (dt.transaction_id !== null && dt.transaction_id !== undefined) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} with role '${dt.role}' must not have a transaction_id.`);
    }
  }
  if (dt.note !== null && dt.note !== undefined && typeof dt.note !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid note.`);
  }
  if (!isValidTimestamp(dt.occurred_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid occurred_at.`);
  }
  if (!isValidTimestamp(dt.created_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid created_at.`);
  }
  if (!isValidTimestamp(dt.updated_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid updated_at.`);
  }
  if (dt.deleted_at !== null && dt.deleted_at !== undefined && !isValidTimestamp(dt.deleted_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Debt transaction ${dt.id} has invalid deleted_at.`);
  }

  return {
    id: dt.id,
    debt_id: dt.debt_id,
    transaction_id: typeof dt.transaction_id === 'string' ? dt.transaction_id : null,
    amount: dt.amount,
    role: dt.role as DebtTransactionRow['role'],
    note: typeof dt.note === 'string' ? dt.note : null,
    occurred_at: dt.occurred_at,
    created_at: dt.created_at,
    updated_at: dt.updated_at,
    deleted_at: typeof dt.deleted_at === 'number' ? dt.deleted_at : null,
  };
}

/**
 * Validates a SchemaMigrationRow without modifying strings.
 */
export function validateSchemaMigrationRow(row: unknown, index: number): SchemaMigrationRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid migration record at index ${index}.`);
  }
  const m = row as Record<string, unknown>;

  if (!isPositiveSafeInteger(m.version)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Migration record at index ${index} has invalid version.`);
  }
  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Migration ${m.version} has invalid name.`);
  }
  if (!isValidTimestamp(m.applied_at)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Migration ${m.version} has invalid applied_at.`);
  }
  if (m.checksum !== null && m.checksum !== undefined && typeof m.checksum !== 'string') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Migration ${m.version} has invalid checksum.`);
  }

  return {
    version: m.version,
    name: m.name,
    applied_at: m.applied_at,
    checksum: typeof m.checksum === 'string' ? m.checksum : null,
  };
}

/**
 * Validates cross-table relations and invariants across the entire restored dataset.
 */
export function validateBudgetRow(row: unknown, index: number): BudgetRow {
  if (!row || typeof row !== 'object') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid budget at ${index}.`);
  const b = row as Record<string, unknown>;
  if (!isValidId(b.id) || (b.name !== null && b.name !== undefined && typeof b.name !== 'string')) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${index} has invalid identity.`);
  if (b.period_type !== 'monthly' && b.period_type !== 'custom') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid period type.`);
  if (!isValidCivilDate(b.starts_on as string) || !isValidCivilDate(b.ends_on as string) || (b.ends_on as string) < (b.starts_on as string)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid period.`);
  if (!isValidCurrency(b.currency)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid currency.`);
  for (const [key,value] of [['income_target',b.income_target],['expense_limit',b.expense_limit]] as const) {
    if (value !== null && value !== undefined && !isPositiveSafeInteger(value)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid ${key}.`);
  }
  if (b.rollover_policy !== 'none' && b.rollover_policy !== 'unspent_only') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid rollover policy.`);
  if (!isValidTimestamp(b.created_at) || !isValidTimestamp(b.updated_at)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid timestamps.`);
  for (const value of [b.archived_at,b.deleted_at]) if (value !== null && value !== undefined && !isValidTimestamp(value)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget ${b.id} has invalid lifecycle timestamp.`);
  return b as unknown as BudgetRow;
}

export function validateBudgetCategoryRow(row: unknown, index: number): BudgetCategoryRow {
  if (!row || typeof row !== 'object') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid budget category at ${index}.`);
  const b = row as Record<string, unknown>;
  if (!isValidId(b.id) || !isValidId(b.budget_id) || !isValidId(b.category_id) || !isPositiveSafeInteger(b.amount) || !isNonNegativeSafeInteger(b.sort_order)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget category ${index} is invalid.`);
  if (!isValidTimestamp(b.created_at) || !isValidTimestamp(b.updated_at) || (b.deleted_at != null && !isValidTimestamp(b.deleted_at))) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Budget category ${b.id} has invalid timestamps.`);
  return b as unknown as BudgetCategoryRow;
}

export function validateSavingsGoalRow(row: unknown, index: number): SavingsGoalRow {
  if (!row || typeof row !== 'object') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid savings goal at ${index}.`);
  const g = row as Record<string, unknown>;
  if (!isValidId(g.id) || typeof g.name !== 'string' || !g.name || !isPositiveSafeInteger(g.target_amount) || !isValidCurrency(g.currency)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${index} is invalid.`);
  if (g.target_date != null && !isValidCivilDate(g.target_date as string)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${g.id} has invalid target date.`);
  if (g.lifecycle_status !== 'active' && g.lifecycle_status !== 'completed') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${g.id} has invalid lifecycle.`);
  if ((g.lifecycle_status === 'active') !== (g.completed_at == null)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${g.id} lifecycle timestamp disagrees.`);
  if (!isValidTimestamp(g.created_at) || !isValidTimestamp(g.updated_at)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${g.id} has invalid timestamps.`);
  for (const value of [g.completed_at,g.archived_at,g.deleted_at]) if (value != null && !isValidTimestamp(value)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal ${g.id} has invalid lifecycle timestamp.`);
  return g as unknown as SavingsGoalRow;
}

export function validateSavingsGoalEntryRow(row: unknown, index: number): SavingsGoalEntryRow {
  if (!row || typeof row !== 'object') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid savings goal entry at ${index}.`);
  const e = row as Record<string, unknown>;
  if (!isValidId(e.id) || !isValidId(e.goal_id) || !isPositiveSafeInteger(e.amount)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${index} is invalid.`);
  if (e.entry_type !== 'contribution' && e.entry_type !== 'withdrawal') throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid type.`);
  if (!['allocation_only','existing_transfer','owned_transfer'].includes(String(e.link_mode))) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid link mode.`);
  const needsTransaction = e.link_mode !== 'allocation_only';
  if (needsTransaction !== isValidId(e.transaction_id)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid evidence link.`);
  if (!isValidTimestamp(e.occurred_at) || !isValidCivilDate(e.occurred_on as string) || !isValidTimestamp(e.created_at) || !isValidTimestamp(e.updated_at)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid date.`);
  for (const value of [e.cascade_deleted_at,e.deleted_at]) if (value != null && !isValidTimestamp(value)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid lifecycle timestamp.`);
  if (e.cascade_deleted_at != null && e.deleted_at == null) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Savings goal entry ${e.id} has invalid cascade state.`);
  return e as unknown as SavingsGoalEntryRow;
}

export function validatePayloadInvariants(data: BackupPayloadData): void {
  // 1. Uniqueness of Primary Keys
  const accountsById = new Map<string, AccountRow>();
  for (const a of data.accounts) {
    if (accountsById.has(a.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate account ID: ${a.id}`);
    }
    accountsById.set(a.id, a);
  }

  const categoryIds = new Set<string>();
  const categoriesById = new Map<string, CategoryRow>();
  for (const c of data.categories) {
    if (categoryIds.has(c.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate category ID: ${c.id}`);
    }
    categoryIds.add(c.id);
    categoriesById.set(c.id, c);
  }

  const counterpartyIds = new Set<string>();
  for (const cp of data.counterparties) {
    if (counterpartyIds.has(cp.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate counterparty ID: ${cp.id}`);
    }
    counterpartyIds.add(cp.id);
  }

  const debtsById = new Map<string, DebtRow>();
  for (const d of data.debts) {
    if (debtsById.has(d.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate debt ID: ${d.id}`);
    }
    debtsById.set(d.id, d);
    if (!counterpartyIds.has(d.counterparty_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt ${d.id} references non-existent counterparty ${d.counterparty_id}`);
    }
  }

  const transactionsById = new Map<string, TransactionRow>();
  const transfersByTransferId = new Map<string, TransactionRow[]>();

  for (const tx of data.transactions) {
    if (transactionsById.has(tx.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate transaction ID: ${tx.id}`);
    }
    transactionsById.set(tx.id, tx);

    // FK checks
    if (!accountsById.has(tx.account_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent account ${tx.account_id}`);
    }
    if (tx.category_id && !categoryIds.has(tx.category_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent category ${tx.category_id}`);
    }
    if (tx.related_account_id && !accountsById.has(tx.related_account_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent related_account ${tx.related_account_id}`);
    }

    if (tx.transfer_id) {
      const list = transfersByTransferId.get(tx.transfer_id) ?? [];
      list.push(tx);
      transfersByTransferId.set(tx.transfer_id, list);
    }
  }

  // 2. Transfer Pair Integrity, Timestamp Equality & Same-Currency Accounts
  for (const [transferId, pair] of transfersByTransferId.entries()) {
    if (pair.length !== 2) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} is incomplete: expected 2 paired records, found ${pair.length}`
      );
    }
    const [t1, t2] = pair;
    if (t1.transfer_role === t2.transfer_role) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} has duplicate roles: both are ${t1.transfer_role}`
      );
    }
    if (t1.amount !== t2.amount) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} amounts do not match: ${t1.amount} !== ${t2.amount}`
      );
    }
    if (t1.timestamp !== t2.timestamp) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} timestamps do not match: ${t1.timestamp} !== ${t2.timestamp}`
      );
    }
    if (t1.occurred_on !== t2.occurred_on) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} civil dates do not match: ${t1.occurred_on} !== ${t2.occurred_on}`
      );
    }
    if (t1.account_id !== t2.related_account_id || t2.account_id !== t1.related_account_id) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} cross-account references do not match.`
      );
    }
    const acc1 = accountsById.get(t1.account_id);
    const acc2 = accountsById.get(t2.account_id);
    if (!acc1 || !acc2 || acc1.currency !== acc2.currency) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} accounts have mismatched currencies (${acc1?.currency} !== ${acc2?.currency}).`
      );
    }
    // Synchronized soft deletion
    const t1Deleted = t1.deleted_at !== null;
    const t2Deleted = t2.deleted_at !== null;
    if (t1Deleted !== t2Deleted) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} has unsynchronized soft-deletion states.`
      );
    }
  }

  // 3. Debt Ledger Integrity, Link Semantics, and Non-Negative Principal
  const debtTxIds = new Set<string>();
  const allLinkedTxIds = new Set<string>();
  const movementsByDebt = new Map<string, DebtTransactionRow[]>();

  for (const dt of data.debt_transactions) {
    if (debtTxIds.has(dt.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate debt transaction ID: ${dt.id}`);
    }
    debtTxIds.add(dt.id);

    const debt = debtsById.get(dt.debt_id);
    if (!debt) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt transaction ${dt.id} references non-existent debt ${dt.debt_id}`);
    }

    if (dt.transaction_id) {
      const linkedTx = transactionsById.get(dt.transaction_id);
      if (!linkedTx) {
        throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt transaction ${dt.id} references non-existent transaction ${dt.transaction_id}`);
      }

      // Rejection of duplicate links (database unique index uq_debt_tx_transaction_id applies even to soft-deleted records)
      if (allLinkedTxIds.has(dt.transaction_id)) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Duplicate transaction link to ${dt.transaction_id} violates unique index uq_debt_tx_transaction_id.`
        );
      }
      allLinkedTxIds.add(dt.transaction_id);

      // Rejection of active debt movements linked to soft-deleted transactions
      if (dt.deleted_at === null && linkedTx.deleted_at !== null) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Active debt transaction ${dt.id} references soft-deleted transaction ${dt.transaction_id}.`
        );
      }

      // Debt-link amount semantics
      if (dt.amount !== linkedTx.amount) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Debt transaction ${dt.id} amount (${dt.amount}) does not match linked transaction amount (${linkedTx.amount}).`
        );
      }

      // Debt-link currency semantics
      const linkedAccount = accountsById.get(linkedTx.account_id);
      if (linkedAccount && linkedAccount.currency !== debt.currency) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Debt transaction ${dt.id} account currency (${linkedAccount.currency}) does not match debt currency (${debt.currency}).`
        );
      }

      // Debt-link direction semantics
      if (debt.direction === 'lent') {
        if (dt.role === 'disbursement' && linkedTx.type !== 'expense') {
          throw new RestoreError(
            'RESTORE_ERR_INVARIANT_FAILED',
            `Lent debt disbursement ${dt.id} must be an expense transaction, found ${linkedTx.type}.`
          );
        }
        if (dt.role === 'repayment' && linkedTx.type !== 'income') {
          throw new RestoreError(
            'RESTORE_ERR_INVARIANT_FAILED',
            `Lent debt repayment ${dt.id} must be an income transaction, found ${linkedTx.type}.`
          );
        }
      } else if (debt.direction === 'borrowed') {
        if (dt.role === 'disbursement' && linkedTx.type !== 'income') {
          throw new RestoreError(
            'RESTORE_ERR_INVARIANT_FAILED',
            `Borrowed debt disbursement ${dt.id} must be an income transaction, found ${linkedTx.type}.`
          );
        }
        if (dt.role === 'repayment' && linkedTx.type !== 'expense') {
          throw new RestoreError(
            'RESTORE_ERR_INVARIANT_FAILED',
            `Borrowed debt repayment ${dt.id} must be an expense transaction, found ${linkedTx.type}.`
          );
        }
      }

      const expectedCategory = debt.direction === 'lent'
        ? (dt.role === 'disbursement' ? 'cat_exp_loan_given' : 'cat_inc_loan_repayment_received')
        : (dt.role === 'disbursement' ? 'cat_inc_loan_received' : 'cat_exp_loan_repayment');
      if (linkedTx.category_id !== expectedCategory) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Debt transaction ${dt.id} metadata disagrees with stable category ${String(linkedTx.category_id)}; expected ${expectedCategory}.`
        );
      }
    }

    const list = movementsByDebt.get(dt.debt_id) ?? [];
    list.push(dt);
    movementsByDebt.set(dt.debt_id, list);
  }

  // Check each debt's derived balance and lifecycle status
  for (const debt of data.debts) {
    const movements = movementsByDebt.get(debt.id) ?? [];
    let outstanding = debt.original_principal;

    for (const m of movements) {
      if (m.deleted_at !== null) continue;
      if (m.transaction_id) {
        const tx = transactionsById.get(m.transaction_id);
        if (tx && tx.deleted_at !== null) continue;
      }

      if (m.role === 'repayment') {
        outstanding -= m.amount;
      } else if (m.role === 'adjustment_increase') {
        outstanding += m.amount;
      } else if (m.role === 'adjustment_decrease') {
        outstanding -= m.amount;
      }
    }

    if (outstanding < 0) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Debt ${debt.id} has negative outstanding balance (${outstanding}). Ledger corruption detected.`
      );
    }

    // Lifecycle status consistency against derived balance
    if (debt.deleted_at === null) {
      if (debt.status === 'active' && outstanding === 0) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Debt ${debt.id} has status 'active' but derived balance is 0. Status must be 'settled'.`
        );
      }
      if (debt.status === 'settled' && outstanding > 0) {
        throw new RestoreError(
          'RESTORE_ERR_INVARIANT_FAILED',
          `Debt ${debt.id} has status 'settled' but derived balance is ${outstanding}. Status must be 'active'.`
        );
      }
    }
  }

  // 4. Planning ledger integrity.
  const budgetsById = new Map<string, BudgetRow>();
  for (const budget of data.budgets) {
    if (budgetsById.has(budget.id)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate budget ID: ${budget.id}`);
    budgetsById.set(budget.id, budget);
    if (budget.account_id && !accountsById.has(budget.account_id)) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Budget ${budget.id} references missing account ${budget.account_id}.`);
    if (budget.account_id && accountsById.get(budget.account_id)?.currency !== budget.currency) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${budget.id} currency disagrees with its account.`);
  }
  for (const budget of data.budgets) {
    if (budget.rollover_from_budget_id) {
      const previous = budgetsById.get(budget.rollover_from_budget_id);
      if (!previous) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Budget ${budget.id} references missing rollover budget.`);
      if (previous.currency !== budget.currency || previous.ends_on >= budget.starts_on) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${budget.id} has an invalid rollover predecessor.`);
      const visited = new Set<string>([budget.id]);
      let cursor: BudgetRow | undefined = previous;
      while (cursor) {
        if (visited.has(cursor.id)) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${budget.id} has a rollover cycle.`);
        visited.add(cursor.id);
        cursor = cursor.rollover_from_budget_id ? budgetsById.get(cursor.rollover_from_budget_id) : undefined;
      }
    }
  }
  const activeBudgets = data.budgets.filter((b) => b.deleted_at === null && b.archived_at === null);
  for (let i = 0; i < activeBudgets.length; i++) {
    for (let j = i + 1; j < activeBudgets.length; j++) {
      const a = activeBudgets[i]; const b = activeBudgets[j];
      const sameScope = a.currency === b.currency && (a.account_id === null || b.account_id === null || a.account_id === b.account_id);
      if (sameScope && a.starts_on <= b.ends_on && b.starts_on <= a.ends_on) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Active budgets ${a.id} and ${b.id} overlap.`);
    }
  }
  const allocationKeys = new Set<string>();
  const allocationIds = new Set<string>();
  const allocatedByBudget = new Map<string, bigint>();
  for (const item of data.budget_categories) {
    if (allocationIds.has(item.id)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate budget category ID: ${item.id}`);
    allocationIds.add(item.id);
    const budget = budgetsById.get(item.budget_id);
    if (!budget) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Budget category ${item.id} references missing budget.`);
    const category = categoriesById.get(item.category_id);
    if (!category) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Budget category ${item.id} references missing category.`);
    if (category.type !== 'expense') throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget category ${item.id} is not an expense category.`);
    if (item.deleted_at === null) {
      const key = `${item.budget_id}\u0000${item.category_id}`;
      if (allocationKeys.has(key)) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${item.budget_id} repeats category ${item.category_id}.`);
      allocationKeys.add(key);
      allocatedByBudget.set(item.budget_id, (allocatedByBudget.get(item.budget_id) ?? 0n) + BigInt(item.amount));
    }
  }
  for (const budget of data.budgets) {
    const allocated = allocatedByBudget.get(budget.id) ?? 0n;
    if (budget.expense_limit !== null && allocated > BigInt(budget.expense_limit)) {
      throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${budget.id} category plan exceeds its expense limit.`);
    }
    if (budget.income_target === null && budget.expense_limit === null && allocated === 0n) {
      throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Budget ${budget.id} has no meaningful target.`);
    }
  }

  const goalsById = new Map<string, SavingsGoalRow>();
  for (const goal of data.savings_goals) {
    if (goalsById.has(goal.id)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate savings goal ID: ${goal.id}`);
    goalsById.set(goal.id, goal);
    if (goal.linked_account_id) {
      const account = accountsById.get(goal.linked_account_id);
      if (!account) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Savings goal ${goal.id} references missing account.`);
      if (account.currency !== goal.currency) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal ${goal.id} currency disagrees with its account.`);
    }
  }
  const goalEntryIds = new Set<string>();
  const permanentlyLinkedTransactions = new Set<string>();
  const activeAmounts = new Map<string, bigint>();
  for (const entry of data.savings_goal_entries) {
    if (goalEntryIds.has(entry.id)) throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate savings goal entry ID: ${entry.id}`);
    goalEntryIds.add(entry.id);
    const goal = goalsById.get(entry.goal_id);
    if (!goal) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Savings goal entry ${entry.id} references missing goal.`);
    if (entry.transaction_id) {
      if (permanentlyLinkedTransactions.has(entry.transaction_id)) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Transaction ${entry.transaction_id} supports multiple historical savings entries.`);
      permanentlyLinkedTransactions.add(entry.transaction_id);
      const tx = transactionsById.get(entry.transaction_id);
      if (!tx) throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Savings goal entry ${entry.id} references missing transaction.`);
      const expectedRole = entry.entry_type === 'contribution' ? 'destination' : 'source';
      if (!goal.linked_account_id || tx.account_id !== goal.linked_account_id) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal entry ${entry.id} evidence is outside the linked account.`);
      if (tx.type !== 'transfer' || tx.transfer_role !== expectedRole || tx.amount !== entry.amount || tx.timestamp !== entry.occurred_at || tx.occurred_on !== entry.occurred_on) {
        throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal entry ${entry.id} evidence metadata disagrees.`);
      }
      const pair = tx.transfer_id ? transfersByTransferId.get(tx.transfer_id) : undefined;
      if (!pair || pair.length !== 2 || !pair.some((leg) => leg.id !== tx.id && leg.account_id === tx.related_account_id && leg.related_account_id === tx.account_id && leg.amount === tx.amount && leg.timestamp === tx.timestamp && leg.occurred_on === tx.occurred_on && leg.deleted_at === tx.deleted_at)) {
        throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal entry ${entry.id} has invalid paired evidence.`);
      }
      const evidenceDeleted = tx.deleted_at !== null;
      const cascadeDeleted = entry.cascade_deleted_at !== null;
      if (entry.deleted_at === null && evidenceDeleted) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Active savings entry ${entry.id} references deleted evidence.`);
      if (entry.link_mode === 'owned_transfer' && ((entry.deleted_at !== null) !== evidenceDeleted || cascadeDeleted !== evidenceDeleted)) {
        throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Owned savings transfer ${entry.id} deletion ownership disagrees.`);
      }
      if (entry.link_mode === 'existing_transfer' && (cascadeDeleted !== evidenceDeleted || (cascadeDeleted && entry.deleted_at === null))) {
        throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Existing savings transfer ${entry.id} deletion state disagrees.`);
      }
    }
    if (entry.deleted_at === null) {
      const signed = entry.entry_type === 'contribution' ? BigInt(entry.amount) : -BigInt(entry.amount);
      const next = (activeAmounts.get(entry.goal_id) ?? 0n) + signed;
      if (next < 0n) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal ${entry.goal_id} has a negative allocation.`);
      activeAmounts.set(entry.goal_id, next);
    }
  }
  for (const goal of data.savings_goals) {
    if (goal.deleted_at !== null) continue;
    const completed = (activeAmounts.get(goal.id) ?? 0n) >= BigInt(goal.target_amount);
    if ((goal.lifecycle_status === 'completed') !== completed) throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Savings goal ${goal.id} lifecycle disagrees with its allocation.`);
  }

  // 5. Migration Ledger Uniqueness and Canonical Checksum Enforcement
  const migrationVersions = new Set<number>();
  for (const m of data.schema_migrations) {
    if (migrationVersions.has(m.version)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate migration version in backup ledger: ${m.version}`);
    }
    migrationVersions.add(m.version);

    const expectedChecksum = CANONICAL_MIGRATION_CHECKSUMS[m.version];
    if (expectedChecksum && m.checksum && m.checksum !== expectedChecksum) {
      throw new RestoreError(
        'RESTORE_ERR_CHECKSUM_MISMATCH',
        `Migration ${m.version} checksum in backup (${m.checksum}) does not match canonical checksum (${expectedChecksum}).`
      );
    }
  }
}
