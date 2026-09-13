/**
 * Canonical Serializer, Table Checksum Engine & Compression
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - Deterministic JSON serialization (sorted keys, stable row sorting)
 * - Table-level SHA-256 checksum generation & validation
 * - DEFLATE compression & safe decompression with 50 MB bound checks
 * - Manifest validation
 */

import { deflateSync, inflateSync } from 'fflate';
import {
  BackupManifest,
  BackupPayloadData,
  TableChecksums,
  MAX_DECOMPRESSED_PAYLOAD_BYTES,
  RestoreError,
} from './types';
import { computeSha256Hex } from './crypto';

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
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + canonicalJsonStringify(record[key])
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 checksums for each table payload.
 * Rows are sorted deterministically before hashing.
 */
export function computeTableChecksums(payload: BackupPayloadData): TableChecksums {
  const accountsSorted = [...payload.accounts].sort((a, b) => a.id.localeCompare(b.id));
  const categoriesSorted = [...payload.categories].sort((a, b) => a.id.localeCompare(b.id));
  const transactionsSorted = [...payload.transactions].sort((a, b) => a.id.localeCompare(b.id));
  const counterpartiesSorted = [...payload.counterparties].sort((a, b) => a.id.localeCompare(b.id));
  const debtsSorted = [...payload.debts].sort((a, b) => a.id.localeCompare(b.id));
  const debtTransactionsSorted = [...payload.debt_transactions].sort((a, b) => a.id.localeCompare(b.id));
  const schemaMigrationsSorted = [...payload.schema_migrations].sort((a, b) => a.version - b.version);

  return {
    accounts: computeSha256Hex(canonicalJsonStringify(accountsSorted)),
    categories: computeSha256Hex(canonicalJsonStringify(categoriesSorted)),
    transactions: computeSha256Hex(canonicalJsonStringify(transactionsSorted)),
    counterparties: computeSha256Hex(canonicalJsonStringify(counterpartiesSorted)),
    debts: computeSha256Hex(canonicalJsonStringify(debtsSorted)),
    debt_transactions: computeSha256Hex(canonicalJsonStringify(debtTransactionsSorted)),
    schema_migrations: computeSha256Hex(canonicalJsonStringify(schemaMigrationsSorted)),
  };
}

/**
 * Compresses a canonical UTF-8 JSON string using DEFLATE.
 */
export function compressJsonPayload(jsonString: string): Uint8Array {
  const bytes = new TextEncoder().encode(jsonString);
  return deflateSync(bytes);
}

/**
 * Decompresses a DEFLATE payload and enforces the 50 MB security bound.
 */
export function decompressPayload(compressedBytes: Uint8Array): string {
  try {
    const decompressed = inflateSync(compressedBytes);
    if (decompressed.length > MAX_DECOMPRESSED_PAYLOAD_BYTES) {
      throw new RestoreError(
        'RESTORE_ERR_PAYLOAD_TOO_LARGE',
        `Decompressed backup payload exceeds safe limit (${decompressed.length} > ${MAX_DECOMPRESSED_PAYLOAD_BYTES} bytes).`
      );
    }
    return new TextDecoder().decode(decompressed);
  } catch (err: unknown) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(
      'RESTORE_ERR_DECOMPRESS_FAILED',
      `Decompression failed: ${err instanceof Error ? err.message : 'Invalid compressed stream'}`
    );
  }
}

/**
 * Validates the structure of the parsed manifest.
 */
export function validateManifestStructure(manifest: unknown): BackupManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Manifest must be a valid JSON object.');
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.manifestVersion !== 'number' || m.manifestVersion !== 1) {
    throw new RestoreError('RESTORE_ERR_UNSUPPORTED_VERSION', `Unsupported manifest version: ${String(m.manifestVersion)}`);
  }
  if (typeof m.createdAtMs !== 'number') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing createdAtMs in manifest.');
  }
  if (typeof m.schemaVersion !== 'number') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing schemaVersion in manifest.');
  }
  if (!m.tableChecksums || typeof m.tableChecksums !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing tableChecksums in manifest.');
  }
  if (!m.payload || typeof m.payload !== 'object') {
    throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', 'Missing payload in manifest.');
  }

  const p = m.payload as Record<string, unknown>;
  const requiredTables = [
    'accounts',
    'categories',
    'transactions',
    'counterparties',
    'debts',
    'debt_transactions',
    'schema_migrations',
  ];

  for (const table of requiredTables) {
    if (!Array.isArray(p[table])) {
      throw new RestoreError('RESTORE_ERR_INVALID_MANIFEST', `Payload table '${table}' must be an array.`);
    }
  }

  return m as unknown as BackupManifest;
}
