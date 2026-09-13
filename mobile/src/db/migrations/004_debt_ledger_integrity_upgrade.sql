-- 004_debt_ledger_integrity_upgrade.sql
-- Migration 004: Upgrade debts and debt_transactions to strict ledger integrity schema
-- Enforces:
-- 1. Lifecycle status IN ('active', 'settled') with independent archived_at timestamp
--    Derived from valid ledger history: outstanding = 0 -> settled, outstanding > 0 -> active
-- 2. Civil calendar due_date YYYY-MM-DD
-- 3. Explicit adjustment roles (adjustment_increase, adjustment_decrease)
-- 4. Preservation of legacy non-cash opening records as 'opening_balance'
-- 5. Strict link-role semantics:
--    (disbursement, repayment require transaction_id NOT NULL)
--    (adjustments, opening_balance require transaction_id IS NULL)
-- 6. Unique index on debt_transactions(transaction_id)
-- 7. Strict integer typeof constraints on all timestamps and amounts
-- 8. Safe table recreation order using staging tables and reverse FK drop order

-- Step 1: Create staging backup tables without foreign key constraints
CREATE TABLE IF NOT EXISTS _backup_counterparties (
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

CREATE TABLE IF NOT EXISTS _backup_debts (
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

INSERT INTO _backup_debts (
  id, counterparty_id, direction, original_principal, currency, opening_mode,
  opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at
)
SELECT
  d.id,
  d.counterparty_id,
  d.direction,
  CAST(d.original_principal AS INTEGER),
  d.currency,
  d.opening_mode,
  CAST(d.opened_at AS INTEGER),
  CASE
    WHEN d.due_date IS NULL THEN NULL
    WHEN typeof(d.due_date) = 'text' AND length(d.due_date) = 10 AND d.due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN d.due_date
    WHEN typeof(d.due_date) = 'integer' AND d.due_date > 100000000000 THEN strftime('%Y-%m-%d', d.due_date / 1000, 'unixepoch', 'localtime')
    WHEN typeof(d.due_date) = 'integer' AND d.due_date > 0 THEN strftime('%Y-%m-%d', d.due_date, 'unixepoch', 'localtime')
    ELSE NULL
  END,
  CASE
    WHEN (
      d.original_principal - COALESCE((
        SELECT SUM(
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
        )
        FROM debt_transactions dt
        LEFT JOIN transactions tx ON dt.transaction_id = tx.id
        WHERE dt.debt_id = d.id
      ), 0)
    ) <= 0 THEN 'settled'
    ELSE 'active'
  END,
  d.note,
  CAST(d.created_at AS INTEGER),
  CAST(d.updated_at AS INTEGER),
  CASE
    WHEN d.status = 'archived' THEN CAST(COALESCE(d.updated_at, d.created_at) AS INTEGER)
    ELSE NULL
  END,
  CASE WHEN d.deleted_at IS NOT NULL THEN CAST(d.deleted_at AS INTEGER) ELSE NULL END
FROM debts d;

CREATE TABLE IF NOT EXISTS _backup_debt_tx (
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

-- Step 2: Drop old tables in reverse foreign key order
DROP TABLE debt_transactions;
DROP TABLE debts;
DROP TABLE counterparties;

-- Step 3: Rebuild counterparties table with strict constraints
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

-- Step 4: Rebuild debts table with target constraints
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

-- Step 5: Rebuild debt_transactions table with target constraints
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

-- Step 6: Recreate all indexes
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

PRAGMA foreign_key_check;
