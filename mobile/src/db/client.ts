/**
 * Barakah Database Connection Singleton
 * Strict adherence to:
 * - Local-first architecture (ADR-001)
 * - PRAGMA foreign_keys = ON;
 * - PRAGMA journal_mode = WAL;
 * - Pure mobile runtime: uses expo-sqlite exclusively
 */

import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from './types';

export const DEFAULT_DATABASE_NAME = 'barakah.db';

let databaseInstance: DatabaseConnection | null = null;

/**
 * Returns the singleton database connection.
 * Enforces `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`.
 */
export async function getDatabase(dbName: string = DEFAULT_DATABASE_NAME): Promise<DatabaseConnection> {
  if (databaseInstance) {
    return databaseInstance;
  }

  const expoDb = await SQLite.openDatabaseAsync(dbName);
  const db = expoDb as unknown as DatabaseConnection;

  // Strictly enforce required SQLite pragmas
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);

  databaseInstance = db;
  return databaseInstance;
}

/**
 * Closes the active database connection and clears singleton instance.
 */
export async function closeDatabase(): Promise<void> {
  if (databaseInstance) {
    await databaseInstance.closeAsync();
    databaseInstance = null;
  }
}

/**
 * Allows injecting a custom connection (e.g. in Jest tests with isolated in-memory DBs).
 */
export function setDatabase(db: DatabaseConnection | null): void {
  databaseInstance = db;
}

/**
 * Executes a task within an exclusive transaction if supported,
 * falling back to standard transaction on platforms like Web.
 * The task callback receives the transaction connection object `txn`.
 * Every query participating in the transaction MUST execute on `txn`.
 */
export async function runExclusiveTransaction<T = void>(
  db: DatabaseConnection,
  task: (txn: DatabaseConnection) => Promise<T>
): Promise<T> {
  if (Platform.OS === 'web') {
    return db.withTransactionAsync((txn) => task(txn || db));
  }
  if (typeof db.withExclusiveTransactionAsync === 'function') {
    return db.withExclusiveTransactionAsync((txn) => {
      if (!txn) {
        throw new Error('ADAPTER_CONTRACT_ERROR: withExclusiveTransactionAsync did not supply a transaction connection.');
      }
      return task(txn as unknown as DatabaseConnection);
    });
  }
  return db.withTransactionAsync((txn) => {
    if (!txn) {
      throw new Error('ADAPTER_CONTRACT_ERROR: withTransactionAsync did not supply a transaction connection.');
    }
    return task(txn as unknown as DatabaseConnection);
  });
}

