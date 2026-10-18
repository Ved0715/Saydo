/**
 * Sealed state: the browser carries it, but it is encrypted and authenticated
 * (AES-256-GCM, key derived from the secret with HKDF-SHA-256). A script in the
 * page can neither read nor rewrite earlier tool calls, results, approvals or
 * entity handles. Works on Node and edge runtimes (WebCrypto only).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 'v2';
const AAD = encoder.encode('saydo.seal.v2');

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function sealKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('saydo'), info: encoder.encode('seal aes-256-gcm v2') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(secret, key);
  }
  return key;
}

export async function seal(payload: unknown, secret: string): Promise<string> {
  assertSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await sealKey(secret), encoder.encode(JSON.stringify(payload))),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return `${VERSION}.${toBase64Url(out)}`;
}

/** Returns null for anything malformed, tampered with, or sealed with another secret. */
export async function unseal<T>(token: string, secret: string): Promise<T | null> {
  assertSecret(secret);
  if (typeof token !== 'string' || !token.startsWith(`${VERSION}.`) || token.length > 1_000_000) return null;
  try {
    const bytes = fromBase64Url(token.slice(VERSION.length + 1));
    if (bytes.length < 12 + 16) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: AAD }, await sealKey(secret), bytes.subarray(12));
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    return null;
  }
}

function assertSecret(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error('saydo: secret must be at least 32 characters (fix: set SAYDO_SECRET to a long random string).');
  }
}
