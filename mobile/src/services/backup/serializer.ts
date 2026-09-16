/**
 * Canonical Serializer, Table Checksum Engine & Compression
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - Deterministic JSON serialization (sorted keys, stable row sorting)
 * - Deterministic locale-independent table-level SHA-256 checksum generation & validation
 * - DEFLATE compression & safe bounded streaming decompression preventing decompression bombs (ADR-016)
 * - Strict manifest validation & header-to-manifest consistency verification
 */

import { deflateSync, Inflate } from 'fflate';
import {
  BackupHeader,
  BackupManifest,
  BackupPayloadData,
  TableChecksums,
  MAX_DECOMPRESSED_PAYLOAD_BYTES,
  RestoreError,
} from './types';
import { computeSha256Hex } from './crypto';

const MAX_TOTAL_RECORDS_LIMIT = 500000;

/**
 * Deterministically sorts object keys alphabetically.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + canonicalJsonStringify(record[key])
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 checksums for each table payload.
 * Rows are sorted deterministically using locale-independent code-point comparison before hashing.
 */
export function computeTableChecksums(payload: BackupPayloadData): TableChecksums {
  const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const accountsSorted = [...payload.accounts].sort((a, b) => compareStr(a.id, b.id));
  const categoriesSorted = [...payload.categories].sort((a, b) => compareStr(a.id, b.id));
  const transactionsSorted = [...payload.transactions].sort((a, b) => compareStr(a.id, b.id));
  const counterpartiesSorted = [...payload.counterparties].sort((a, b) => compareStr(a.id, b.id));
  const debtsSorted = [...payload.debts].sort((a, b) => compareStr(a.id, b.id));
  const debtTransactionsSorted = [...payload.debt_transactions].sort((a, b) => compareStr(a.id, b.id));
  const budgetsSorted = [...payload.budgets].sort((a, b) => compareStr(a.id, b.id));
  const budgetCategoriesSorted = [...payload.budget_categories].sort((a, b) => compareStr(a.id, b.id));
  const goalsSorted = [...payload.savings_goals].sort((a, b) => compareStr(a.id, b.id));
  const goalEntriesSorted = [...payload.savings_goal_entries].sort((a, b) => compareStr(a.id, b.id));
  const schemaMigrationsSorted = [...payload.schema_migrations].sort((a, b) => a.version - b.version);

  return {
    accounts: computeSha256Hex(canonicalJsonStringify(accountsSorted)),
    categories: computeSha256Hex(canonicalJsonStringify(categoriesSorted)),
    transactions: computeSha256Hex(canonicalJsonStringify(transactionsSorted)),
    counterparties: computeSha256Hex(canonicalJsonStringify(counterpartiesSorted)),
    debts: computeSha256Hex(canonicalJsonStringify(debtsSorted)),
    debt_transactions: computeSha256Hex(canonicalJsonStringify(debtTransactionsSorted)),
    budgets: computeSha256Hex(canonicalJsonStringify(budgetsSorted)),
    budget_categories: computeSha256Hex(canonicalJsonStringify(budgetCategoriesSorted)),
    savings_goals: computeSha256Hex(canonicalJsonStringify(goalsSorted)),
    savings_goal_entries: computeSha256Hex(canonicalJsonStringify(goalEntriesSorted)),
    schema_migrations: computeSha256Hex(canonicalJsonStringify(schemaMigrationsSorted)),
  };
}

