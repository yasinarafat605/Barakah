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
import { CANONICAL_MIGRATION_CHECKSUMS } from '../migrations/registry';

describe('Migration 008 planning foundation', () => {
  it('upgrades a released schema-7 database, backfills UTC civil dates, and preserves all existing data', async () => {
    const db = createBetterSqliteConnection();
    await db.execAsync('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL,checksum TEXT);');
    for (const migration of [migration001,migration002,migration003,migration004,migration005,migration006,migration007]) {
      await migration.up(db);
      await db.runAsync(
        'INSERT OR REPLACE INTO schema_migrations(version,name,applied_at,checksum) VALUES(?,?,?,?);',
        migration.version,migration.name,Date.now(),CANONICAL_MIGRATION_CHECKSUMS[migration.version]
      );
    }
    await db.runAsync("INSERT INTO accounts(id,name,type,initial_balance,currency,created_at,updated_at) VALUES('a','Cash','cash',0,'BDT',1,1);");
    await db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,transfer_id,transfer_role,related_account_id,note,timestamp,created_at,updated_at,deleted_at) VALUES('t','a','cat_exp_food_groceries',1,'expense',NULL,NULL,NULL,NULL,1704067199000,1,1,NULL);");
    await migration008.up(db);
    expect((await db.getFirstAsync<{ occurred_on: string }>("SELECT occurred_on FROM transactions WHERE id='t';"))?.occurred_on).toBe('2023-12-31');
    const budgetColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(budgets);');
    expect(budgetColumns.map((column) => column.name)).toContain('archived_at');
    expect(budgetColumns.map((column) => column.name)).not.toContain('status');
    await db.closeAsync();
  });

  it('enforces strict civil dates and derives UTC only for legacy direct inserts', async () => {
    const db = createBetterSqliteConnection();
    await db.execAsync('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL,checksum TEXT);');
    for (const migration of [migration001,migration002,migration003,migration004,migration005,migration006,migration007,migration008]) {
      await migration.up(db);
    }
    await db.runAsync("INSERT INTO accounts(id,name,type,initial_balance,currency,created_at,updated_at) VALUES('a','Cash','cash',0,'BDT',1,1);");
    await expect(db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,timestamp,occurred_on,created_at,updated_at) VALUES('bad','a','cat_exp_food_groceries',1,'expense',1,'2025-02-29',1,1);")).rejects.toThrow(/INVALID_CIVIL_DATE/);
    await db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,timestamp,created_at,updated_at) VALUES('legacy','a','cat_exp_food_groceries',1,'expense',1000,1,1);");
    expect((await db.getFirstAsync<{ occurred_on: string }>("SELECT occurred_on FROM transactions WHERE id='legacy';"))?.occurred_on).toBe('1970-01-01');
    await db.closeAsync();
  });

  it('uses RESTRICT for budget allocations and permanently reserves savings evidence', async () => {
    const db = createBetterSqliteConnection();
    await runMigrations(db);
    await db.runAsync("INSERT INTO budgets(id,period_type,starts_on,ends_on,currency,expense_limit,rollover_policy,created_at,updated_at) VALUES('b','monthly','2026-01-01','2026-01-31','BDT',100,'none',1,1);");
    await db.runAsync("INSERT INTO budget_categories(id,budget_id,category_id,amount,sort_order,created_at,updated_at) VALUES('bc','b','cat_exp_food_groceries',50,0,1,1);");
    await expect(db.runAsync("DELETE FROM budgets WHERE id='b';")).rejects.toThrow(/FOREIGN KEY/);

    await db.runAsync("INSERT INTO accounts(id,name,type,initial_balance,currency,created_at,updated_at) VALUES('a','Cash','cash',100,'BDT',1,1),('o','Other','cash',100,'BDT',1,1);");
    await db.runAsync("INSERT INTO transactions(id,account_id,category_id,amount,type,transfer_id,transfer_role,related_account_id,timestamp,occurred_on,created_at,updated_at) VALUES('src','o',NULL,10,'transfer','tr','source','a',1,'1970-01-01',1,1),('dst','a',NULL,10,'transfer','tr','destination','o',1,'1970-01-01',1,1);");
    await db.runAsync("INSERT INTO savings_goals(id,name,target_amount,currency,linked_account_id,lifecycle_status,created_at,updated_at) VALUES('g','Goal',20,'BDT','a','active',1,1);");
    await db.runAsync("INSERT INTO savings_goal_entries(id,goal_id,entry_type,amount,link_mode,transaction_id,occurred_at,occurred_on,created_at,updated_at) VALUES('e','g','contribution',10,'existing_transfer','dst',1,'1970-01-01',1,1);");
    await expect(db.runAsync("INSERT INTO savings_goal_entries(id,goal_id,entry_type,amount,link_mode,transaction_id,occurred_at,occurred_on,created_at,updated_at) VALUES('active-duplicate','g','contribution',10,'existing_transfer','dst',1,'1970-01-01',1,1);")).rejects.toThrow(/UNIQUE/);
    await db.runAsync("UPDATE savings_goal_entries SET deleted_at=2 WHERE id='e';");
    await expect(db.runAsync("INSERT INTO savings_goal_entries(id,goal_id,entry_type,amount,link_mode,transaction_id,occurred_at,occurred_on,created_at,updated_at) VALUES('e2','g','contribution',10,'existing_transfer','dst',1,'1970-01-01',1,1);")).rejects.toThrow(/UNIQUE/);
    await db.runAsync("UPDATE savings_goal_entries SET deleted_at=NULL WHERE id='e';");
    expect((await db.getFirstAsync<{ c: number }>("SELECT count(*) c FROM savings_goal_entries WHERE transaction_id='dst';"))?.c).toBe(1);
    await db.closeAsync();
  });
});
