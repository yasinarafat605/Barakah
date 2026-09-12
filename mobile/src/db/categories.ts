/**
 * Barakah Categories Repository & Data Access Layer
 * Strict adherence to:
 * - Local-first architecture (ADR-001)
 * - Explicit delete vs archive separation (Milestone 2 corrections)
 * - Exclusive transactions for reordering
 */

import { getDatabase, runExclusiveTransaction } from './client';
import {
  CategoryRow,
  CreateCategoryInput,
  DatabaseConnection,
  UpdateCategoryInput,
} from './types';

export interface CategoryFilters {
  type?: 'income' | 'expense';
  isArchived?: boolean;
}

/**
 * Returns all categories filtered by type and archive status.
 * Sorted by sort_order ASC, created_at ASC.
 */
export async function getCategories(
  filtersOrType?: CategoryFilters | 'income' | 'expense',
  legacyIncludeArchived: boolean = false,
  customDb?: DatabaseConnection
): Promise<CategoryRow[]> {
  let type: 'income' | 'expense' | undefined;
  let isArchived: boolean | undefined = false;
  let db: DatabaseConnection | undefined;

  if (typeof filtersOrType === 'object' && filtersOrType !== null) {
    type = filtersOrType.type;
    isArchived = filtersOrType.isArchived;
    db = customDb;
  } else if (typeof filtersOrType === 'string') {
    type = filtersOrType;
    isArchived = legacyIncludeArchived ? undefined : false;
    db = customDb;
  } else {
    db = customDb;
  }

  const conn = db ?? (await getDatabase());

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  if (isArchived !== undefined) {
    conditions.push('is_archived = ?');
    params.push(isArchived ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT
      id,
      name_key,
      name_custom,
      icon,
      color,
      type,
      is_archived,
      sort_order,
      is_default,
      created_at,
      updated_at
    FROM categories
    ${whereClause}
    ORDER BY sort_order ASC, created_at ASC;
  `;

  return await conn.getAllAsync<CategoryRow>(sql, ...params);
}

/**
 * Retrieves a single category by ID.
 */
export async function getCategoryById(
  id: string,
  customDb?: DatabaseConnection
): Promise<CategoryRow | null> {
  const db = customDb ?? (await getDatabase());
  return await db.getFirstAsync<CategoryRow>(
    `SELECT
       id,
       name_key,
       name_custom,
       icon,
       color,
       type,
       is_archived,
       sort_order,
       is_default,
       created_at,
       updated_at
     FROM categories
     WHERE id = ?;`,
    id
  );
}

/**
 * Generates a unique category ID for custom categories.
 */
export function generateCategoryId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `cat_custom_${timestamp}_${randomPart}`;
}

/**
 * Creates a custom category.
 * Custom categories have `is_default = 0`.
 */
export async function createCategory(
  input: CreateCategoryInput,
  customDb?: DatabaseConnection
): Promise<CategoryRow> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  const id = generateCategoryId();
  const nameCustom = input.nameCustom.trim();
  const nameKey = input.nameKey ? input.nameKey.trim() : `custom_${id}`;
  const icon = input.icon ? input.icon.trim() : 'pricetag-outline';
  const color = input.color ? input.color.trim() : null;

  if (!nameCustom) {
    throw new Error('Category name cannot be empty');
  }

  // Determine sort_order: place at end
  const maxOrderRow = await db.getFirstAsync<{ max_order: number | null }>(
    'SELECT MAX(sort_order) as max_order FROM categories WHERE type = ?;',
    input.type
  );
  const sortOrder = (maxOrderRow?.max_order ?? 0) + 10;

  await db.runAsync(
    `INSERT INTO categories (
       id,
       name_key,
       name_custom,
       icon,
       color,
       type,
       is_archived,
       sort_order,
       is_default,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?);`,
    id,
    nameKey,
    nameCustom,
    icon,
    color,
    input.type,
    sortOrder,
    now,
    now
  );

  return {
    id,
    name_key: nameKey,
    name_custom: nameCustom,
    icon,
    color,
    type: input.type,
    is_archived: 0,
    sort_order: sortOrder,
    is_default: 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Updates a category's custom name, icon, color, or type.
 * Note: Changing type between income and expense is forbidden if the category has transaction history.
 */
export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
  customDb?: DatabaseConnection
): Promise<CategoryRow> {
  const db = customDb ?? (await getDatabase());
  const existing = await getCategoryById(id, db);

  if (!existing) {
    throw new Error(`Category not found: ${id}`);
  }

  const now = Date.now();

  // If changing type, ensure no transactions exist for this category
  if (input.type && input.type !== existing.type) {
    const txCountRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE category_id = ?;',
      id
    );
    if ((txCountRow?.count ?? 0) > 0) {
      throw new Error('Category type cannot be changed once transactions exist.');
    }
  }

  const nameCustom = input.nameCustom !== undefined ? input.nameCustom : existing.name_custom;
  const icon = input.icon !== undefined ? input.icon : existing.icon;
  const color = input.color !== undefined ? input.color : existing.color;
  const type = input.type !== undefined ? input.type : existing.type;

  await db.runAsync(
    `UPDATE categories
     SET
       name_custom = ?,
       icon = ?,
       color = ?,
       type = ?,
       updated_at = ?
     WHERE id = ?;`,
    nameCustom,
    icon,
    color,
    type,
    now,
    id
  );

  return {
    ...existing,
    name_custom: nameCustom,
    icon,
    color,
    type,
    updated_at: now,
  };
}

/**
 * Archives a category. Historical transactions remain valid and queryable.
 */
export async function archiveCategory(
  id: string,
  customDb?: DatabaseConnection
): Promise<CategoryRow> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();
  await db.runAsync(
    'UPDATE categories SET is_archived = 1, updated_at = ? WHERE id = ?;',
    now,
    id
  );
  const updated = await getCategoryById(id, db);
  if (!updated) {
    throw new Error(`Category not found: ${id}`);
  }
  return updated;
}

/**
 * Restores an archived category.
 */
export async function restoreCategory(
  id: string,
  customDb?: DatabaseConnection
): Promise<CategoryRow> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();
  await db.runAsync(
    'UPDATE categories SET is_archived = 0, updated_at = ? WHERE id = ?;',
    now,
    id
  );
  const updated = await getCategoryById(id, db);
  if (!updated) {
    throw new Error(`Category not found: ${id}`);
  }
  return updated;
}

/**
 * Permanently deletes a category.
 * Strictly enforced:
 * - Default categories CANNOT be deleted (must archive instead).
 * - Categories with existing transaction history CANNOT be deleted (must archive instead).
 * - Only unused custom categories may be permanently deleted.
 */
export async function deleteCategory(
  id: string,
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const category = await getCategoryById(id, db);

  if (!category) {
    throw new Error(`Category not found: ${id}`);
  }

  if (category.is_default === 1) {
    throw new Error('Default categories cannot be deleted. Archive the category instead.');
  }

  const txCountRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM transactions WHERE category_id = ?;',
    id
  );
  if ((txCountRow?.count ?? 0) > 0) {
    throw new Error('Categories with transaction history cannot be deleted. Archive the category instead.');
  }

  const result = await db.runAsync('DELETE FROM categories WHERE id = ?;', id);
  if (result.changes === 0) {
    throw new Error(`Failed to delete category: ${id}`);
  }
}

/**
 * Reorders categories atomically within an exclusive transaction.
 */
export async function reorderCategories(
  orderedIdsOrItems: string[] | { id: string; sortOrder?: number }[],
  customDb?: DatabaseConnection
): Promise<void> {
  const db = customDb ?? (await getDatabase());
  const now = Date.now();

  await runExclusiveTransaction(db, async () => {
    for (let i = 0; i < orderedIdsOrItems.length; i++) {
      const item = orderedIdsOrItems[i];
      const id = typeof item === 'string' ? item : item.id;
      const order =
        typeof item === 'object' && typeof item.sortOrder === 'number'
          ? item.sortOrder
          : (i + 1) * 10;
      await db.runAsync(
        'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ?;',
        order,
        now,
        id
      );
    }
  });
}

/**
 * Returns the localized display name for a category.
 * If user customized the name (name_custom), returns name_custom.
 * Otherwise, translates the name_key via the provided i18n translation function.
 */
export function getCategoryDisplayName(
  category: CategoryRow,
  locale: string = 'en',
  t?: (key: string) => string
): string {
  if (category.name_custom && category.name_custom.trim()) {
    return category.name_custom.trim();
  }
  if (t) {
    const key = category.name_key.startsWith('categories.')
      ? category.name_key
      : `categories.${category.name_key}`;
    return t(key);
  }
  return category.name_key;
}
