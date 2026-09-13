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
 * - Debt ledger non-negative principal invariant
 * - Zero silent repairs: any single violation aborts the restore (ADR-016)
 */

import {
  AccountRow,
  CategoryRow,
  TransactionRow,
  CounterpartyRow,
  DebtRow,
  DebtTransactionRow,
} from '../../db/types';
import {
  BackupPayloadData,
  SchemaMigrationRow,
  RestoreError,
} from './types';
import { isValidCivilDate } from '../../db/migrations/004_debt_ledger_integrity_upgrade';

// ID validator: non-empty string, reasonable length (e.g. 1 to 128 characters)
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.length <= 128;
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

// Currency code validator (3 uppercase letters, e.g. BDT, USD)
function isValidCurrency(val: unknown): val is string {
  return typeof val === 'string' && /^[A-Z]{3}$/.test(val);
}

// Safe timestamp validator
function isValidTimestamp(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0 && val <= 253402300799000;
}

/**
 * Validates an AccountRow
 */
export function validateAccountRow(row: unknown, index: number): AccountRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid account record at index ${index}.`);
  }
  const a = row as Record<string, unknown>;

  if (!isValidId(a.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Account at index ${index} has invalid id: ${String(a.id)}`);
  }
  if (typeof a.name !== 'string' || a.name.trim().length === 0 || a.name.length > 256) {
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

  return {
    id: a.id,
    name: a.name.trim(),
    type: a.type as AccountRow['type'],
    initial_balance: a.initial_balance,
    currency: a.currency,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

/**
 * Validates a CategoryRow
 */
export function validateCategoryRow(row: unknown, index: number): CategoryRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid category record at index ${index}.`);
  }
  const c = row as Record<string, unknown>;

  if (!isValidId(c.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Category at index ${index} has invalid id.`);
  }
  if (typeof c.name_key !== 'string' || c.name_key.trim().length === 0) {
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
    name_key: c.name_key.trim(),
    name_custom: typeof c.name_custom === 'string' ? c.name_custom.trim() : null,
    icon: typeof c.icon === 'string' ? c.icon.trim() : null,
    color: typeof c.color === 'string' ? c.color.trim() : null,
    type: c.type,
    is_archived: c.is_archived,
    sort_order: c.sort_order,
    is_default: c.is_default,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/**
 * Validates a TransactionRow
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
    created_at: t.created_at,
    updated_at: t.updated_at,
    deleted_at: typeof t.deleted_at === 'number' ? t.deleted_at : null,
  };
}

/**
 * Validates a CounterpartyRow
 */
export function validateCounterpartyRow(row: unknown, index: number): CounterpartyRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid counterparty record at index ${index}.`);
  }
  const cp = row as Record<string, unknown>;

  if (!isValidId(cp.id)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Counterparty at index ${index} has invalid id.`);
  }
  if (typeof cp.name !== 'string' || cp.name.trim().length === 0 || cp.name.length > 256) {
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
    name: cp.name.trim(),
    type: cp.type as CounterpartyRow['type'],
    phone: typeof cp.phone === 'string' ? cp.phone.trim() : null,
    email: typeof cp.email === 'string' ? cp.email.trim() : null,
    note: typeof cp.note === 'string' ? cp.note : null,
    avatar_color: typeof cp.avatar_color === 'string' ? cp.avatar_color : null,
    is_archived: cp.is_archived,
    created_at: cp.created_at,
    updated_at: cp.updated_at,
  };
}

/**
 * Validates a DebtRow
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
    if (!isValidCivilDate(d.due_date)) {
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
 * Validates a DebtTransactionRow
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
 * Validates a SchemaMigrationRow
 */
export function validateSchemaMigrationRow(row: unknown, index: number): SchemaMigrationRow {
  if (!row || typeof row !== 'object') {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Invalid migration record at index ${index}.`);
  }
  const m = row as Record<string, unknown>;

  if (!isPositiveSafeInteger(m.version)) {
    throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Migration record at index ${index} has invalid version.`);
  }
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
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
    name: m.name.trim(),
    applied_at: m.applied_at,
    checksum: typeof m.checksum === 'string' ? m.checksum.trim() : null,
  };
}

/**
 * Validates cross-table relations and invariants across the entire restored dataset.
 */
