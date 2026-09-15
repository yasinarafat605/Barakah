import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CANONICAL_MIGRATION_CHECKSUMS } from '../migrations/registry';
import frozenSourceHashes from './fixtures/frozen-migration-source-hashes.json';

export function hashFrozenMigrationSource(source: string): string {
  // Normalize checkout line endings only. Whitespace and all meaningful source remain covered.
  const normalized = source.replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

describe('Migration Canonical Checksums CI Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../migrations');

  it('reproducibly matches all canonical migration checksums against .sql files', () => {
    for (let version = 1; version <= 7; version++) {
      const expectedChecksum = CANONICAL_MIGRATION_CHECKSUMS[version];
      expect(expectedChecksum).toBeDefined();
      expect(expectedChecksum).not.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // Must not be empty string

      // Find corresponding .sql file
      const prefix = version.toString().padStart(3, '0');
      const files = fs.readdirSync(migrationsDir);
      const sqlFile = files.find((f) => f.startsWith(prefix) && f.endsWith('.sql'));
      expect(sqlFile).toBeDefined();

      const rawContent = fs.readFileSync(path.join(migrationsDir, sqlFile!), 'utf8');
      const normalized = rawContent.replace(/\r\n/g, '\n').trim();
      const actualChecksum = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');

      expect(actualChecksum).toBe(expectedChecksum);
    }
  });

  it('freezes every reference SQL and executable TypeScript migration from 001 through 007', () => {
    for (const [fileName, expectedHash] of Object.entries(frozenSourceHashes)) {
      const source = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
      expect(hashFrozenMigrationSource(source)).toBe(expectedHash);
    }
    expect(Object.keys(frozenSourceHashes)).toHaveLength(14);
  });

  it('detects a modified copied TypeScript migration body', () => {
    const source = fs.readFileSync(path.join(migrationsDir, '007_backup_export_statuses.ts'), 'utf8');
    const modifiedCopy = source.replace('version: 7', 'version: 7007');
    expect(hashFrozenMigrationSource(modifiedCopy)).not.toBe(
      frozenSourceHashes['007_backup_export_statuses.ts']
    );
  });
});
