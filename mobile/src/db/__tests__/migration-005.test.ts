import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations, getAppliedMigrations } from '../migrations';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import { migration004 } from '../migrations/004_debt_ledger_integrity_upgrade';

describe('Migration 005: Backup Metadata and Checksums', () => {
  it('applies cleanly on a fresh database and populates checksums', async () => {
    const db = createBetterSqliteConnection();
    const result = await runMigrations(db);

    expect(result.applied).toBe(5);
    expect(result.versions).toEqual([1, 2, 3, 4, 5]);

    const applied = await getAppliedMigrations(db);
    expect(applied).toHaveLength(5);

    // Verify schema_migrations has checksum column
    const schemaCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(schema_migrations);');
    expect(schemaCols.some((col) => col.name === 'checksum')).toBe(true);

    const rowsWithChecksum = await db.getAllAsync<{ version: number; checksum: string | null }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
    );
    expect(rowsWithChecksum).toHaveLength(5);
    for (const r of rowsWithChecksum) {
      expect(r.checksum).toBeTruthy();
      expect(r.checksum).toHaveLength(64);
    }

    // Verify backup_history table exists and accepts records
    const backupHistoryCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(backup_history);');
    expect(backupHistoryCols.some((col) => col.name === 'id')).toBe(true);
    expect(backupHistoryCols.some((col) => col.name === 'backup_type')).toBe(true);
    expect(backupHistoryCols.some((col) => col.name === 'sha256_checksum')).toBe(true);

    await db.closeAsync();
  });

  it('upgrades an existing database from Migration 004 schema with data preservation', async () => {
    const db = createBetterSqliteConnection();

    // 1. Manually apply migrations 1 through 4
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    for (const mig of [migration001, migration002, migration003, migration004]) {
      await mig.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
        mig.version,
        mig.name,
        Date.now()
      );
    }

    // 2. Insert test data into tables
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO accounts (id, name, type, initial_balance, currency, created_at, updated_at)
       VALUES ('acc_mig5', 'Savings Account', 'savings', 100000, 'BDT', ?, ?);`,
      now,
      now
    );

    // 3. Run migration 005 via runner
    const result = await runMigrations(db);
    expect(result.applied).toBe(1);
    expect(result.versions).toEqual([5]);

    // 4. Verify existing data preserved
    const account = await db.getFirstAsync<{ name: string; initial_balance: number }>(
      "SELECT name, initial_balance FROM accounts WHERE id = 'acc_mig5';"
    );
    expect(account?.name).toBe('Savings Account');
    expect(account?.initial_balance).toBe(100000);

    // 5. Verify checksums were backfilled for older migrations 1 to 4
    const rows = await db.getAllAsync<{ version: number; checksum: string | null }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC;'
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.checksum).toBeTruthy();
    }

    // 6. Verify idempotency: running migrations again applies 0 migrations
    const secondRun = await runMigrations(db);
    expect(secondRun.applied).toBe(0);

    await db.closeAsync();
  });
});
