import { Migration, DatabaseConnection } from '../types';

export const DEFAULT_CATEGORIES: {
  id: string;
  name_key: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
  sort_order: number;
}[] = [
  // 8 Default Income Categories
  { id: 'cat_inc_salary_wages', name_key: 'salary_wages', type: 'income', icon: 'briefcase-outline', color: '#087A62', sort_order: 10 },
  { id: 'cat_inc_business_income', name_key: 'business_income', type: 'income', icon: 'storefront-outline', color: '#0B6B57', sort_order: 20 },
  { id: 'cat_inc_freelance_income', name_key: 'freelance_income', type: 'income', icon: 'laptop-outline', color: '#2F6FED', sort_order: 30 },
  { id: 'cat_inc_investment_profit', name_key: 'investment_profit', type: 'income', icon: 'trending-up-outline', color: '#D6B15B', sort_order: 40 },
  { id: 'cat_inc_rental_income', name_key: 'rental_income', type: 'income', icon: 'home-outline', color: '#087A62', sort_order: 50 },
  { id: 'cat_inc_gift_hadya', name_key: 'gift_hadya', type: 'income', icon: 'gift-outline', color: '#D6B15B', sort_order: 60 },
  { id: 'cat_inc_loan_received', name_key: 'loan_received', type: 'income', icon: 'enter-outline', color: '#8A5A1E', sort_order: 70 },
  { id: 'cat_inc_other_income', name_key: 'other_income', type: 'income', icon: 'add-circle-outline', color: '#5E6C65', sort_order: 80 },

  // 12 Default Expense Categories
  { id: 'cat_exp_food_groceries', name_key: 'food_groceries', type: 'expense', icon: 'cart-outline', color: '#B5473A', sort_order: 10 },
  { id: 'cat_exp_housing_rent', name_key: 'housing_rent', type: 'expense', icon: 'home-outline', color: '#B5473A', sort_order: 20 },
  { id: 'cat_exp_utilities_bills', name_key: 'utilities_bills', type: 'expense', icon: 'flash-outline', color: '#B86E00', sort_order: 30 },
  { id: 'cat_exp_transport', name_key: 'transport', type: 'expense', icon: 'car-outline', color: '#2F6FED', sort_order: 40 },
  { id: 'cat_exp_health_medical', name_key: 'health_medical', type: 'expense', icon: 'medkit-outline', color: '#B42318', sort_order: 50 },
  { id: 'cat_exp_education', name_key: 'education', type: 'expense', icon: 'school-outline', color: '#2F6FED', sort_order: 60 },
  { id: 'cat_exp_family_dependants', name_key: 'family_dependants', type: 'expense', icon: 'people-outline', color: '#0B6B57', sort_order: 70 },
  { id: 'cat_exp_sadaqah_charity', name_key: 'sadaqah_charity', type: 'expense', icon: 'heart-outline', color: '#087A62', sort_order: 80 },
  { id: 'cat_exp_zakat_payment', name_key: 'zakat_payment', type: 'expense', icon: 'ribbon-outline', color: '#7A4FB3', sort_order: 90 },
  { id: 'cat_exp_loan_repayment', name_key: 'loan_repayment', type: 'expense', icon: 'exit-outline', color: '#8A5A1E', sort_order: 100 },
  { id: 'cat_exp_fees_charges', name_key: 'fees_charges', type: 'expense', icon: 'receipt-outline', color: '#5E6C65', sort_order: 110 },
  { id: 'cat_exp_other_expense', name_key: 'other_expense', type: 'expense', icon: 'remove-circle-outline', color: '#5E6C65', sort_order: 120 },
];

async function applyMigration002(db: DatabaseConnection): Promise<void> {
  // Step 1: Upgrade categories table columns
  const tableInfo = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('categories');"
  );
  const existingCols = new Set(tableInfo.map((c) => c.name));

  if (!existingCols.has('name_custom')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN name_custom TEXT;');
  }
  if (!existingCols.has('is_archived')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
  }
  if (!existingCols.has('sort_order')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;');
  }
  if (!existingCols.has('is_default')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;');
  }
  if (!existingCols.has('created_at')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;');
  }
  if (!existingCols.has('updated_at')) {
    await db.execAsync('ALTER TABLE categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;');
  }

  // Step 2: Seed 20 default categories idempotently
  const now = Date.now();
  for (const cat of DEFAULT_CATEGORIES) {
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

  // Step 3: Rebuild transactions table with complete target schema & constraints
  const countBeforeRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM transactions;'
  );
  const countBefore = countBeforeRow?.count ?? 0;

  // Create temporary replacement table
  await db.execAsync(`
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
  `);

  // Copy existing transaction rows
  await db.execAsync(`
    INSERT INTO transactions_new (id, account_id, category_id, amount, type, transfer_id, transfer_role, related_account_id, note, timestamp, created_at, updated_at, deleted_at)
    SELECT id, account_id, category_id, amount, type, NULL, NULL, NULL, note, timestamp, created_at, created_at, NULL
    FROM transactions;
  `);

  // Validate copied row count
  const countAfterRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM transactions_new;'
  );
  const countAfter = countAfterRow?.count ?? 0;

  if (countBefore !== countAfter) {
    throw new Error(
      `Migration 002 validation failed: Row count mismatch between old transactions (${countBefore}) and new transactions (${countAfter}).`
    );
  }

  // Atomically swap tables
  await db.execAsync(`
    DROP TABLE transactions;
    ALTER TABLE transactions_new RENAME TO transactions;
  `);

  // Recreate indexes
  await db.execAsync(`
    CREATE UNIQUE INDEX idx_transactions_transfer_pair ON transactions(transfer_id, transfer_role) WHERE transfer_id IS NOT NULL;
    CREATE INDEX idx_transactions_account_id ON transactions(account_id);
    CREATE INDEX idx_transactions_category_id ON transactions(category_id);
    CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
    CREATE INDEX idx_transactions_transfer_id ON transactions(transfer_id);
    CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at);
  `);

  // Step 4: Validate foreign key integrity
  const fkErrors = await db.getAllAsync<{ table: string; rowid: number; parent: string; fkid: number }>(
    'PRAGMA foreign_key_check;'
  );
  if (fkErrors && fkErrors.length > 0) {
    throw new Error(`Migration 002 foreign key integrity violation: ${JSON.stringify(fkErrors)}`);
  }
}

export const migration002: Migration = {
  version: 2,
  name: '002_categories_and_transfers',
  up: async (db) => {
    await applyMigration002(db);
  },
};
