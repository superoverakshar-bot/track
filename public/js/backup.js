// Password-protected backups: PBKDF2-SHA-256 stretches the password into an
// AES-256-GCM key; the file holds salt, IV and ciphertext, never the password.
// Uses the Web Crypto API (browsers and Node 22 alike).
export const BACKUP_FORMAT = 'track-backup-encrypted';
const ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-SHA-256
export const MIN_PASSWORD = 8;

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(text, password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return JSON.stringify({
    format: BACKUP_FORMAT, v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    data: b64(data),
  });
}

export function isEncryptedBackup(text) {
  try { return JSON.parse(text)?.format === BACKUP_FORMAT; } catch { return false; }
}

export async function decryptBackup(text, password) {
  const f = JSON.parse(text);
  if (f?.format !== BACKUP_FORMAT || f.v !== 1 || f.kdf?.name !== 'PBKDF2' || f.cipher?.name !== 'AES-GCM') throw new Error('Not a Track encrypted backup');
  const iterations = Number(f.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) throw new Error('Damaged backup file');
  try {
    const key = await deriveKey(password, unb64(f.kdf.salt), iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.cipher.iv) }, key, unb64(f.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong password or damaged file');
  }
}
