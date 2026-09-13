import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations, getAppliedMigrations } from '../migrations';
import { migration001 } from '../migrations/001_initial_schema';
import { migration002 } from '../migrations/002_categories_and_transfers';
import { migration003 } from '../migrations/003_debts_and_counterparties';
import { migration004 } from '../migrations/004_debt_ledger_integrity_upgrade';
import { migration005 } from '../migrations/005_backup_metadata_and_checksums';
import { migration006 } from '../migrations/006_backup_integrity_hardening';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../migrations/registry';

describe('Migration 007: Truthful Backup Export Statuses & Upgrade Integrity', () => {
  it('upgrades an existing database from commit 243c833 Migration 006 state, preserves rows, and accepts new statuses idempotently', async () => {
    const db = createBetterSqliteConnection();

    // 1. Manually build exact Migration 006 state from commit 243c833
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        checksum TEXT
      );
    `);

    const legacyMigrations = [migration001, migration002, migration003, migration004, migration005, migration006];
    for (const mig of legacyMigrations) {
      await mig.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?);',
        mig.version,
        mig.name,
        Date.now(),
        CANONICAL_MIGRATION_CHECKSUMS[mig.version]
      );
    }

    // Verify Migration 006 canonical checksum matches 243c833
    const v6Row = await db.getFirstAsync<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE version = 6;'
    );
    expect(v6Row?.checksum).toBe('fa2d22a9ebf7d7f180f95be7d3714417d9f7554fb10d2220b3bde77342f3407f');

    // 2. Populate backup_history with all legacy statuses under Migration 006 schema
    const legacyStatuses = ['created', 'generated', 'exported', 'verified', 'share_cancelled', 'failed'];
    for (let i = 0; i < legacyStatuses.length; i++) {
      const status = legacyStatuses[i];
      await db.runAsync(`
        INSERT INTO backup_history (
          id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
        ) VALUES (?, 'manual_export', 1, 6, ?, 1024, ?, 10, ?, NULL, ?);
      `, `hist_legacy_${i}`, `backup_${status}.fmz`, `hash_${status}`, status, Date.now() + i);
    }

    const preUpgradeCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM backup_history;');
    expect(preUpgradeCount?.c).toBe(legacyStatuses.length);

    // 3. Run current migration runner: must not report v6 checksum mismatch and applies 007 exactly once
    const upgradeResult = await runMigrations(db);
    expect(upgradeResult.applied).toBe(1);
    expect(upgradeResult.versions).toEqual([7]);

    // 4. Verify all existing backup-history rows survived intact
    const postUpgradeCount = await db.getFirstAsync<{ c: number }>('SELECT count(*) as c FROM backup_history;');
    expect(postUpgradeCount?.c).toBe(legacyStatuses.length);

    for (let i = 0; i < legacyStatuses.length; i++) {
      const row = await db.getFirstAsync<{ id: string; status: string }>(
        'SELECT id, status FROM backup_history WHERE id = ?;',
        `hist_legacy_${i}`
      );
      expect(row?.status).toBe(legacyStatuses[i]);
    }

    // 5. Verify new status values pass the database CHECK constraint
    await db.runAsync(`
      INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES ('hist_new_share', 'manual_export', 1, 7, 'share.fmz', 2048, 'hash_share', 15, 'share_sheet_returned', NULL, ?);
    `, Date.now());

    await db.runAsync(`
      INSERT INTO backup_history (
        id, backup_type, format_version, schema_version, file_name, file_size_bytes, sha256_checksum, record_count, status, error_code, created_at
      ) VALUES ('hist_new_verified', 'manual_export', 1, 7, 'verified.fmz', 2048, 'hash_verified', 15, 'verified_external_copy', NULL, ?);
    `, Date.now());

    const shareRow = await db.getFirstAsync<{ status: string }>('SELECT status FROM backup_history WHERE id = ?;', 'hist_new_share');
    expect(shareRow?.status).toBe('share_sheet_returned');

    const extRow = await db.getFirstAsync<{ status: string }>('SELECT status FROM backup_history WHERE id = ?;', 'hist_new_verified');
    expect(extRow?.status).toBe('verified_external_copy');

    // 6. Verify reopening the upgraded database is idempotent
    const rerunResult = await runMigrations(db);
    expect(rerunResult.applied).toBe(0);
    expect(rerunResult.versions).toEqual([]);

    const allApplied = await getAppliedMigrations(db);
    expect(allApplied).toHaveLength(7);
    for (const m of allApplied) {
      expect(m.checksum).toBe(CANONICAL_MIGRATION_CHECKSUMS[m.version]);
    }

    await db.closeAsync();
  });
});