export function validatePayloadInvariants(data: BackupPayloadData): void {
  // 1. Uniqueness of Primary Keys
  const accountIds = new Set<string>();
  for (const a of data.accounts) {
    if (accountIds.has(a.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate account ID: ${a.id}`);
    }
    accountIds.add(a.id);
  }

  const categoryIds = new Set<string>();
  for (const c of data.categories) {
    if (categoryIds.has(c.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate category ID: ${c.id}`);
    }
    categoryIds.add(c.id);
  }

  const counterpartyIds = new Set<string>();
  for (const cp of data.counterparties) {
    if (counterpartyIds.has(cp.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate counterparty ID: ${cp.id}`);
    }
    counterpartyIds.add(cp.id);
  }

  const debtIds = new Set<string>();
  for (const d of data.debts) {
    if (debtIds.has(d.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate debt ID: ${d.id}`);
    }
    debtIds.add(d.id);
    if (!counterpartyIds.has(d.counterparty_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt ${d.id} references non-existent counterparty ${d.counterparty_id}`);
    }
  }

  const transactionIds = new Set<string>();
  const transfersByTransferId = new Map<string, TransactionRow[]>();

  for (const tx of data.transactions) {
    if (transactionIds.has(tx.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate transaction ID: ${tx.id}`);
    }
    transactionIds.add(tx.id);

    // FK checks
    if (!accountIds.has(tx.account_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent account ${tx.account_id}`);
    }
    if (tx.category_id && !categoryIds.has(tx.category_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent category ${tx.category_id}`);
    }
    if (tx.related_account_id && !accountIds.has(tx.related_account_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Transaction ${tx.id} references non-existent related_account ${tx.related_account_id}`);
    }

    if (tx.transfer_id) {
      const list = transfersByTransferId.get(tx.transfer_id) ?? [];
      list.push(tx);
      transfersByTransferId.set(tx.transfer_id, list);
    }
  }

  // 2. Transfer Pair Integrity
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
    if (t1.account_id !== t2.related_account_id || t2.account_id !== t1.related_account_id) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Transfer ${transferId} cross-account references do not match.`
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

  // 3. Debt Ledger Integrity & Non-Negative Principal
  const debtTxIds = new Set<string>();
  const linkedTxIds = new Set<string>();
  const movementsByDebt = new Map<string, DebtTransactionRow[]>();

  for (const dt of data.debt_transactions) {
    if (debtTxIds.has(dt.id)) {
      throw new RestoreError('RESTORE_ERR_SCHEMA_VALIDATION', `Duplicate debt transaction ID: ${dt.id}`);
    }
    debtTxIds.add(dt.id);

    if (!debtIds.has(dt.debt_id)) {
      throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt transaction ${dt.id} references non-existent debt ${dt.debt_id}`);
    }

    if (dt.transaction_id) {
      if (!transactionIds.has(dt.transaction_id)) {
        throw new RestoreError('RESTORE_ERR_FK_CHECK_FAILED', `Debt transaction ${dt.id} references non-existent transaction ${dt.transaction_id}`);
      }
      if (dt.deleted_at === null) {
        if (linkedTxIds.has(dt.transaction_id)) {
          throw new RestoreError('RESTORE_ERR_INVARIANT_FAILED', `Duplicate active link to transaction ${dt.transaction_id}`);
        }
        linkedTxIds.add(dt.transaction_id);
      }
    }

    const list = movementsByDebt.get(dt.debt_id) ?? [];
    list.push(dt);
    movementsByDebt.set(dt.debt_id, list);
  }

  // Check each debt's outstanding balance
  for (const debt of data.debts) {
    if (debt.deleted_at !== null) continue; // Skip soft-deleted debts from active balance invariant

    const movements = movementsByDebt.get(debt.id) ?? [];
    let outstanding = debt.original_principal;

    for (const m of movements) {
      if (m.deleted_at !== null) continue;

      if (m.role === 'repayment') {
        outstanding -= m.amount;
      } else if (m.role === 'adjustment_increase') {
        outstanding += m.amount;
      } else if (m.role === 'adjustment_decrease') {
        outstanding -= m.amount;
      }
      // Note: opening_balance and disbursement mirror principal, not altering original_principal baseline
    }

    if (outstanding < 0) {
      throw new RestoreError(
        'RESTORE_ERR_INVARIANT_FAILED',
        `Debt ${debt.id} has negative outstanding balance (${outstanding}). Ledger corruption detected.`
      );
    }
  }
}
