-- 004_debt_ledger_integrity_upgrade.sql
-- Migration 004: Upgrade debts and debt_transactions to strict ledger integrity schema
-- Enforces:
-- 1. Lifecycle status IN ('active', 'settled') with independent archived_at timestamp
-- 2. Civil calendar due_date YYYY-MM-DD
-- 3. Explicit adjustment roles (adjustment_increase, adjustment_decrease)
-- 4. Strict link-role semantics: disbursement and repayment require transaction_id NOT NULL;
--    adjustments require transaction_id IS NULL
-- 5. Unique index on debt_transactions(transaction_id)
-- 6. Strict integer typeof constraints on all timestamps and amounts

PRAGMA foreign_keys = OFF;

-- 1. Rebuild counterparties table
CREATE TABLE IF NOT EXISTS counterparties_new (
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

INSERT INTO counterparties_new (
  id, name, type, phone, email, note, avatar_color, is_archived, created_at, updated_at
)
SELECT
  id, name, type, phone, email, note, avatar_color, is_archived,
  CAST(created_at AS INTEGER), CAST(updated_at AS INTEGER)
FROM counterparties;

DROP TABLE counterparties;
ALTER TABLE counterparties_new RENAME TO counterparties;

CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
CREATE INDEX IF NOT EXISTS idx_counterparties_archived ON counterparties(is_archived);

-- 2. Rebuild debts table
CREATE TABLE IF NOT EXISTS debts_new (
  id TEXT PRIMARY KEY NOT NULL,
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('borrowed', 'lent')),
  original_principal INTEGER NOT NULL CHECK (typeof(original_principal) = 'integer' AND original_principal > 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  opening_mode TEXT NOT NULL CHECK (opening_mode IN ('new_with_cash', 'existing_balance')),
  opened_at INTEGER NOT NULL CHECK (typeof(opened_at) = 'integer'),
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('active', 'settled')),
  note TEXT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  archived_at INTEGER CHECK (archived_at IS NULL OR typeof(archived_at) = 'integer'),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR typeof(deleted_at) = 'integer')
);

INSERT INTO debts_new (
  id, counterparty_id, direction, original_principal, currency, opening_mode,
  opened_at, due_date, status, note, created_at, updated_at, archived_at, deleted_at
)
SELECT
  id,
  counterparty_id,
  direction,
  CAST(original_principal AS INTEGER),
  currency,
  opening_mode,
  CAST(opened_at AS INTEGER),
  CASE
    WHEN due_date IS NULL THEN NULL
    WHEN typeof(due_date) = 'text' AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN due_date
    WHEN typeof(due_date) = 'integer' AND due_date > 100000000000 THEN strftime('%Y-%m-%d', due_date / 1000, 'unixepoch')
    WHEN typeof(due_date) = 'integer' AND due_date > 0 THEN strftime('%Y-%m-%d', due_date, 'unixepoch')
    ELSE NULL
  END,
  CASE
    WHEN status = 'archived' THEN 'active'
    WHEN status IN ('active', 'settled') THEN status
    ELSE 'active'
  END,
  note,
  CAST(created_at AS INTEGER),
  CAST(updated_at AS INTEGER),
  CASE
    WHEN status = 'archived' THEN CAST(COALESCE(updated_at, created_at) AS INTEGER)
    ELSE NULL
  END,
  CASE WHEN deleted_at IS NOT NULL THEN CAST(deleted_at AS INTEGER) ELSE NULL END
FROM debts;

DROP TABLE debts;
ALTER TABLE debts_new RENAME TO debts;

CREATE INDEX IF NOT EXISTS idx_debts_counterparty_id ON debts(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_debts_direction ON debts(direction);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
CREATE INDEX IF NOT EXISTS idx_debts_due_date ON debts(due_date);
CREATE INDEX IF NOT EXISTS idx_debts_archived_at ON debts(archived_at);
CREATE INDEX IF NOT EXISTS idx_debts_deleted_at ON debts(deleted_at);

-- 3. Rebuild debt_transactions table
CREATE TABLE IF NOT EXISTS debt_transactions_new (
  id TEXT PRIMARY KEY NOT NULL,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  role TEXT NOT NULL CHECK (role IN ('disbursement', 'repayment', 'adjustment_increase', 'adjustment_decrease')),
  note TEXT,
  occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR typeof(deleted_at) = 'integer'),
  CONSTRAINT chk_debt_tx_link_role CHECK (
    (role IN ('disbursement', 'repayment') AND transaction_id IS NOT NULL)
    OR
    (role IN ('adjustment_increase', 'adjustment_decrease') AND transaction_id IS NULL)
  )
);

INSERT INTO debt_transactions_new (
  id, debt_id, transaction_id, amount, role, note, occurred_at, created_at, updated_at, deleted_at
)
SELECT
  id,
  debt_id,
  transaction_id,
  CAST(amount AS INTEGER),
  CASE
    WHEN role = 'adjustment' THEN
      CASE WHEN note LIKE '%increase%' OR note LIKE '%add%' THEN 'adjustment_increase' ELSE 'adjustment_decrease' END
    ELSE role
  END,
  note,
  CAST(occurred_at AS INTEGER),
  CAST(created_at AS INTEGER),
  CAST(updated_at AS INTEGER),
  CASE WHEN deleted_at IS NOT NULL THEN CAST(deleted_at AS INTEGER) ELSE NULL END
FROM debt_transactions
WHERE NOT (role = 'disbursement' AND transaction_id IS NULL);

DROP TABLE debt_transactions;
ALTER TABLE debt_transactions_new RENAME TO debt_transactions;

CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_tx_transaction_id ON debt_transactions(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debt_tx_debt_id ON debt_transactions(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_transaction_id ON debt_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_role ON debt_transactions(role);
CREATE INDEX IF NOT EXISTS idx_debt_tx_deleted_at ON debt_transactions(deleted_at);

PRAGMA foreign_keys = ON;
