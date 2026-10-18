/**
 * Tamper-proof thread state. The client carries the conversation, but it is
 * HMAC-signed, so a script in the page cannot rewrite earlier tool calls,
 * results, approvals, or entity handles. Works on Node and edge runtimes.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

export async function seal(payload: unknown, secret: string): Promise<string> {
  assertSecret(secret);
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns null for anything malformed or tampered with. Verification is constant-time. */
export async function unseal<T>(token: string, secret: string): Promise<T | null> {
  assertSecret(secret);
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(token.slice(dot + 1)) as Uint8Array<ArrayBuffer>,
      encoder.encode(body),
    );
    if (!valid) return null;
    return JSON.parse(decoder.decode(fromBase64Url(body))) as T;
  } catch {
    return null;
  }
}

function assertSecret(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error('saydo: secret must be at least 32 characters (fix: set SAYDO_SECRET to a long random string).');
  }
}
