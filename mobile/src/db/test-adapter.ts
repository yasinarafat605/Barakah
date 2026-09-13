import { DatabaseConnection } from './types';

/**
 * Creates a real SQLite connection in Node/Jest environments using better-sqlite3.
 * Kept strictly in this isolated test-adapter (not exported from db index or client)
 * so Metro bundler never analyzes or packages better-sqlite3 or Node built-in
 * modules ('fs', 'path') into the React Native mobile application bundle.
 */
export function createBetterSqliteConnection(filename: string = ':memory:'): DatabaseConnection {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db = new Database(filename);

  const connection: DatabaseConnection = {
    async execAsync(source: string): Promise<void> {
      db.exec(source);
    },
    async runAsync(source: string, ...params: unknown[]): Promise<{ lastInsertRowId: number; changes: number }> {
      const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const stmt = db.prepare(source);
      const info = stmt.run(...flatParams);
      return {
        lastInsertRowId: Number(info.lastInsertRowid),
        changes: info.changes,
      };
    },
    async getAllAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T[]> {
      const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const stmt = db.prepare(source);
      return stmt.all(...flatParams) as T[];
    },
    async getFirstAsync<T = unknown>(source: string, ...params: unknown[]): Promise<T | null> {
      const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const stmt = db.prepare(source);
      const result = stmt.get(...flatParams) as T | undefined;
      return result ?? null;
    },
    async withTransactionAsync<T = void>(task: (txn: DatabaseConnection) => Promise<T>): Promise<T> {
      db.exec('BEGIN');
      try {
        const result = await task(connection);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async withExclusiveTransactionAsync<T = void>(task: (txn: DatabaseConnection) => Promise<T>): Promise<T> {
      db.exec('BEGIN EXCLUSIVE');
      try {
        const result = await task(connection);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async closeAsync(): Promise<void> {
      db.close();
    },
  };

  return connection;
}
