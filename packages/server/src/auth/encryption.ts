import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';

let key: Buffer | null = null;

/**
 * Resolves the AES-256-GCM key from `ENCRYPTION_KEY` (64 hex chars). The key is
 * required — credentials are stored in a shared Supabase database, so an
 * ephemeral per-process key would make them unreadable across restarts and
 * instances. Startup validation (`validateConfig`) enforces its presence; this
 * throws as a defensive backstop if somehow reached without one.
 */
export function getEncryptionKey(): Buffer {
  if (key) return key;

  const configured = config.encryption.key;
  if (!configured) {
    throw new Error(
      'ENCRYPTION_KEY is required and must be a 64-character hex string (32 bytes).'
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }
  key = Buffer.from(configured, 'hex');
  return key;
}

/** Encrypts plaintext, returning `iv:authTag:ciphertext` (all hex). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Decrypts a value produced by `encrypt`. Throws on tampering or wrong key. */
export function decrypt(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Whether an encryption key came from the environment (vs auto-generated). */
export function isEncryptionKeyPersistent(): boolean {
  return Boolean(config.encryption.key);
}
