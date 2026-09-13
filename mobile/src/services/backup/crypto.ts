/**
 * Cryptographic Subsystem for Barakah Encrypted Backups
 * Phase 4: Recovery Foundation
 *
 * Implements:
 * - Scrypt key derivation with bounded limits (ADR-016)
 * - AES-256-GCM authenticated encryption and decryption
 * - 60-byte binary header envelope serialization & parsing as AAD
 * - CSPRNG salt and nonce generation via expo-crypto
 * - Zero-logging of passphrases or derived keys
 */

import * as Crypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  BACKUP_MAGIC_BYTES,
  BACKUP_FORMAT_VERSION,
  HEADER_SIZE_BYTES,
  SALT_SIZE_BYTES,
  NONCE_SIZE_BYTES,
  KDF_BOUNDS,
  DEFAULT_KDF_PARAMS,
  BackupHeader,
  RestoreError,
  MIN_PASSPHRASE_LENGTH,
} from './types';

/**
 * Generates cryptographically secure random bytes.
 * Works seamlessly across React Native (via expo-crypto) and Node/Jest test runners.
 */
export function getSecureRandomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(bytes);
  }
  if (typeof Crypto.getRandomValues === 'function') {
    return Crypto.getRandomValues(bytes);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto');
  return new Uint8Array(nodeCrypto.randomBytes(byteLength));
}

/**
 * Computes deterministic SHA-256 hash formatted as lowercase hex.
 */
export function computeSha256Hex(data: Uint8Array | string): string {
  const inputBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBytes = sha256(inputBytes);
  let hex = '';
  for (let i = 0; i < hashBytes.length; i++) {
    hex += hashBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Validates KDF parameters against strict bounds to prevent DoS / resource-exhaustion.
 */
export function validateKdfBounds(N: number, r: number, p: number): void {
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    N < KDF_BOUNDS.MIN_N ||
    N > KDF_BOUNDS.MAX_N ||
    (N & (N - 1)) !== 0 || // N must be a power of 2
    r < KDF_BOUNDS.MIN_R ||
    r > KDF_BOUNDS.MAX_R ||
    p < KDF_BOUNDS.MIN_P ||
    p > KDF_BOUNDS.MAX_P
  ) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_KDF',
      `Unsupported or unsafe KDF parameters: N=${N}, r=${r}, p=${p}`
    );
  }
}

/**
 * Derives a 32-byte (256-bit) AES key from passphrase and salt using Scrypt.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  kdfParams: { N: number; r: number; p: number } = DEFAULT_KDF_PARAMS
): Promise<Uint8Array> {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new RestoreError(
      'RESTORE_ERR_AUTH_FAILED',
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`
    );
  }

  validateKdfBounds(kdfParams.N, kdfParams.r, kdfParams.p);

  const passwordBytes = new TextEncoder().encode(passphrase);
  try {
    return await scryptAsync(passwordBytes, salt, {
      N: kdfParams.N,
      r: kdfParams.r,
      p: kdfParams.p,
      dkLen: KDF_BOUNDS.DK_LEN,
    });
  } catch (err: unknown) {
    throw new RestoreError(
      'RESTORE_ERR_AUTH_FAILED',
      `Key derivation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/**
 * Serializes the 60-byte authenticated header.
 */
export function serializeHeader(
  params: Omit<BackupHeader, 'magic' | 'rawHeaderBytes'>
): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 0..3: Magic 'BKBK'
  bytes[0] = BACKUP_MAGIC_BYTES[0];
  bytes[1] = BACKUP_MAGIC_BYTES[1];
  bytes[2] = BACKUP_MAGIC_BYTES[2];
  bytes[3] = BACKUP_MAGIC_BYTES[3];

  // 4..5: Format Version (uint16)
  view.setUint16(4, params.formatVersion, false);

  // 6..7: KDF ID (uint16)
  view.setUint16(6, params.kdfId, false);

  // 8..11: KDF N (uint32)
  view.setUint32(8, params.kdfN, false);

  // 12..13: KDF r (uint16)
  view.setUint16(12, params.kdfR, false);

  // 14..15: KDF p (uint16)
  view.setUint16(14, params.kdfP, false);

  // 16..31: Salt (16 bytes)
  if (params.salt.length !== SALT_SIZE_BYTES) {
    throw new Error(`Salt must be exactly ${SALT_SIZE_BYTES} bytes.`);
  }
  bytes.set(params.salt, 16);

  // 32..33: Cipher ID (uint16)
  view.setUint16(32, params.cipherId, false);

  // 34..45: Nonce (12 bytes)
  if (params.nonce.length !== NONCE_SIZE_BYTES) {
    throw new Error(`Nonce must be exactly ${NONCE_SIZE_BYTES} bytes.`);
  }
  bytes.set(params.nonce, 34);

  // 46..47: Schema Version (uint16)
  view.setUint16(46, params.schemaVersion, false);

  // 48..49: App Version (uint16)
  view.setUint16(48, params.appVersion, false);

  // 50..51: Flags (uint16)
  view.setUint16(50, params.flags, false);

  // 52..59: Created At Timestamp (uint64 BigInt)
  view.setBigUint64(52, BigInt(params.createdAtMs), false);

  return bytes;
}

