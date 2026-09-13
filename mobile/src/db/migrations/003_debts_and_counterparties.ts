import { Migration, DatabaseConnection } from '../types';

export const NEW_DEFAULT_CATEGORIES: {
  id: string;
  name_key: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
  sort_order: number;
}[] = [
  {
    id: 'cat_inc_loan_repayment_received',
    name_key: 'loan_repayment_received',
    type: 'income',
    icon: 'enter-outline',
    color: '#087A62',
    sort_order: 75,
  },
  {
    id: 'cat_exp_loan_given',
    name_key: 'loan_given',
    type: 'expense',
    icon: 'exit-outline',
    color: '#B5473A',
    sort_order: 105,
  },
];

async function applyMigration003(db: DatabaseConnection): Promise<void> {
  // Step 1: Create counterparties table and indexes
  await db.execAsync(`
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
  `);

  // Step 2: Create debts table and indexes
  await db.execAsync(`
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
  `);

  // Step 3: Create debt_transactions ledger table and indexes
  await db.execAsync(`
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

    CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_tx_transaction_id ON debt_transactions(transaction_id) WHERE transaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_debt_tx_debt_id ON debt_transactions(debt_id);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_transaction_id ON debt_transactions(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_role ON debt_transactions(role);
    CREATE INDEX IF NOT EXISTS idx_debt_tx_deleted_at ON debt_transactions(deleted_at);
  `);

  // Step 4: Idempotently seed missing debt categories without un-archiving user-archived categories
  const now = Date.now();
  for (const cat of NEW_DEFAULT_CATEGORIES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO categories (id, name_key, name_custom, icon, color, type, is_archived, sort_order, is_default, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 0, ?, 1, ?, ?);`,
      cat.id,
      cat.name_key,
      cat.icon,
      cat.color,
      cat.type,
      cat.sort_order,
      now,
      now
    );
  }
}

export const migration003: Migration = {
  version: 3,
  name: '003_debts_and_counterparties',
  up: applyMigration003,
};
