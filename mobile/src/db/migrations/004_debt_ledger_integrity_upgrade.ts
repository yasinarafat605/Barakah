import { Migration, DatabaseConnection } from '../types';

/**
 * Strict calendar date validation that round-trips year, month, and day without JavaScript rollover.
 * Validates real calendar dates in YYYY-MM-DD format (including leap years, range 1000-9999).
 */
export function isValidCivilDate(dateStr: unknown): dateStr is string {
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

function convertNumericTimestamp(num: number, originalInput: unknown): string {
  if (!Number.isFinite(num) || !Number.isSafeInteger(num) || num <= 0) {
    throw new Error(
      `Migration 004 invalid numeric due_date timestamp: ${String(originalInput)}. Must be a positive safe integer.`
    );
  }

  // If epoch seconds (< 100000000000), convert to ms
  const ms = num < 100000000000 ? num * 1000 : num;

  if (!Number.isSafeInteger(ms) || ms > 253402300799000) {
    throw new Error(
      `Migration 004 due_date timestamp exceeds supported date range: ${String(originalInput)}`
    );
  }

  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    throw new Error(
      `Migration 004 due_date timestamp produced invalid Date: ${String(originalInput)}`
    );
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const civilDate = `${year}-${month}-${day}`;

  if (!isValidCivilDate(civilDate)) {
    throw new Error(
      `Migration 004 converted due_date timestamp ${String(originalInput)} produced invalid civil date: "${civilDate}"`
    );
  }

  return civilDate;
}

/**
 * Converts legacy integer or text due_date to a civil date string (YYYY-MM-DD).
 * Uses local calendar components (getFullYear, getMonth, getDate) to preserve
 * the exact civil date the user entered on their device, preventing timezone shifts.
 *
 * Strict validation:
 * - null or undefined returns null.
 * - Valid YYYY-MM-DD string is validated with isValidCivilDate() and returned.
 * - Valid numeric timestamp (finite, safe integer, positive, within range) is converted to YYYY-MM-DD and validated.
 * - Corrupted non-null data is NEVER silently converted to null; it throws an Error,
 *   triggering complete migration rollback.
 */
export function convertLegacyDueDateToCivilDate(dueDate: unknown): string | null {
  if (dueDate === null || dueDate === undefined) {
    return null;
  }

  if (typeof dueDate === 'string') {
    const trimmed = dueDate.trim();
    if (isValidCivilDate(trimmed)) {
      return trimmed;
    }

    // Check if it's a numeric string representing an epoch timestamp
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return convertNumericTimestamp(parsed, dueDate);
    }

    throw new Error(
      `Migration 004 invalid due_date string: "${dueDate}". Must be a valid YYYY-MM-DD civil date or positive integer timestamp.`
    );
  }

  if (typeof dueDate === 'number') {
    return convertNumericTimestamp(dueDate, dueDate);
  }

  throw new Error(
    `Migration 004 invalid due_date value of type ${typeof dueDate}: ${String(dueDate)}`
  );
}

