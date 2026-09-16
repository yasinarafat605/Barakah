import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations, getAppliedMigrations } from '../migrations';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import { migration004 } from '../migrations/004_debt_ledger_integrity_upgrade';
import { migration005 } from '../migrations/005_backup_metadata_and_checksums';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../migrations/registry';

describe('Migration 006: Backup Integrity Hardening and Checksums Enforcement', () => {
  it('applies cleanly on a fresh database and populates canonical checksums for all 6 migrations', async () => {
    const db = createBetterSqliteConnection();
    const result = await runMigrations(db);

    expect(result.applied).toBe(8);
    expect(result.versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const applied = await getAppliedMigrations(db);
    expect(applied).toHaveLength(8);

    for (const r of applied) {
      expect(r.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[r.version]);
    }

    // Verify backup_history accepts new statuses: 'generated', 'exported', 'share_cancelled'
    await db.runAsync(`
      INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES ('test_gen', 'manual_export', 1, 6, 'test.fmz', 1024, 'abc123hash', 10, 'generated', NULL, 123456);
    `);

    const row = await db.getFirstAsync<{ id: string; status: string }>(
      'SELECT id, status FROM backup_history WHERE id = ?;',
      'test_gen'
    );
    expect(row?.status).toBe('generated');

    await db.closeAsync();
  });

  it('upgrades an existing database from Migration 005 schema, corrects checksums, and preserves backup_history rows', async () => {
    const db = createBetterSqliteConnection();

    // 1. Manually apply migrations 1 through 5
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    for (const mig of [migration001, migration002, migration003, migration004, migration005]) {
      await mig.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
        mig.version,
        mig.name,
        Date.now()
      );
    }

    // Insert an existing row in backup_history under Migration 005 schema
    await db.runAsync(`
      INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES ('pre_existing_005', 'manual_export', 1, 5, 'old.fmz', 500, 'old_hash', 5, 'created', NULL, 1000);
    `);

    // 2. Run runner to apply Migrations 006, 007 and 008
    const result = await runMigrations(db);
    expect(result.applied).toBe(3);
    expect(result.versions).toEqual([6, 7, 8]);

    // 3. Verify pre-existing row preserved
    const existingHistory = await db.getFirstAsync<{ id: string; status: string }>(
      'SELECT id, status FROM backup_history WHERE id = ?;',
      'pre_existing_005'
    );
    expect(existingHistory).not.toBeNull();
    expect(existingHistory?.status).toBe('created');

    // 4. Verify canonical checksums backfilled
    const applied = await getAppliedMigrations(db);
    for (const r of applied) {
      expect(r.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[r.version]);
    }

    await db.closeAsync();
  });

  it('aborts on startup if an applied migration checksum has been tampered with', async () => {
    const db = createBetterSqliteConnection();
    await runMigrations(db);

    // Tamper with migration 003's checksum
    await db.runAsync(
      'UPDATE schema_migrations SET checksum = ? WHERE version = ?;',
      'deadbeefbadchecksum000000000000000000000000000000000000000000000000',
      3
    );

    // Re-running migrations on startup must detect mismatch and abort
    await expect(runMigrations(db)).rejects.toThrow('MIGRATION_ERR_CHECKSUM_MISMATCH');

    await db.closeAsync();
  });
});