export function computeLegacyTableChecksums(payload: Record<string, any[]>): Record<string, string> {
  const names = ['accounts','categories','transactions','counterparties','debts','debt_transactions','schema_migrations'];
  const result: Record<string, string> = {};
  for (const name of names) {
    const rows = [...payload[name]].sort((a, b) => {
      const left = name === 'schema_migrations' ? a.version : a.id;
      const right = name === 'schema_migrations' ? b.version : b.id;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    result[name] = computeSha256Hex(canonicalJsonStringify(rows));
  }
  return result;
}

/**
 * Compresses a canonical UTF-8 JSON string using DEFLATE.
 */
export function compressJsonPayload(jsonString: string): Uint8Array {
  const bytes = new TextEncoder().encode(jsonString);
  return deflateSync(bytes);
}

/**
 * Decompresses a DEFLATE payload using bounded streaming decompression.
 * Aborts before allocating if decompressed data exceeds MAX_DECOMPRESSED_PAYLOAD_BYTES (decompression bomb protection).
 */
export function decompressPayload(
  compressedBytes: Uint8Array,
  maxBytes: number = MAX_DECOMPRESSED_PAYLOAD_BYTES
): string {
  let totalDecompressed = 0;
  const chunks: Uint8Array[] = [];
  let exceeded = false;

  const inflator = new Inflate((chunk) => {
    totalDecompressed += chunk.length;
    if (totalDecompressed > maxBytes) {
      exceeded = true;
      throw new RestoreError(
        'RESTORE_ERR_PAYLOAD_TOO_LARGE',
        `Decompressed backup payload exceeds safe limit (${totalDecompressed} > ${maxBytes} bytes).`
      );
    }
    chunks.push(chunk);
  });

  try {
    // Feed input in 1024-byte slices so the inflator can abort incrementally before processing huge bomb data
    const CHUNK_SIZE = 1024;
    for (let offset = 0; offset < compressedBytes.length; offset += CHUNK_SIZE) {
      if (exceeded) break;
      const end = Math.min(offset + CHUNK_SIZE, compressedBytes.length);
      const isFinal = end === compressedBytes.length;
      inflator.push(compressedBytes.subarray(offset, end), isFinal);
    }
  } catch (err: unknown) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(
      'RESTORE_ERR_DECOMPRESS_FAILED',
      `Decompression failed: ${err instanceof Error ? err.message : 'Invalid compressed stream'}`
    );
  }

  if (exceeded) {
    throw new RestoreError(
      'RESTORE_ERR_PAYLOAD_TOO_LARGE',
      `Decompressed backup payload exceeds safe limit (${totalDecompressed} > ${maxBytes} bytes).`
    );
  }

  // Combine chunks into single decoded string
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    combined.set(c, pos);
    pos += c.length;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Validates the structure of the parsed manifest, row counts against decoded arrays, and bounded limits.
 */
export function validateManifestStructure(manifest: unknown): BackupManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Manifest must be a valid JSON object.');
  }

  const m = manifest as Record<string, unknown>;

  if (m.manifestVersion !== 1 && m.manifestVersion !== 2) {
    throw new RestoreError('RESTORE_ERR_UNSUPPORTED_VERSION', `Unsupported manifest version: ${String(m.manifestVersion)}`);
  }
  if (typeof m.createdAtMs !== 'number' || !Number.isSafeInteger(m.createdAtMs) || m.createdAtMs <= 0) {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing or invalid createdAtMs in manifest.');
  }
  if (typeof m.schemaVersion !== 'number' || !Number.isSafeInteger(m.schemaVersion) || m.schemaVersion <= 0) {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing or invalid schemaVersion in manifest.');
  }
  if ((m.schemaVersion <= 7 && m.manifestVersion !== 1) || (m.schemaVersion === 8 && m.manifestVersion !== 2)) {
    throw new RestoreError('RESTORE_ERR_UNSUPPORTED_VERSION', 'Manifest version does not match schema version.');
  }
  if (typeof m.appVersion !== 'number' || !Number.isSafeInteger(m.appVersion) || m.appVersion <= 0) {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing or invalid appVersion in manifest.');
  }
  if (!m.rowCounts || typeof m.rowCounts !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing rowCounts in manifest.');
  }
  if (!m.tableChecksums || typeof m.tableChecksums !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing tableChecksums in manifest.');
  }
  if (!m.payload || typeof m.payload !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing payload in manifest.');
  }

  const p = m.payload as Record<string, unknown>;
  const rowCounts = m.rowCounts as Record<string, unknown>;
  const requiredTables = [
    'accounts',
    'categories',
    'transactions',
    'counterparties',
    'debts',
    'debt_transactions',
    'schema_migrations',
  ];
  if (m.manifestVersion === 2) {
    requiredTables.push('budgets','budget_categories','savings_goals','savings_goal_entries');
  }

  let totalRecords = 0;
  for (const table of requiredTables) {
    if (!Array.isArray(p[table])) {
      throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', `Payload table '${table}' must be an array.`);
    }
    const expectedCount = rowCounts[table];
    if (typeof expectedCount !== 'number' || expectedCount !== p[table].length) {
      throw new RestoreError(
        'RESTORE_ERR_ROW_COUNT_MISMATCH',
        `Manifest row count mismatch for table '${table}': declared ${String(expectedCount)}, found ${p[table].length}.`
      );
    }
    totalRecords += p[table].length;
  }

  if (totalRecords > MAX_TOTAL_RECORDS_LIMIT) {
    throw new RestoreError(
      'RESTORE_ERR_PAYLOAD_TOO_LARGE',
      `Backup total record count exceeds safe limit (${totalRecords} > ${MAX_TOTAL_RECORDS_LIMIT}).`
    );
  }

  return m as unknown as BackupManifest;
}

/**
 * Validates that header metadata and encrypted manifest metadata strictly agree.
 */
export function validateHeaderManifestConsistency(
  header: BackupHeader,
  manifest: BackupManifest
): void {
  if (header.schemaVersion !== manifest.schemaVersion) {
    throw new RestoreError(
      'RESTORE_ERR_HEADER_MISMATCH',
      `Header schema version (${header.schemaVersion}) does not match manifest schema version (${manifest.schemaVersion}).`
    );
  }
  if (header.appVersion !== manifest.appVersion) {
    throw new RestoreError(
      'RESTORE_ERR_HEADER_MISMATCH',
      `Header app version (${header.appVersion}) does not match manifest app version (${manifest.appVersion}).`
    );
  }
  if (header.createdAtMs !== manifest.createdAtMs) {
    throw new RestoreError(
      'RESTORE_ERR_HEADER_MISMATCH',
      `Header createdAtMs (${header.createdAtMs}) does not match manifest createdAtMs (${manifest.createdAtMs}).`
    );
  }
}
