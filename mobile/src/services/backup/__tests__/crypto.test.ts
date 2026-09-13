import {
  deriveKeyFromPassphrase,
  serializeHeader,
  parseHeader,
  encryptPayloadWithHeader,
  decryptPayloadWithHeader,
  getSecureRandomBytes,
  computeSha256Hex,
  validateKdfBounds,
} from '../crypto';
import {
  HEADER_SIZE_BYTES,
  FLAG_COMPRESSED_DEFLATE,
  CURRENT_DATABASE_SCHEMA_VERSION,
  RestoreError,
} from '../types';

describe('Backup Cryptography Subsystem', () => {
  const testPassphrase = 'CorrectHorseBatteryStaple123!';
  const fastKdfParams = { N: 16384, r: 8, p: 1 }; // Minimum valid bounds for fast test execution

  it('generates secure random bytes of correct length and uniqueness', () => {
    const b1 = getSecureRandomBytes(16);
    const b2 = getSecureRandomBytes(16);
    expect(b1.length).toBe(16);
    expect(b2.length).toBe(16);
    expect(Buffer.from(b1).equals(Buffer.from(b2))).toBe(false);
  });

  it('computes deterministic SHA-256 hex string', () => {
    const hash = computeSha256Hex('barakah');
    expect(hash).toHaveLength(64);
    expect(computeSha256Hex('barakah')).toBe(hash);
    expect(computeSha256Hex('different')).not.toBe(hash);
  });

  it('serializes and parses 60-byte header with complete fidelity', () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const now = Date.now();

    const headerBytes = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: 32768,
      kdfR: 8,
      kdfP: 1,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      appVersion: 100,
      flags: FLAG_COMPRESSED_DEFLATE,
      createdAtMs: now,
    });

    expect(headerBytes.length).toBe(HEADER_SIZE_BYTES);

    const parsed = parseHeader(headerBytes);
    expect(parsed.magic).toBe('BMZ1');
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.kdfId).toBe(1);
    expect(parsed.kdfN).toBe(32768);
    expect(parsed.kdfR).toBe(8);
    expect(parsed.kdfP).toBe(1);
    expect(Buffer.from(parsed.salt).equals(Buffer.from(salt))).toBe(true);
    expect(parsed.cipherId).toBe(1);
    expect(Buffer.from(parsed.nonce).equals(Buffer.from(nonce))).toBe(true);
    expect(parsed.schemaVersion).toBe(CURRENT_DATABASE_SCHEMA_VERSION);
    expect(parsed.appVersion).toBe(100);
    expect(parsed.flags).toBe(FLAG_COMPRESSED_DEFLATE);
    expect(parsed.createdAtMs).toBe(now);
    expect(parsed.rawHeaderBytes.length).toBe(HEADER_SIZE_BYTES);
  });

  it('rejects invalid magic bytes in header', () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const headerBytes = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: 32768,
      kdfR: 8,
      kdfP: 1,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: 5,
      appVersion: 100,
      flags: 0,
      createdAtMs: Date.now(),
    });

    // Corrupt magic
    headerBytes[0] = 0x58; // 'X' instead of 'B'
    expect(() => parseHeader(headerBytes)).toThrow(RestoreError);
    expect(() => parseHeader(headerBytes)).toThrow(/invalid magic/i);
  });

  it('enforces safe KDF parameter bounds', () => {
    // Normal bounds pass
    expect(() => validateKdfBounds(32768, 8, 1)).not.toThrow();

    // N too low
    expect(() => validateKdfBounds(4096, 8, 1)).toThrow(RestoreError);
    // N too high (DoS attempt)
    expect(() => validateKdfBounds(131072, 8, 1)).toThrow(RestoreError);
    // N not power of 2
    expect(() => validateKdfBounds(30000, 8, 1)).toThrow(RestoreError);
    // r too low
    expect(() => validateKdfBounds(16384, 4, 1)).toThrow(RestoreError);
    // r too high
    expect(() => validateKdfBounds(16384, 32, 1)).toThrow(RestoreError);
    // p too high
    expect(() => validateKdfBounds(16384, 8, 4)).toThrow(RestoreError);
  });

  it('encrypts and decrypts payload successfully with correct passphrase', async () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);

    const header = parseHeader(
      serializeHeader({
        formatVersion: 1,
        kdfId: 1,
        kdfN: fastKdfParams.N,
        kdfR: fastKdfParams.r,
        kdfP: fastKdfParams.p,
        salt,
        cipherId: 1,
        nonce,
        schemaVersion: 5,
        appVersion: 100,
        flags: 0,
        createdAtMs: Date.now(),
      })
    );

    const plaintext = new TextEncoder().encode('Barakah Confidential Financial Snapshot');
    const envelope = encryptPayloadWithHeader(plaintext, key, header);

    expect(envelope.length).toBe(HEADER_SIZE_BYTES + plaintext.length + 16);

    // Extract ciphertext from envelope
    const ciphertextWithTag = envelope.slice(HEADER_SIZE_BYTES);
    const decrypted = decryptPayloadWithHeader(ciphertextWithTag, key, header);

    expect(new TextDecoder().decode(decrypted)).toBe('Barakah Confidential Financial Snapshot');
  });

  it('rejects decryption with incorrect passphrase', async () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const correctKey = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);
    const wrongKey = await deriveKeyFromPassphrase('WrongPassphrase12345!', salt, fastKdfParams);

    const header = parseHeader(
      serializeHeader({
        formatVersion: 1,
        kdfId: 1,
        kdfN: fastKdfParams.N,
        kdfR: fastKdfParams.r,
        kdfP: fastKdfParams.p,
        salt,
        cipherId: 1,
        nonce,
        schemaVersion: 5,
        appVersion: 100,
        flags: 0,
        createdAtMs: Date.now(),
      })
    );

    const plaintext = new TextEncoder().encode('Secret Data');
    const envelope = encryptPayloadWithHeader(plaintext, correctKey, header);
    const ciphertextWithTag = envelope.slice(HEADER_SIZE_BYTES);

    expect(() => decryptPayloadWithHeader(ciphertextWithTag, wrongKey, header)).toThrow(RestoreError);
  });

  it('rejects decryption if header (AAD) has been tampered with', async () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);

    const rawHeader = serializeHeader({
      formatVersion: 1,
      kdfId: 1,
      kdfN: fastKdfParams.N,
      kdfR: fastKdfParams.r,
      kdfP: fastKdfParams.p,
      salt,
      cipherId: 1,
      nonce,
      schemaVersion: 5,
      appVersion: 100,
      flags: 0,
      createdAtMs: Date.now(),
    });

    const header = parseHeader(rawHeader);
    const plaintext = new TextEncoder().encode('Data to tamper');
    const envelope = encryptPayloadWithHeader(plaintext, key, header);
    const ciphertextWithTag = envelope.slice(HEADER_SIZE_BYTES);

    // Modify 1 byte in the header
    const tamperedHeaderBytes = new Uint8Array(rawHeader);
    tamperedHeaderBytes[50] ^= 0x01; // flip flag bit
    const tamperedHeader = { ...header, rawHeaderBytes: tamperedHeaderBytes };

    expect(() => decryptPayloadWithHeader(ciphertextWithTag, key, tamperedHeader)).toThrow(RestoreError);
  });

  it('rejects decryption if ciphertext has been bit-flipped', async () => {
    const salt = getSecureRandomBytes(16);
    const nonce = getSecureRandomBytes(12);
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, fastKdfParams);

    const header = parseHeader(
      serializeHeader({
        formatVersion: 1,
        kdfId: 1,
        kdfN: fastKdfParams.N,
        kdfR: fastKdfParams.r,
        kdfP: fastKdfParams.p,
        salt,
        cipherId: 1,
        nonce,
        schemaVersion: 5,
        appVersion: 100,
        flags: 0,
        createdAtMs: Date.now(),
      })
    );

    const plaintext = new TextEncoder().encode('Sensitive records');
    const envelope = encryptPayloadWithHeader(plaintext, key, header);
    const ciphertextWithTag = envelope.slice(HEADER_SIZE_BYTES);

    // Flip 1 byte in the ciphertext
    ciphertextWithTag[5] ^= 0xff;

    expect(() => decryptPayloadWithHeader(ciphertextWithTag, key, header)).toThrow(RestoreError);
  });
});
