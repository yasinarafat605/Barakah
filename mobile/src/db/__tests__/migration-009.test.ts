import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import { migration004 } from '../migrations/004_debt_ledger_integrity_upgrade';
import { migration005 } from '../migrations/005_backup_metadata_and_checksums';
import { migration006 } from '../migrations/006_backup_integrity_hardening';
import { migration007 } from '../migrations/007_backup_export_statuses';
import { migration008 } from '../migrations/008_planning_foundation';
import { migration009 } from '../migrations/009_planning_integrity_corrections';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../migrations/registry';
import type { DatabaseConnection, Migration } from '../types';

const throughEight = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008];

async function applyReleased(db: DatabaseConnection, migrations: Migration[]): Promise<void> {
  await db.execAsync('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL,checksum TEXT);');
  for (const migration of migrations) {
    await migration.up(db);
    await db.runAsync('INSERT INTO schema_migrations(version,name,applied_at,checksum) VALUES(?,?,?,?);', migration.version, migration.name, Date.now(), CANONICAL_MIGRATION_CHECKSUMS[migration.version]);
  }
}

describe('Migration 009 planning integrity corrections', () => {
  it('preserves schema-8 rows while upgrading to schema 9', async () => {
    const db = createBetterSqliteConnection();
    await applyReleased(db, throughEight);
    await db.runAsync("INSERT INTO accounts(id,name,type,initial_balance,currency,created_at,updated_at) VALUES('a','Cash','cash',100,'BDT',1,1);");
    await db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,timestamp,occurred_on,created_at,updated_at) VALUES('t','a','cat_exp_food_groceries',1,'expense',1,'2024-02-29',1,1);");
    await db.runAsync("INSERT INTO budgets(id,period_type,starts_on,ends_on,currency,income_target,rollover_policy,created_at,updated_at) VALUES('b','monthly','2024-02-01','2024-02-29','BDT',1,'none',1,1);");
    expect((await runMigrations(db)).versions).toEqual([9]);
    expect(await db.getFirstAsync("SELECT id FROM transactions WHERE id='t';")).toBeTruthy();
    expect(await db.getFirstAsync("SELECT id FROM budgets WHERE id='b';")).toBeTruthy();
    await db.closeAsync();
  });

  it('upgrades schema 7 through migrations 8 and 9', async () => {
    const db = createBetterSqliteConnection();
    await applyReleased(db, throughEight.slice(0, 7));
    expect((await runMigrations(db)).versions).toEqual([8, 9]);
    await db.closeAsync();
  });

  it.each([null, 'invalid-date', '2026-13-01', '2025-02-29'])(
    'rejects direct transaction insert date %p while accepting a valid leap date',
    async (occurredOn) => {
      const db = createBetterSqliteConnection();
      await runMigrations(db);
      await db.runAsync("INSERT INTO accounts(id,name,type,initial_balance,currency,created_at,updated_at) VALUES('a','Cash','cash',0,'BDT',1,1);");
      await expect(db.runAsync('INSERT INTO transactions(id,account_id,category_id,amount,type,timestamp,occurred_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);', 'bad', 'a', 'cat_exp_food_groceries', 1, 'expense', 1, occurredOn, 1, 1)).rejects.toThrow(/INVALID_CIVIL_DATE/);
      await db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,timestamp,occurred_on,created_at,updated_at) VALUES('good','a','cat_exp_food_groceries',1,'expense',1,'2024-02-29',1,1);");
      await db.closeAsync();
    }
  );

  it.each(['2025-02-29', '2026-02-31', '2026-13-01', '0000-01-01', 'invalid-date'])(
    'rejects invalid budget date %s at the database boundary',
    async (date) => {
      const db = createBetterSqliteConnection();
      await runMigrations(db);
      await expect(db.runAsync('INSERT INTO budgets(id,period_type,starts_on,ends_on,currency,income_target,rollover_policy,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);', 'bad', 'custom', date, '2027-01-01', 'BDT', 1, 'none', 1, 1)).rejects.toThrow(/INVALID_BUDGET_DATE/);
      await db.closeAsync();
    }
  );

  it.each(['2025-02-29', '2026-02-31', '2026-13-01', '0000-01-01', 'invalid-date'])(
    'rejects invalid goal and goal-entry date %s at the database boundary',
    async (date) => {
      const db = createBetterSqliteConnection();
      await runMigrations(db);
      await db.runAsync("INSERT INTO savings_goals(id,name,target_amount,currency,lifecycle_status,created_at,updated_at) VALUES('g','Goal',1,'BDT','active',1,1);");
      await expect(db.runAsync('UPDATE savings_goals SET target_date=? WHERE id=?;', date, 'g')).rejects.toThrow(/INVALID_GOAL_DATE/);
      await expect(db.runAsync('INSERT INTO savings_goal_entries(id,goal_id,entry_type,amount,link_mode,occurred_at,occurred_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);', 'e', 'g', 'contribution', 1, 'allocation_only', 1, date, 1, 1)).rejects.toThrow(/INVALID_GOAL_ENTRY_DATE/);
      await db.closeAsync();
    }
  );

  it('fails before installing triggers when an existing planning date is invalid', async () => {
    const db = createBetterSqliteConnection();
    await applyReleased(db, throughEight);
    await db.runAsync("INSERT INTO budgets(id,period_type,starts_on,ends_on,currency,income_target,rollover_policy,created_at,updated_at) VALUES('b','custom','2026-01-01','2026-01-31','BDT',1,'none',1,1);");
    await db.runAsync("UPDATE budgets SET starts_on='2026-01-00' WHERE id='b';");
    await expect(migration009.up(db)).rejects.toThrow(/MIGRATION_ERR_INVALID_CIVIL_DATE:budgets/);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_transactions_occurred_on_default';")).toBeTruthy();
    await db.closeAsync();
  });
});
