-- 003_debts_and_counterparties.sql
-- Migration 003: Create counterparties, debts, and debt_transactions tables
-- Strict compliance with ADR-001 (Local-first), ADR-004 (Integer minor units), ADR-005 (Double-entry)

-- 1. Create Counterparties Table (Neutral: person, business, organisation, other)
CREATE TABLE IF NOT EXISTS counterparties (
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

CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
CREATE INDEX IF NOT EXISTS idx_counterparties_archived ON counterparties(is_archived);

-- 2. Create Debts Table
-- Lifecycle: status IN ('active', 'settled')
-- Archival: archived_at (nullable Unix ms timestamp)
-- Due date: civil calendar date YYYY-MM-DD (immune to device timezone / DST shifts)
CREATE TABLE IF NOT EXISTS debts (
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

CREATE INDEX IF NOT EXISTS idx_debts_counterparty_id ON debts(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_debts_direction ON debts(direction);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
CREATE INDEX IF NOT EXISTS idx_debts_due_date ON debts(due_date);
CREATE INDEX IF NOT EXISTS idx_debts_archived_at ON debts(archived_at);
CREATE INDEX IF NOT EXISTS idx_debts_deleted_at ON debts(deleted_at);

-- 3. Create Debt Transactions (Ledger Link) Table
-- Explicit adjustment semantics: adjustment_increase (increases principal owed), adjustment_decrease (decreases principal owed)
CREATE TABLE IF NOT EXISTS debt_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  role TEXT NOT NULL CHECK (role IN ('disbursement', 'repayment', 'adjustment_increase', 'adjustment_decrease')),
  note TEXT,
  occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR typeof(deleted_at) = 'integer')
);

-- Unique index ensuring one cash transaction cannot link to multiple debt movements
CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_tx_transaction_id ON debt_transactions(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debt_tx_debt_id ON debt_transactions(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_transaction_id ON debt_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_role ON debt_transactions(role);
CREATE INDEX IF NOT EXISTS idx_debt_tx_deleted_at ON debt_transactions(deleted_at);
