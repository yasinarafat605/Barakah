import { createBetterSqliteConnection } from '../test-adapter';
import { runExclusiveTransaction } from '../client';

describe('Database Adapter Transaction Contract', () => {
  it('supplies the transaction connection object to withExclusiveTransactionAsync and executes atomically', async () => {
    const db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      CREATE TABLE test_ledger (
        id TEXT PRIMARY KEY NOT NULL,
        val INTEGER NOT NULL
      );
    `);

    // Verify task receives txn and queries run through txn
    const result = await db.withExclusiveTransactionAsync(async (txn) => {
      expect(txn).toBeDefined();
      expect(typeof txn.runAsync).toBe('function');
      await txn.runAsync('INSERT INTO test_ledger (id, val) VALUES (?, ?);', 'row_1', 100);
      return 'success_val';
    });

    expect(result).toBe('success_val');

    const row = await db.getFirstAsync<{ id: string; val: number }>(
      'SELECT id, val FROM test_ledger WHERE id = ?;',
      'row_1'
    );
    expect(row).toEqual({ id: 'row_1', val: 100 });

    // Verify rollback on error
    await expect(
      db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync('INSERT INTO test_ledger (id, val) VALUES (?, ?);', 'row_2', 200);
        throw new Error('Simulated failure during atomic transaction');
      })
    ).rejects.toThrow('Simulated failure during atomic transaction');

    // row_2 must NOT exist due to rollback
    const rolledBackRow = await db.getFirstAsync<{ id: string; val: number }>(
      'SELECT id, val FROM test_ledger WHERE id = ?;',
      'row_2'
    );
    expect(rolledBackRow).toBeNull();
  });

  it('supplies the transaction connection object to withTransactionAsync and handles rollback', async () => {
    const db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      CREATE TABLE test_tx (
        id TEXT PRIMARY KEY NOT NULL,
        val INTEGER NOT NULL
      );
    `);

    await db.withTransactionAsync(async (txn) => {
      await txn.runAsync('INSERT INTO test_tx (id, val) VALUES (?, ?);', 'tx_1', 42);
    });

    const row = await db.getFirstAsync<{ id: string; val: number }>(
      'SELECT id, val FROM test_tx WHERE id = ?;',
      'tx_1'
    );
    expect(row).toEqual({ id: 'tx_1', val: 42 });

    await expect(
      db.withTransactionAsync(async (txn) => {
        await txn.runAsync('INSERT INTO test_tx (id, val) VALUES (?, ?);', 'tx_2', 99);
        throw new Error('Abort transaction');
      })
    ).rejects.toThrow('Abort transaction');

    const abortedRow = await db.getFirstAsync<{ id: string; val: number }>(
      'SELECT id, val FROM test_tx WHERE id = ?;',
      'tx_2'
    );
    expect(abortedRow).toBeNull();
  });

  it('Missing native transaction callback rejection: rejects when transaction callback receives no transaction object', async () => {
    const mockFaultyDb: any = {
      withExclusiveTransactionAsync: jest.fn(async (cb: any) => {
        // Simulates broken native bridge returning null/undefined
        return cb(null);
      }),
    };

    await expect(
      runExclusiveTransaction(mockFaultyDb, async (txn) => {
        await txn.runAsync('SELECT 1;');
      })
    ).rejects.toThrow('ADAPTER_CONTRACT_ERROR: withExclusiveTransactionAsync did not supply a transaction connection.');

    const mockFaultyTxDb: any = {
      withTransactionAsync: jest.fn(async (cb: any) => {
        return cb(undefined);
      }),
    };

    await expect(
      runExclusiveTransaction(mockFaultyTxDb, async (txn) => {
        await txn.runAsync('SELECT 1;');
      })
    ).rejects.toThrow('ADAPTER_CONTRACT_ERROR: withTransactionAsync did not supply a transaction connection.');
  });
});
