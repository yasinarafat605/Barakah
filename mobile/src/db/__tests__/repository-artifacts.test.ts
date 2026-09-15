import { execFileSync } from 'child_process';
import path from 'path';

const PROHIBITED_TRACKED_ARTIFACTS: RegExp[] = [
  /(^|\/)barakah\.db(?:$|-journal$|-wal$|-shm$|\.old_)/i,
  /(?:-wal|-shm)$/i,
  /(^|\/)staging_restore_[^/]*\.db(?:-wal|-shm)?$/i,
  /(^|\/)pre_migration_v[^/]*\.db$/i,
  /(^|\/)pre_restore_safety_[^/]*\.db$/i,
  /(^|\/)barakah_backup_[^/]*\.fmz$/i,
  /(^|\/)(?:barakah_)?restore_journal\.json(?:\.tmp|\.bak)?$/i,
  /(^|\/)(?:dist|web-build|\.expo|\.cache|coverage)(\/|$)/i,
  /^mobile\/(?:android|ios)(\/|$)/i,
];

describe('Repository runtime artifact protection', () => {
  it('does not track generated databases, backups, journals, snapshots, or build caches', () => {
    const repositoryRoot = path.resolve(__dirname, '../../../..');
    const trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);

    const prohibited = trackedFiles.filter((file) =>
      PROHIBITED_TRACKED_ARTIFACTS.some((pattern) => pattern.test(file))
    );
    expect(prohibited).toEqual([]);
  });
});