/**
 * Parses and validates the 60-byte authenticated header.
 */
export function parseHeader(headerBytes: Uint8Array): BackupHeader {
  if (headerBytes.length < HEADER_SIZE_BYTES) {
    throw new RestoreError(
      'RESTORE_ERR_FILE_TRUNCATED',
      `Header truncated: expected ${HEADER_SIZE_BYTES} bytes, got ${headerBytes.length}`
    );
  }

  const rawHeaderBytes = headerBytes.slice(0, HEADER_SIZE_BYTES);
  const view = new DataView(
    rawHeaderBytes.buffer,
    rawHeaderBytes.byteOffset,
    rawHeaderBytes.byteLength
  );

  // Validate Magic bytes 'BKBK'
  if (
    rawHeaderBytes[0] !== BACKUP_MAGIC_BYTES[0] ||
    rawHeaderBytes[1] !== BACKUP_MAGIC_BYTES[1] ||
    rawHeaderBytes[2] !== BACKUP_MAGIC_BYTES[2] ||
    rawHeaderBytes[3] !== BACKUP_MAGIC_BYTES[3]
  ) {
    throw new RestoreError(
      'RESTORE_ERR_INVALID_MAGIC',
      'Unrecognised file format: invalid magic header.'
    );
  }

  const formatVersion = view.getUint16(4, false);
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_VERSION',
      `Backup format version ${formatVersion} is newer than supported version (${BACKUP_FORMAT_VERSION}).`
    );
  }

  const kdfId = view.getUint16(6, false);
  if (kdfId !== 1) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_KDF',
      `Unsupported KDF algorithm identifier: ${kdfId}`
    );
  }

  const kdfN = view.getUint32(8, false);
  const kdfR = view.getUint16(12, false);
  const kdfP = view.getUint16(14, false);

  validateKdfBounds(kdfN, kdfR, kdfP);

  const salt = rawHeaderBytes.slice(16, 32);
  const cipherId = view.getUint16(32, false);
  if (cipherId !== 1) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_VERSION',
      `Unsupported cipher algorithm identifier: ${cipherId}`
    );
  }

  const nonce = rawHeaderBytes.slice(34, 46);
  const schemaVersion = view.getUint16(46, false);
  const appVersion = view.getUint16(48, false);
  const flags = view.getUint16(50, false);
  const createdAtMs = Number(view.getBigUint64(52, false));

  return {
    magic: 'BKBK',
    formatVersion,
    kdfId,
    kdfN,
    kdfR,
    kdfP,
    salt,
    cipherId,
    nonce,
    schemaVersion,
    appVersion,
    createdAtMs,
    flags,
    rawHeaderBytes,
  };
}

/**
 * Encrypts payload with AES-256-GCM using rawHeaderBytes as AAD.
 * Appends 16-byte authentication tag automatically.
 */
export function encryptPayloadWithHeader(
  plaintext: Uint8Array,
  key: Uint8Array,
  header: BackupHeader
): Uint8Array {
  const cipher = gcm(key, header.nonce, header.rawHeaderBytes);
  const ciphertextWithTag = cipher.encrypt(plaintext);

  // Combine 60-byte header + ciphertextWithTag into final .fmz envelope
  const combined = new Uint8Array(header.rawHeaderBytes.length + ciphertextWithTag.length);
  combined.set(header.rawHeaderBytes, 0);
  combined.set(ciphertextWithTag, header.rawHeaderBytes.length);

  return combined;
}

/**
 * Authenticates and decrypts an encrypted payload with AES-256-GCM using the 60-byte header as AAD.
 * Throws RESTORE_ERR_AUTH_FAILED on tag mismatch, wrong passphrase, or tampered header/ciphertext.
 */
export function decryptPayloadWithHeader(
  ciphertextWithTag: Uint8Array,
  key: Uint8Array,
  header: BackupHeader
): Uint8Array {
  try {
    const cipher = gcm(key, header.nonce, header.rawHeaderBytes);
    return cipher.decrypt(ciphertextWithTag);
  } catch {
    throw new RestoreError(
      'RESTORE_ERR_AUTH_FAILED',
      'Decryption failed: authentication tag mismatch, wrong passphrase, or file tampering.'
    );
  }
}
