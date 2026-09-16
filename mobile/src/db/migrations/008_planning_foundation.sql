-- 008_planning_foundation.sql
-- Phase 5: stable civil dates, account archival, budgets and savings-goal allocations.

ALTER TABLE accounts ADD COLUMN archived_at INTEGER
  CHECK (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at > 0));

ALTER TABLE transactions ADD COLUMN occurred_on TEXT;

-- Legacy transactions did not preserve a separate civil date. UTC is the only
-- deterministic timezone-independent date derivable from the stored instant.
UPDATE transactions
SET occurred_on = strftime('%Y-%m-%d', CAST(timestamp / 1000 AS INTEGER), 'unixepoch');

CREATE TRIGGER trg_transactions_occurred_on_insert
BEFORE INSERT ON transactions
WHEN NEW.occurred_on IS NOT NULL AND NOT (
  length(NEW.occurred_on) = 10
  AND substr(NEW.occurred_on, 5, 1) = '-'
  AND substr(NEW.occurred_on, 8, 1) = '-'
  AND substr(NEW.occurred_on, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
  AND substr(NEW.occurred_on, 6, 2) GLOB '[0-9][0-9]'
  AND substr(NEW.occurred_on, 9, 2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
  AND CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.occurred_on, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
    WHEN (
      CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 400 = 0
      OR (
        CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 4 = 0
        AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 100 <> 0
      )
    ) THEN 29
    ELSE 28
  END
)
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_CIVIL_DATE');
END;

-- SQL written by older callers is upgraded deterministically at the database
-- boundary. Current application writes always supply the user's civil date.
CREATE TRIGGER trg_transactions_occurred_on_default
AFTER INSERT ON transactions
WHEN NEW.occurred_on IS NULL
BEGIN
  UPDATE transactions
  SET occurred_on = strftime('%Y-%m-%d', CAST(NEW.timestamp / 1000 AS INTEGER), 'unixepoch')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_transactions_occurred_on_update
BEFORE UPDATE ON transactions
WHEN NEW.occurred_on IS NULL OR NOT (
  length(NEW.occurred_on) = 10
  AND substr(NEW.occurred_on, 5, 1) = '-'
  AND substr(NEW.occurred_on, 8, 1) = '-'
  AND substr(NEW.occurred_on, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
  AND substr(NEW.occurred_on, 6, 2) GLOB '[0-9][0-9]'
  AND substr(NEW.occurred_on, 9, 2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
  AND CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.occurred_on, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
    WHEN (
      CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 400 = 0
      OR (
        CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 4 = 0
        AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 100 <> 0
      )
    ) THEN 29
    ELSE 28
  END
)
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_CIVIL_DATE');
END;

CREATE INDEX idx_accounts_archived_at ON accounts(archived_at);
CREATE INDEX idx_transactions_occurred_on ON transactions(occurred_on);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'custom')),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  income_target INTEGER CHECK (income_target IS NULL OR (typeof(income_target) = 'integer' AND income_target > 0)),
  expense_limit INTEGER CHECK (expense_limit IS NULL OR (typeof(expense_limit) = 'integer' AND expense_limit > 0)),
  rollover_policy TEXT NOT NULL DEFAULT 'none' CHECK (rollover_policy IN ('none', 'unspent_only')),
  rollover_from_budget_id TEXT REFERENCES budgets(id) ON DELETE RESTRICT,
  note TEXT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  archived_at INTEGER CHECK (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at > 0)),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR (typeof(deleted_at) = 'integer' AND deleted_at > 0)),
  CHECK (ends_on >= starts_on),
  CHECK (rollover_from_budget_id IS NULL OR rollover_from_budget_id <> id)
);

CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY NOT NULL,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR (typeof(deleted_at) = 'integer' AND deleted_at > 0))
);

CREATE UNIQUE INDEX uq_budget_category_active
  ON budget_categories(budget_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_budgets_period_currency ON budgets(currency, starts_on, ends_on);
CREATE INDEX idx_budgets_account_id ON budgets(account_id);
CREATE INDEX idx_budgets_archived_at ON budgets(archived_at);
CREATE INDEX idx_budgets_deleted_at ON budgets(deleted_at);
CREATE INDEX idx_budget_categories_budget_id ON budget_categories(budget_id);
CREATE INDEX idx_budget_categories_deleted_at ON budget_categories(deleted_at);

CREATE TABLE savings_goals (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  preset_key TEXT,
  target_amount INTEGER NOT NULL CHECK (typeof(target_amount) = 'integer' AND target_amount > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  target_date TEXT,
  linked_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'completed')),
  completed_at INTEGER CHECK (completed_at IS NULL OR (typeof(completed_at) = 'integer' AND completed_at > 0)),
  archived_at INTEGER CHECK (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at > 0)),
  note TEXT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR (typeof(deleted_at) = 'integer' AND deleted_at > 0)),
  CHECK (
    (lifecycle_status = 'active' AND completed_at IS NULL)
    OR (lifecycle_status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE savings_goal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('contribution', 'withdrawal')),
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  link_mode TEXT NOT NULL CHECK (link_mode IN ('allocation_only', 'existing_transfer', 'owned_transfer')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  occurred_at INTEGER NOT NULL CHECK (typeof(occurred_at) = 'integer' AND occurred_at > 0),
  occurred_on TEXT NOT NULL,
  note TEXT,
  cascade_deleted_at INTEGER CHECK (cascade_deleted_at IS NULL OR (typeof(cascade_deleted_at) = 'integer' AND cascade_deleted_at > 0)),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at > 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR (typeof(deleted_at) = 'integer' AND deleted_at > 0)),
  CHECK (
    (link_mode = 'allocation_only' AND transaction_id IS NULL)
    OR (link_mode IN ('existing_transfer', 'owned_transfer') AND transaction_id IS NOT NULL)
  ),
  CHECK (cascade_deleted_at IS NULL OR deleted_at IS NOT NULL)
);

-- Evidence links are permanently reserved, including after soft deletion.
CREATE UNIQUE INDEX uq_savings_goal_entry_transaction
  ON savings_goal_entries(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_savings_goals_linked_account ON savings_goals(linked_account_id);
CREATE INDEX idx_savings_goals_archived_at ON savings_goals(archived_at);
CREATE INDEX idx_savings_goals_deleted_at ON savings_goals(deleted_at);
CREATE INDEX idx_savings_goal_entries_goal_id ON savings_goal_entries(goal_id);
CREATE INDEX idx_savings_goal_entries_deleted_at ON savings_goal_entries(deleted_at);

PRAGMA foreign_key_check;
