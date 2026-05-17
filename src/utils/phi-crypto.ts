import crypto from 'crypto';

const ALGO       = 'aes-256-gcm';
const KEY_ENV    = 'PHI_ENCRYPTION_KEY'; // 64-char hex = 32 bytes
const IV_LENGTH  = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env[KEY_ENV];
  if (!hex || hex.length !== 64) {
    throw new Error(`${KEY_ENV} must be a 64-character hex string (32 bytes). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  }
  return Buffer.from(hex, 'hex');
}

// Returns "iv:authTag:ciphertext" all base64-encoded
export function encryptPHI(plaintext: string): string {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

// Returns null if the value looks unencrypted (legacy plaintext — for migration)
export function decryptPHI(ciphertext: string): string {
  if (!ciphertext.includes(':')) return ciphertext; // legacy plaintext passthrough
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivB64, tagB64, dataB64] = parts;
  const key      = getKey();
  const iv       = Buffer.from(ivB64,  'base64');
  const tag      = Buffer.from(tagB64, 'base64');
  const data     = Buffer.from(dataB64,'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// Helper — only encrypt if value is present
export const encryptIfPresent = (v?: string | null): string | undefined =>
  v != null ? encryptPHI(v) : undefined;

export const decryptIfPresent = (v?: string | null): string | undefined =>
  v != null ? decryptPHI(v) : undefined;

/**
 * Deterministic HMAC-SHA256 of a value using the PHI key.
 * Used as a lookup hash — never exposed to clients.
 * Same input always produces the same output (no IV), so it's queryable.
 */
export function hmacHash(value: string): string {
  const key = getKey();
  return crypto.createHmac('sha256', key).update(value.toLowerCase().trim()).digest('hex');
}

export const hmacHashIfPresent = (v?: string | null): string | undefined =>
  v != null ? hmacHash(v) : undefined;
