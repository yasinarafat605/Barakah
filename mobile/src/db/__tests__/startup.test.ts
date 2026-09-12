import { getDatabase, closeDatabase, setDatabase } from '../client';
import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { DatabaseConnection } from '../types';

describe('Database Startup Gate & Retry Mechanics', () => {
  afterEach(async () => {
    await closeDatabase();
  });

  it('allows failed initialization followed by successful retry without stale promise deadlock', async () => {
    // 1. Simulate a failing connection attempt
    let attempts = 0;
    const failingFactory = async (): Promise<DatabaseConnection> => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Simulated SQLite disk I/O lock failure');
      }
      const db = createBetterSqliteConnection(':memory:');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await runMigrations(db);
      return db;
    };

    // First attempt fails
    await expect(failingFactory()).rejects.toThrow('Simulated SQLite disk I/O lock failure');

    // Second attempt (retry) succeeds cleanly
    const db = await failingFactory();
    expect(db).toBeDefined();
    setDatabase(db);

    const activeDb = await getDatabase();
    expect(activeDb).toBe(db);
  });

  it('deduplicates concurrent initialization requests to prevent race conditions', async () => {
    let factoryInvocations = 0;

    let inFlightPromise: Promise<DatabaseConnection> | null = null;
    const getSingletonConnection = async (): Promise<DatabaseConnection> => {
      if (inFlightPromise) return inFlightPromise;

      inFlightPromise = (async () => {
        factoryInvocations++;
        // Simulate small async initialization tick
        await new Promise((res) => setTimeout(res, 10));
        const db = createBetterSqliteConnection(':memory:');
        return db;
      })();

      try {
        return await inFlightPromise;
      } catch (err) {
        inFlightPromise = null;
        throw err;
      }
    };

    // Trigger 5 simultaneous calls
    const [c1, c2, c3, c4, c5] = await Promise.all([
      getSingletonConnection(),
      getSingletonConnection(),
      getSingletonConnection(),
      getSingletonConnection(),
      getSingletonConnection(),
    ]);

    expect(factoryInvocations).toBe(1);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
    expect(c3).toBe(c4);
    expect(c4).toBe(c5);
  });
});
