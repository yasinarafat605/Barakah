-- 003_debts_and_counterparties.sql
-- Migration 003: Initial counterparties, debts, and debt_transactions tables
-- Phase 3 initial baseline schema

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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
CREATE INDEX IF NOT EXISTS idx_counterparties_archived ON counterparties(is_archived);

-- 2. Create Debts Table (Initial v1: due_date INTEGER, status active|settled|archived)
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY NOT NULL,
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('borrowed', 'lent')),
  original_principal INTEGER NOT NULL CHECK (typeof(original_principal) = 'integer' AND original_principal > 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  opening_mode TEXT NOT NULL CHECK (opening_mode IN ('new_with_cash', 'existing_balance')),
  opened_at INTEGER NOT NULL,
  due_date INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'archived')),
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_debts_counterparty_id ON debts(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_debts_direction ON debts(direction);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);
CREATE INDEX IF NOT EXISTS idx_debts_due_date ON debts(due_date);
CREATE INDEX IF NOT EXISTS idx_debts_deleted_at ON debts(deleted_at);

-- 3. Create Debt Transactions (Initial v1: role disbursement|repayment|adjustment)
CREATE TABLE IF NOT EXISTS debt_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  role TEXT NOT NULL CHECK (role IN ('disbursement', 'repayment', 'adjustment')),
  note TEXT,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_debt_tx_debt_id ON debt_transactions(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_transaction_id ON debt_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_debt_tx_role ON debt_transactions(role);
CREATE INDEX IF NOT EXISTS idx_debt_tx_deleted_at ON debt_transactions(deleted_at);
