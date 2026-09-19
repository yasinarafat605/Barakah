import { DatabaseConnection, Migration } from '../types';

export const MIGRATION_009_NAME = '009_planning_integrity_corrections';

function validCivilDate(column: string): string {
  return `(
    length(${column}) = 10
    AND substr(${column}, 5, 1) = '-'
    AND substr(${column}, 8, 1) = '-'
    AND substr(${column}, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
    AND substr(${column}, 6, 2) GLOB '[0-9][0-9]'
    AND substr(${column}, 9, 2) GLOB '[0-9][0-9]'
    AND CAST(substr(${column}, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
    AND CAST(substr(${column}, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(${column}, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
      WHEN CAST(substr(${column}, 6, 2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31
      WHEN CAST(substr(${column}, 6, 2) AS INTEGER) IN (4,6,9,11) THEN 30
      WHEN (
        CAST(substr(${column}, 1, 4) AS INTEGER) % 400 = 0
        OR (
          CAST(substr(${column}, 1, 4) AS INTEGER) % 4 = 0
          AND CAST(substr(${column}, 1, 4) AS INTEGER) % 100 <> 0
        )
      ) THEN 29
      ELSE 28
    END
  )`;
}

async function assertExistingDatesAreValid(db: DatabaseConnection): Promise<void> {
  const checks = [
    ['transactions', `occurred_on IS NULL OR NOT ${validCivilDate('occurred_on')}`],
    ['budgets', `NOT ${validCivilDate('starts_on')} OR NOT ${validCivilDate('ends_on')}`],
    ['savings_goals', `target_date IS NOT NULL AND NOT ${validCivilDate('target_date')}`],
    ['savings_goal_entries', `occurred_on IS NULL OR NOT ${validCivilDate('occurred_on')}`],
  ] as const;
  for (const [table, invalidPredicate] of checks) {
    const invalid = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ${table} WHERE ${invalidPredicate} LIMIT 1;`
    );
    if (invalid?.id) throw new Error(`MIGRATION_ERR_INVALID_CIVIL_DATE:${table}:${invalid.id}`);
  }
}

async function applyMigration009(db: DatabaseConnection): Promise<void> {
  await assertExistingDatesAreValid(db);
  const transactionDate = validCivilDate('NEW.occurred_on');
  const budgetStart = validCivilDate('NEW.starts_on');
  const budgetEnd = validCivilDate('NEW.ends_on');
  const goalTarget = validCivilDate('NEW.target_date');
  const entryDate = validCivilDate('NEW.occurred_on');
  await db.execAsync(`
    DROP TRIGGER IF EXISTS trg_transactions_occurred_on_default;
    DROP TRIGGER IF EXISTS trg_transactions_occurred_on_insert;
    CREATE TRIGGER trg_transactions_occurred_on_insert
    BEFORE INSERT ON transactions
    WHEN NEW.occurred_on IS NULL OR NOT ${transactionDate}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_CIVIL_DATE'); END;

    CREATE TRIGGER trg_budgets_civil_dates_insert
    BEFORE INSERT ON budgets
    WHEN NOT ${budgetStart} OR NOT ${budgetEnd}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_BUDGET_DATE'); END;
    CREATE TRIGGER trg_budgets_civil_dates_update
    BEFORE UPDATE OF starts_on, ends_on ON budgets
    WHEN NOT ${budgetStart} OR NOT ${budgetEnd}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_BUDGET_DATE'); END;

    CREATE TRIGGER trg_savings_goals_target_date_insert
    BEFORE INSERT ON savings_goals
    WHEN NEW.target_date IS NOT NULL AND NOT ${goalTarget}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_DATE'); END;
    CREATE TRIGGER trg_savings_goals_target_date_update
    BEFORE UPDATE OF target_date ON savings_goals
    WHEN NEW.target_date IS NOT NULL AND NOT ${goalTarget}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_DATE'); END;

    CREATE TRIGGER trg_savings_goal_entries_occurred_on_insert
    BEFORE INSERT ON savings_goal_entries
    WHEN NEW.occurred_on IS NULL OR NOT ${entryDate}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_ENTRY_DATE'); END;
    CREATE TRIGGER trg_savings_goal_entries_occurred_on_update
    BEFORE UPDATE OF occurred_on ON savings_goal_entries
    WHEN NEW.occurred_on IS NULL OR NOT ${entryDate}
    BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_ENTRY_DATE'); END;
  `);
}

export const migration009: Migration = {
  version: 9,
  name: MIGRATION_009_NAME,
  up: applyMigration009,
};