async function applyMigration004(db: DatabaseConnection): Promise<void> {
  // Step 1: Pre-migration metrics and schema inspection
  const debtsCountBefore = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM debts;'
  );
  const debtTxCountBefore = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM debt_transactions;'
  );

  // Check if archived_at column already exists in source debts table
  const debtsColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(debts);');
  const hasArchivedAt = debtsColumns.some((col) => col.name === 'archived_at');

  // Step 2: Validate ledger history and calculate lifecycle state for each debt
  // Exclude soft-deleted debt movements (dt.deleted_at IS NOT NULL)
  // Exclude linked transactions when the transaction is soft-deleted (tx.deleted_at IS NOT NULL)
  // Apply legacy adjustment semantics (notes with 'increase' or 'add' increase debt; else decrease)
  // Check for negative balances and throw immediately to roll back
  const legacyDebts = await db.getAllAsync<{
    id: string;
    counterparty_id: string;
    direction: 'borrowed' | 'lent';
    original_principal: number;
    currency: string;
    opening_mode: string;
    opened_at: number;
    due_date: unknown;
    status: string;
    note: string | null;
    created_at: number;
    updated_at: number;
    archived_at?: number | null;
    deleted_at?: number | null;
    total_repaid: number;
  }>(`
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
      ${hasArchivedAt ? 'd.archived_at' : 'NULL AS archived_at'},
      d.deleted_at,
      COALESCE(SUM(
        CASE
          WHEN dt.deleted_at IS NOT NULL THEN 0
          WHEN dt.transaction_id IS NOT NULL AND tx.deleted_at IS NOT NULL THEN 0
          WHEN dt.role = 'repayment' THEN dt.amount
          WHEN dt.role = 'adjustment_decrease' THEN dt.amount
          WHEN dt.role = 'adjustment_increase' THEN -dt.amount
          WHEN dt.role = 'adjustment' AND (dt.note LIKE '%increase%' OR dt.note LIKE '%add%') THEN -dt.amount
          WHEN dt.role = 'adjustment' THEN dt.amount
          ELSE 0
        END
      ), 0) AS total_repaid
    FROM debts d
    LEFT JOIN debt_transactions dt ON d.id = dt.debt_id
    LEFT JOIN transactions tx ON dt.transaction_id = tx.id
    GROUP BY d.id;
  `);

  const processedDebts = legacyDebts.map((d) => {
    const originalPrincipal = Number(d.original_principal);
    if (!Number.isSafeInteger(originalPrincipal) || originalPrincipal <= 0) {
      throw new Error(
        `Migration 004 integrity check failed: Debt ${d.id} has invalid original_principal (${d.original_principal}). Rolling back migration.`
      );
    }

    const totalRepaid = Number(d.total_repaid);
    if (!Number.isSafeInteger(totalRepaid)) {
      throw new Error(
        `Migration 004 integrity check failed: Debt ${d.id} has invalid total_repaid (${totalRepaid}). Rolling back migration.`
      );
    }

    const outstanding = originalPrincipal - totalRepaid;

    if (outstanding < 0) {
      throw new Error(
        `Migration 004 integrity check failed: Debt ${d.id} has corrupted negative outstanding balance (${outstanding}). Rolling back migration.`
      );
    }

    // Recalculate lifecycle status for EVERY migrated debt from derived outstanding balance:
    // derived outstanding > 0 → active
    // derived outstanding = 0 → settled
    // derived outstanding < 0 → migration failure (handled above)
    const targetStatus: 'active' | 'settled' = outstanding === 0 ? 'settled' : 'active';

    // Preserve archival state independently:
    // legacy archived → archived_at remains populated
    // legacy not archived → archived_at remains null
    let targetArchivedAt: number | null = null;
    const isLegacyArchived =
      d.status === 'archived' ||
      (d.archived_at !== null && d.archived_at !== undefined && d.archived_at !== 0);

    if (isLegacyArchived) {
      const candidate = d.archived_at ?? d.updated_at ?? d.created_at ?? Date.now();
      const numCandidate = Number(candidate);
      if (!Number.isSafeInteger(numCandidate) || numCandidate <= 0) {
        throw new Error(
          `Migration 004 integrity check failed: Debt ${d.id} has invalid archived_at timestamp (${candidate}). Rolling back migration.`
        );
      }
      targetArchivedAt = numCandidate;
    } else {
      targetArchivedAt = null;
    }

    const civilDueDate = convertLegacyDueDateToCivilDate(d.due_date);

    return {
      ...d,
      original_principal: originalPrincipal,
      status: targetStatus,
      archived_at: targetArchivedAt,
      due_date: civilDueDate,
    };
  });

  // Step 3: Populate staging backup tables (without foreign key constraints)
  await db.execAsync(`
    CREATE TABLE _backup_counterparties (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      note TEXT,
      avatar_color TEXT,
      is_archived INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO _backup_counterparties (
      id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at
    )
    SELECT
      id, name, type, phone, email, note, avatar_color, is_archived,
      CAST(created_at AS INTEGER), CAST(updated_at AS INTEGER)
    FROM counterparties;

    CREATE TABLE _backup_debts (
      id TEXT PRIMARY KEY NOT NULL,
      counterparty_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      original_principal INTEGER NOT NULL,
      currency TEXT NOT NULL,
      opening_mode TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE _backup_debt_tx (
      id TEXT PRIMARY KEY NOT NULL,
      debt_id TEXT NOT NULL,
      transaction_id TEXT,
      amount INTEGER NOT NULL,
      role TEXT NOT NULL,
      note TEXT,
      occurred_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    INSERT INTO _backup_debt_tx (
      id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
    )
    SELECT
      id,
      debt_id,
      transaction_id,
      CAST(amount AS INTEGER),
      CASE
        WHEN role = 'disbursement' AND transaction_id IS NULL THEN 'opening_balance'
        WHEN role = 'adjustment' THEN
          CASE WHEN note LIKE '%increase%' OR note LIKE '%add%' THEN 'adjustment_increase' ELSE 'adjustment_decrease' END
        ELSE role
      END,
      note,
      CAST(occurred_at AS INTEGER),
      CAST(created_at AS INTEGER),
      CAST(updated_at AS INTEGER),
      CASE WHEN deleted_at IS NOT NULL THEN CAST(deleted_at AS INTEGER) ELSE NULL END
    FROM debt_transactions;
  `);

  for (const debt of processedDebts) {
    await db.runAsync(
      `INSERT INTO _backup_debts (
        id, counterparty_id, direction, original_principal, currency, opening_mode,
        opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      debt.id,
      debt.counterparty_id,
      debt.direction,
      debt.original_principal,
      debt.currency,
      debt.opening_mode,
      Math.floor(Number(debt.opened_at)),
      debt.due_date,
      debt.status,
      debt.note,
      Math.floor(Number(debt.created_at)),
      Math.floor(Number(debt.updated_at)),
      debt.archived_at !== null ? Math.floor(debt.archived_at) : null,
      debt.deleted_at ? Math.floor(Number(debt.deleted_at)) : null
    );
  }

  // Step 4: Drop old tables in reverse foreign key order
  // When debt_transactions is dropped, nothing references debts.
  // When debts is dropped, nothing references counterparties.
  // This is 100% safe with PRAGMA foreign_keys = ON!
  await db.execAsync(`
    DROP TABLE debt_transactions;
    DROP TABLE debts;
    DROP TABLE counterparties;
  `);

  // Step 5: Rebuild counterparties table with strict integer timestamp constraints
  await db.execAsync(`
    CREATE TABLE counterparties (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('person', 'business', 'organisation', 'other')),
      phone TEXT,
      email TEXT,
      note TEXT,
      avatar_color TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
      updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer')
    );

    INSERT INTO counterparties (
      id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at
    )
    SELECT
      id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at
    FROM _backup_counterparties;

    DROP TABLE _backup_counterparties;
  `);

  // Step 6: Rebuild debts table with target schema and constraints
  await db.execAsync(`
    CREATE TABLE debts (
      id TEXT PRIMARY KEY NOT NULL,
      counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
      direction TEXT NOT NULL CHECK (direction IN ('borrowed', 'lent')),
      original_principal INTEGER NOT NULL CHECK (typeof(original_principal) = 'integer' AND original_principal > 0),
      currency TEXT NOT NULL DEFAULT 'BDT',
      opening_mode TEXT NOT NULL CHECK (opening_mode IN ('new_with_cash', 'existing_balance')),
      opened_at INTEGER NOT NULL CHECK (typeof(opened_at) = 'integer'),
      due_date TEXT CHECK (due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
      status TEXT NOT NULL CHECK (status IN ('active', 'settled')),
      note TEXT,
      created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
      updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
      archived_at INTEGER CHECK (archived_at IS NULL OR typeof(archived_at) = 'integer'),
      deleted_at INTEGER CHECK (deleted_at IS NULL OR typeof(deleted_at) = 'integer')
    );

    INSERT INTO debts (
      id, counterparty_id, direction, original_principal, currency, opening_mode,
      opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at
    )
    SELECT
      id, counterparty_id, direction, original_principal, currency, opening_mode,
      opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at
    FROM _backup_debts;

    DROP TABLE _backup_debts;
  `);

  // Step 7: Rebuild debt_transactions table with target schema, link constraints, and opening_balance
  await db.execAsync(`
    CREATE TABLE debt_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
      transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
      role TEXT NOT NULL CHECK (role IN ('disbursement', 'repayment', 'adjustment_increase', 'adjustment_decrease', 'opening_balance')),
      note TEXT,
      occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
      created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
      updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
      deleted_at INTEGER CHECK (deleted_at IS NULL OR typeof(deleted_at) = 'integer'),
      CONSTRAINT chk_debt_tx_link_role CHECK (
        (role IN ('disbursement', 'repayment') AND transaction_id IS NOT NULL)
        OR
        (role IN ('adjustment_increase', 'adjustment_decrease', 'opening_balance') AND transaction_id IS NULL)
      )
    );

    INSERT INTO debt_transactions (
      id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
    )
    SELECT
      id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
    FROM _backup_debt_tx;

    DROP TABLE _backup_debt_tx;
  `);

  // Step 8: Recreate all indexes
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
    CREATE INDEX IF NOT EXISTS idx_counterparties_archived ON counterparties(is_archived);

    CREATE INDEX IF NOT EXISTS idx_debts_counterparty_id ON debts(counterparty_id);
    CREATE INDEX IF NOT EXISTS idx_debts_direction ON debts(direction);
    CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
    CREATE INDEX IF NOT EXISTS idx_debts_due_date ON debts(due_date);
    CREATE INDEX IF NOT EXISTS idx_debts_archived_at ON debts(archived_at);
    CREATE INDEX IF NOT EXISTS idx_debts_deleted_at ON debts(deleted_at);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_tx_transaction_id ON debt_transactions(transaction_id) WHERE transaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_debt_tx_debt_id ON debt_transactions(debt_id);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_transaction_id ON debt_transactions(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_role ON debt_transactions(role);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_deleted_at ON debt_transactions(deleted_at);
  `);

  // Verification: Post-migration row count validation (100% row preservation)
  const debtsCountAfter = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM debts;'
  );
  const debtTxCountAfter = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM debt_transactions;'
  );

  if ((debtsCountBefore?.count ?? 0) !== (debtsCountAfter?.count ?? 0)) {
    throw new Error(
      `Migration 004 row count mismatch for debts: before=${debtsCountBefore?.count}, after=${debtsCountAfter?.count}`
    );
  }
  if ((debtTxCountBefore?.count ?? 0) !== (debtTxCountAfter?.count ?? 0)) {
    throw new Error(
      `Migration 004 row count mismatch for debt_transactions: before=${debtTxCountBefore?.count}, after=${debtTxCountAfter?.count}`
    );
  }

  // Verification: PRAGMA foreign_key_check
  const fkViolations = await db.getAllAsync<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>('PRAGMA foreign_key_check;');

  if (fkViolations.length > 0) {
    throw new Error(
      `Migration 004 foreign key check failed: ${fkViolations.length} violation(s) detected (${JSON.stringify(
        fkViolations
      )})`
    );
  }
}

export const migration004: Migration = {
  version: 4,
  name: '004_debt_ledger_integrity_upgrade',
  up: applyMigration004,
};
