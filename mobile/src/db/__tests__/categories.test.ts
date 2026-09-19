import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { setDatabase, closeDatabase } from '../client';
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
  deleteCategory,
  reorderCategories,
  getCategoryDisplayName,
} from '../categories';
import { DatabaseConnection } from '../types';

describe('Categories Repository (Milestone 2)', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
    setDatabase(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('Default Category Seeding', () => {
    it('seeds default categories (9 income, 13 expense = 22 total)', async () => {
      const allCategories = await getCategories();
      expect(allCategories).toHaveLength(22);

      const incomeCats = allCategories.filter((c) => c.type === 'income');
      const expenseCats = allCategories.filter((c) => c.type === 'expense');

      expect(incomeCats).toHaveLength(9);
      expect(expenseCats).toHaveLength(13);

      // All seeded categories must be default
      allCategories.forEach((c) => {
        expect(c.is_default).toBe(1);
        expect(c.is_archived).toBe(0);
        expect(c.name_key).toBeDefined();
        expect(c.icon).toBeDefined();
      });
    });

    it('returns stable keys and correct sort order', async () => {
      const incomeCats = await getCategories({ type: 'income' });
      expect(incomeCats[0].name_key).toBe('salary_wages');
      expect(incomeCats[0].sort_order).toBe(10);

      const expenseCats = await getCategories({ type: 'expense' });
      expect(expenseCats[0].name_key).toBe('food_groceries');
      expect(expenseCats[0].sort_order).toBe(10);
    });
  });

  describe('Category Display Names & Renaming', () => {
    it('formats default names via translation mock and preserves custom name override', () => {
      const mockT = (key: string) => {
        if (key === 'categories.salary_wages') return 'Salary & Wages';
        return key;
      };

      const defaultCat = {
        id: 'cat_inc_salary_wages',
        name_key: 'salary_wages',
        name_custom: null,
        type: 'income' as const,
        icon: 'cash-outline',
        color: null,
        is_archived: 0,
        sort_order: 10,
        is_default: 1,
        created_at: 0,
        updated_at: 0,
      };

      // 1. Without custom name -> returns translated
      expect(getCategoryDisplayName(defaultCat, 'en', mockT)).toBe('Salary & Wages');

      // 2. With custom name -> returns custom name
      const renamedCat = { ...defaultCat, name_custom: 'Day Job Salary' };
      expect(getCategoryDisplayName(renamedCat, 'en', mockT)).toBe('Day Job Salary');
    });

    it('updates default category custom name without changing stable name_key', async () => {
      const updated = await updateCategory('cat_inc_salary_wages', {
        nameCustom: 'My Corporate Paycheck',
      });

      expect(updated.name_key).toBe('salary_wages');
      expect(updated.name_custom).toBe('My Corporate Paycheck');

      // Resetting custom name restores null
      const reset = await updateCategory('cat_inc_salary_wages', {
        nameCustom: null,
      });
      expect(reset.name_key).toBe('salary_wages');
      expect(reset.name_custom).toBeNull();
    });
  });

  describe('Custom Category Creation & Type Safety', () => {
    it('creates custom categories with is_default = 0', async () => {
      const custom = await createCategory({
        nameKey: 'categories.my_consulting',
        nameCustom: 'Private Tutoring',
        type: 'income',
        icon: 'school-outline',
      });

      expect(custom.is_default).toBe(0);
      expect(custom.name_custom).toBe('Private Tutoring');
      expect(custom.type).toBe('income');
    });

    it('prevents changing category type if transactions exist for that category', async () => {
      const now = Date.now();
      // Setup account & transaction for salary_wages
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_1', 'Main Bank', 'bank', 0, 'BDT', now, now
      );

      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, occurred_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
        'tx_cat_test', 'acc_1', 'cat_inc_salary_wages', 10000, 'income', now, now
      );

      // Attempting to change type from income to expense must fail
      await expect(
        updateCategory('cat_inc_salary_wages', {
          type: 'expense',
        })
      ).rejects.toThrow(/transactions exist/i);
    });
  });

  describe('Category Deletion & Archiving Rules', () => {
    it('rejects deleting default categories (must use archive instead)', async () => {
      await expect(deleteCategory('cat_inc_salary_wages')).rejects.toThrow(
        /Default categories cannot be deleted/i
      );
    });

    it('rejects deleting categories referenced by existing transactions', async () => {
      const custom = await createCategory({
        nameKey: 'categories.custom_book',
        nameCustom: 'Book Sales',
        type: 'income',
      });

      const now = Date.now();
      await db.runAsync(
        `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        'acc_test_del', 'Wallet', 'cash', 0, 'BDT', now, now
      );

      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, timestamp, occurred_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', ?);`,
        'tx_with_cat', 'acc_test_del', custom.id, 500, 'income', now, now
      );

      await expect(deleteCategory(custom.id)).rejects.toThrow(
        /transaction history cannot be deleted/i
      );
    });

    it('allows permanently deleting unused custom categories', async () => {
      const custom = await createCategory({
        nameKey: 'categories.temp',
        nameCustom: 'Temporary Gig',
        type: 'income',
      });

      await deleteCategory(custom.id);

      const found = await getCategoryById(custom.id);
      expect(found).toBeNull();
    });

    it('supports archiving and restoring categories', async () => {
      // Archive default category
      const archived = await archiveCategory('cat_inc_salary_wages');
      expect(archived.is_archived).toBe(1);

      // Filtered query excludes archived
      const activeOnly = await getCategories({ isArchived: false, type: 'income' });
      expect(activeOnly.some((c) => c.id === 'cat_inc_salary_wages')).toBe(false);

      // Restore category
      const restored = await restoreCategory('cat_inc_salary_wages');
      expect(restored.is_archived).toBe(0);

      const activeRestored = await getCategories({ isArchived: false, type: 'income' });
      expect(activeRestored.some((c) => c.id === 'cat_inc_salary_wages')).toBe(true);
    });

    it('reorders categories in exclusive transaction', async () => {
      await reorderCategories([
        { id: 'cat_inc_other_income', sortOrder: 1 },
        { id: 'cat_inc_salary_wages', sortOrder: 2 },
      ]);

      const other = await getCategoryById('cat_inc_other_income');
      const salary = await getCategoryById('cat_inc_salary_wages');

      expect(other?.sort_order).toBe(1);
      expect(salary?.sort_order).toBe(2);
    });
  });
});
