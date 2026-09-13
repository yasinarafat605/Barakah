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
  MIN_RESTORABLE_SCHEMA_VERSION,
  MAX_RESTORABLE_SCHEMA_VERSION,
  CIPHER_ID_AES_256_GCM,
  KDF_ID_SCRYPT,
  FLAGS_RESERVED_MASK,
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
 * Serializes the exact 60-byte authenticated header.
 * Byte Offsets:
 *   0..3   (4 bytes):  Magic 'BMZ1' (0x42, 0x4D, 0x5A, 0x31)
 *   4..5   (2 bytes):  Format Version uint16 (Big-Endian)
 *   6..7   (2 bytes):  Schema Version uint16 (Big-Endian)
 *   8..15  (8 bytes):  Created At Timestamp uint64 (Big-Endian ms)
 *   16     (1 byte):   KDF ID uint8 (1 = Scrypt)
 *   17..20 (4 bytes):  KDF N uint32 (Big-Endian)
 *   21..24 (4 bytes):  KDF r uint32 (Big-Endian)
 *   25..28 (4 bytes):  KDF p uint32 (Big-Endian)
 *   29..44 (16 bytes): Salt (16 random bytes)
 *   45     (1 byte):   Cipher ID uint8 (1 = AES-256-GCM)
 *   46..57 (12 bytes): Nonce (12 random bytes)
 *   58     (1 byte):   App Version uint8 (Major version)
 *   59     (1 byte):   Flags uint8 (Bit 0 = DEFLATE, Bits 1..7 reserved = 0)
 */
export function serializeHeader(
  params: Omit<BackupHeader, 'magic' | 'rawHeaderBytes'>
): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE_BYTES);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 0..3: Magic 'BMZ1'
  bytes[0] = BACKUP_MAGIC_BYTES[0]; // 0x42
  bytes[1] = BACKUP_MAGIC_BYTES[1]; // 0x4D
  bytes[2] = BACKUP_MAGIC_BYTES[2]; // 0x5A
  bytes[3] = BACKUP_MAGIC_BYTES[3]; // 0x31

  // 4..5: Format Version (uint16 BE)
  view.setUint16(4, params.formatVersion, false);

  // 6..7: Schema Version (uint16 BE)
  view.setUint16(6, params.schemaVersion, false);

  // 8..15: Created At Timestamp (uint64 BE BigInt)
  view.setBigUint64(8, BigInt(params.createdAtMs), false);

  // 16: KDF ID (uint8)
  view.setUint8(16, params.kdfId);

  // 17..20: KDF N (uint32 BE)
  view.setUint32(17, params.kdfN, false);

  // 21..24: KDF r (uint32 BE)
  view.setUint32(21, params.kdfR, false);

  // 25..28: KDF p (uint32 BE)
  view.setUint32(25, params.kdfP, false);

  // 29..44: Salt (16 bytes)
  if (params.salt.length !== SALT_SIZE_BYTES) {
    throw new Error(`Salt must be exactly ${SALT_SIZE_BYTES} bytes.`);
  }
  bytes.set(params.salt, 29);

  // 45: Cipher ID (uint8)
  view.setUint8(45, params.cipherId);

  // 46..57: Nonce (12 bytes)
  if (params.nonce.length !== NONCE_SIZE_BYTES) {
    throw new Error(`Nonce must be exactly ${NONCE_SIZE_BYTES} bytes.`);
  }
  bytes.set(params.nonce, 46);

  // 58: App Version (uint8)
  view.setUint8(58, params.appVersion);

  // 59: Flags (uint8)
  view.setUint8(59, params.flags);

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

  // Validate Magic bytes 'BMZ1'
  if (
    rawHeaderBytes[0] !== BACKUP_MAGIC_BYTES[0] ||
    rawHeaderBytes[1] !== BACKUP_MAGIC_BYTES[1] ||
    rawHeaderBytes[2] !== BACKUP_MAGIC_BYTES[2] ||
    rawHeaderBytes[3] !== BACKUP_MAGIC_BYTES[3]
  ) {
    throw new RestoreError(
      'RESTORE_ERR_INVALID_MAGIC',
      'Unrecognised file format: invalid magic header. Must begin with BMZ1.'
    );
  }

  const formatVersion = view.getUint16(4, false);
  if (formatVersion === 0 || formatVersion > BACKUP_FORMAT_VERSION) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_VERSION',
      `Backup format version ${formatVersion} is not supported (current supported version is ${BACKUP_FORMAT_VERSION}).`
    );
  }

  const schemaVersion = view.getUint16(6, false);
  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < MIN_RESTORABLE_SCHEMA_VERSION ||
    schemaVersion > MAX_RESTORABLE_SCHEMA_VERSION
  ) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_SCHEMA_VERSION',
      `Schema version ${schemaVersion} is outside supported range (${MIN_RESTORABLE_SCHEMA_VERSION}..${MAX_RESTORABLE_SCHEMA_VERSION}).`
    );
  }

  const createdAtMs = Number(view.getBigUint64(8, false));
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 1577836800000 || createdAtMs > 4102444800000) {
    throw new RestoreError(
      'RESTORE_ERR_SCHEMA_VALIDATION',
      'Invalid creation timestamp in backup header.'
    );
  }

  const kdfId = view.getUint8(16);
  if (kdfId !== KDF_ID_SCRYPT) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_KDF',
      `Unsupported KDF algorithm identifier: ${kdfId}. Expected Scrypt (1).`
    );
  }

  const kdfN = view.getUint32(17, false);
  const kdfR = view.getUint32(21, false);
  const kdfP = view.getUint32(25, false);

  validateKdfBounds(kdfN, kdfR, kdfP);

  const salt = rawHeaderBytes.slice(29, 45);
  const cipherId = view.getUint8(45);
  if (cipherId !== CIPHER_ID_AES_256_GCM) {
    throw new RestoreError(
      'RESTORE_ERR_UNSUPPORTED_CIPHER',
      `Unsupported cipher algorithm identifier: ${cipherId}. Expected AES-256-GCM (1).`
    );
  }

  const nonce = rawHeaderBytes.slice(46, 58);
  const appVersion = view.getUint8(58);
  if (!Number.isSafeInteger(appVersion) || appVersion <= 0) {
    throw new RestoreError(
      'RESTORE_ERR_SCHEMA_VALIDATION',
      'Invalid app version in backup header.'
    );
  }

  const flags = view.getUint8(59);
  if ((flags & FLAGS_RESERVED_MASK) !== 0) {
    throw new RestoreError(
      'RESTORE_ERR_INVALID_FLAGS',
      `Unknown reserved flag bits set in backup header: ${flags}.`
    );
  }

  return {
    magic: 'BMZ1',
    formatVersion,
    schemaVersion,
    createdAtMs,
    kdfId,
    kdfN,
    kdfR,
    kdfP,
    salt,
    cipherId,
    nonce,
    appVersion,
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
