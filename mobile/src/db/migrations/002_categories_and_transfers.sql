-- 002_categories_and_transfers.sql
-- Migration 002: Rebuild transactions table with transfer integrity constraints & upgrade categories
-- Strict compliance with ADR-004, ADR-005, and paired transfer ledger specifications.

-- 1. Upgrade categories table schema
ALTER TABLE categories ADD COLUMN name_custom TEXT;
ALTER TABLE categories ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- 2. Create target transactions table with database-level integrity constraints
CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  transfer_id TEXT,
  transfer_role TEXT CHECK (transfer_role IN ('source', 'destination')),
  related_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  note TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  CONSTRAINT chk_tx_transfer_fields CHECK (
    (type = 'transfer' AND transfer_id IS NOT NULL AND transfer_role IS NOT NULL AND related_account_id IS NOT NULL AND category_id IS NULL AND related_account_id <> account_id)
    OR
    (type IN ('income', 'expense') AND transfer_id IS NULL AND transfer_role IS NULL AND related_account_id IS NULL AND category_id IS NOT NULL)
  )
);

-- 3. Copy existing transactions into new table
INSERT INTO transactions_new (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
SELECT id, account_id, category_id, amount, type, NULL, NULL, NULL, note, timestamp, created_at, created_at, NULL
FROM transactions;

-- 4. Replace old transactions table
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- 5. Recreate indexes
CREATE UNIQUE INDEX idx_transactions_transfer_pair ON transactions(transfer_id, transfer_role) WHERE transfer_id IS NOT NULL;
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX idx_transactions_transfer_id ON transactions(transfer_id);
CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at);
