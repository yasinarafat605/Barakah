/**
 * Friday Amanah Database Connection Singleton
 * Strict adherence to:
 * - Local-first architecture (ADR-001)
 * - PRAGMA foreign_keys = ON;
 * - PRAGMA journal_mode = WAL;
 * - Pure mobile runtime: uses expo-sqlite exclusively
 */

import * as SQLite from 'expo-sqlite';
import { DatabaseConnection } from './types';

export const DEFAULT_DATABASE_NAME = 'friday_amanah.db';

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
