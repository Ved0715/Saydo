import type { StepUpOptions } from './engine';
import type { SqlClient } from './grants';
import type { SaydoUser, StepUpChallenge } from './types';

/**
 * Passkey (WebAuthn) step-up with no dependencies: WebCrypto verifies the
 * assertion signature, origin, relying-party hash, user-verification flag and
 * signature counter. Registration stores the public key the browser returns
 * from `getPublicKey()` (SPKI), so no CBOR or attestation parsing is needed.
 */

export interface Passkey {
  /** Credential id, base64url. */
  id: string;
  userId: string;
  /** SubjectPublicKeyInfo (DER), base64url. */
  publicKey: string;
  /** COSE algorithm: -7 (ES256) or -257 (RS256). */
  algorithm: number;
  counter: number;
  createdAt: number;
  name?: string;
  transports?: string[];
}

export interface PasskeyStore {
  list(userId: string): Promise<Passkey[]>;
  get(id: string): Promise<Passkey | undefined>;
  save(passkey: Passkey): Promise<void>;
  updateCounter(id: string, counter: number): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface WebAuthnOptions {
  /** Relying party id: your registrable domain, e.g. 'example.com' ('localhost' in dev). */
  rpId: string;
  rpName?: string;
  /** Allowed origins, e.g. 'https://app.example.com'. */
  origins: string | string[];
  passkeys: PasskeyStore;
  when?: StepUpOptions['when'];
  fallback?: StepUpOptions['fallback'];
  timeoutMs?: number;
  /**
   * Who may add a passkey. Adding one must itself be protected (for example a
   * recent sign-in), or a stolen session could add its own. Default: nobody.
   */
  allowRegistration?: (user: SaydoUser, request?: Request) => boolean | Promise<boolean>;
}

// ---------------------------------------------------------------- encoding

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const randomChallenge = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** WebAuthn ES256 signatures are DER; WebCrypto wants raw r||s (64 bytes). */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error('bad signature');
  let offset = 2;
  const read = () => {
    if (der[offset] !== 0x02) throw new Error('bad signature');
    const length = der[offset + 1]!;
    let value = der.slice(offset + 2, offset + 2 + length);
    offset += 2 + length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const raw = new Uint8Array(64);
  raw.set(read(), 0);
  raw.set(read(), 32);
  return raw;
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

function parseClientData(encoded: string): ClientData | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as ClientData;
  } catch {
    return null;
  }
}

/** rpIdHash (32) · flags (1) · signCount (4) · … */
function parseAuthData(bytes: Uint8Array) {
  if (bytes.length < 37) return null;
  const flags = bytes[32]!;
  return {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false),
  };
}

async function importKey(passkey: Passkey): Promise<{ key: CryptoKey; params: AlgorithmIdentifier | EcdsaParams }> {
  const spki = fromBase64Url(passkey.publicKey);
  if (passkey.algorithm === -7) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return { key, params: { name: 'ECDSA', hash: 'SHA-256' } };
  }
  if (passkey.algorithm === -257) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return { key, params: { name: 'RSASSA-PKCS1-v1_5' } };
  }
  throw new Error(`unsupported algorithm ${passkey.algorithm}`);
}

/** The browser's serialized assertion (all fields base64url). */
export interface AssertionProof {
  id: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
}

/** The browser's serialized registration, using getPublicKey()/getAuthenticatorData(). */
export interface RegistrationCredential {
  id: string;
  response: { clientDataJSON: string; authenticatorData: string; publicKey: string; publicKeyAlgorithm: number; transports?: string[] };
}

// ---------------------------------------------------------------- stores

export function memoryPasskeyStore(): PasskeyStore {
  const keys = new Map<string, Passkey>();
  return {
    async list(userId) {
      return [...keys.values()].filter((k) => k.userId === userId);
    },
    async get(id) {
      return keys.get(id);
    },
    async save(passkey) {
      keys.set(passkey.id, { ...passkey });
    },
    async updateCounter(id, counter) {
      const key = keys.get(id);
      if (key) key.counter = counter;
    },
    async remove(id) {
      keys.delete(id);
    },
  };
}

export function postgresPasskeyStore(client: SqlClient, options: { table?: string } = {}) {
  const table = options.table ?? 'saydo_passkeys';
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('[saydo] Invalid table name.');
  const row = (r: Record<string, unknown> | undefined): Passkey | undefined =>
    r ? ((typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Passkey) : undefined;
  const store = {
    schema: `CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, user_id text NOT NULL, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS ${table}_user_idx ON ${table} (user_id);`,
    async migrate() {
      for (const statement of store.schema.split(';').map((s) => s.trim()).filter(Boolean)) await client.query(statement);
    },
    async list(userId: string) {
      return (await client.query(`SELECT data FROM ${table} WHERE user_id = $1`, [userId])).rows.map((r) => row(r)!);
    },
    async get(id: string) {
      return row((await client.query(`SELECT data FROM ${table} WHERE id = $1`, [id])).rows[0]);
    },
    async save(passkey: Passkey) {
      await client.query(
        `INSERT INTO ${table} (id, user_id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [passkey.id, passkey.userId, JSON.stringify(passkey)],
      );
    },
    async updateCounter(id: string, counter: number) {
      // Never move the counter backwards, even under concurrent approvals.
      await client.query(
        `UPDATE ${table} SET data = jsonb_set(data, '{counter}', to_jsonb($2::bigint)) WHERE id = $1 AND (data->>'counter')::bigint < $2`,
        [id, counter],
      );
    },
    async remove(id: string) {
      await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },
  };
  return store satisfies PasskeyStore;
}

// ---------------------------------------------------------------- step-up

export interface WebAuthnStepUp extends StepUpOptions {
  registration: {
    allowed(user: SaydoUser, request?: Request): Promise<boolean>;
    /** Options for navigator.credentials.create(); `challenge` must be stored (sealed) until verify. */
    options(user: SaydoUser): Promise<Record<string, unknown> & { challenge: string }>;
    verify(user: SaydoUser, credential: RegistrationCredential, expectedChallenge: string, name?: string): Promise<Passkey>;
  };
}

/**
 * Passkey step-up for saydo.config.ts:
 *
 *   stepUp: webauthn({ rpId: 'example.com', origins: 'https://example.com', passkeys: postgresPasskeyStore(pool),
 *                      allowRegistration: (user) => user.recentlySignedIn === true })
 */
export function webauthn(options: WebAuthnOptions): WebAuthnStepUp {
  const origins = new Set(Array.isArray(options.origins) ? options.origins : [options.origins]);
  const timeout = options.timeoutMs ?? 120_000;
  let rpIdHash: Promise<Uint8Array<ArrayBuffer>> | undefined;
  const expectedRpIdHash = () => (rpIdHash ??= sha256(encoder.encode(options.rpId)));

  return {
    when: options.when,
    fallback: options.fallback,

    async challenge({ user }) {
      const keys = await options.passkeys.list(user.id);
      if (!keys.length) return null;
      return {
        method: 'webauthn',
        challenge: randomChallenge(),
        rpId: options.rpId,
        timeout,
        allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports })),
      } satisfies StepUpChallenge;
    },

    async verify({ user, challenge, proof }) {
      const assertion = proof as AssertionProof;
      if (!assertion || typeof assertion.id !== 'string' || !assertion.response) return false;
      const passkey = await options.passkeys.get(assertion.id);
      if (!passkey || passkey.userId !== user.id) return false;
      const clientData = parseClientData(assertion.response.clientDataJSON);
      if (!clientData || clientData.type !== 'webauthn.get') return false;
      if (clientData.challenge !== challenge.challenge || !origins.has(clientData.origin)) return false;
      const authBytes = fromBase64Url(assertion.response.authenticatorData);
      const auth = parseAuthData(authBytes);
      if (!auth || !equalBytes(auth.rpIdHash, await expectedRpIdHash())) return false;
      if (!auth.userPresent || !auth.userVerified) return false;
      // A non-increasing counter means a cloned authenticator (0 means the authenticator does not count).
      if ((auth.signCount !== 0 || passkey.counter !== 0) && auth.signCount <= passkey.counter) return false;
      const clientHash = await sha256(fromBase64Url(assertion.response.clientDataJSON));
      const signed = new Uint8Array(authBytes.length + clientHash.length);
      signed.set(authBytes, 0);
      signed.set(clientHash, authBytes.length);
      const { key, params } = await importKey(passkey);
      const signature = fromBase64Url(assertion.response.signature);
      const ok = await crypto.subtle.verify(params, key, passkey.algorithm === -7 ? derToRaw(signature) : signature, signed);
      if (ok) await options.passkeys.updateCounter(passkey.id, auth.signCount);
      return ok;
    },

    registration: {
      async allowed(user, request) {
        return options.allowRegistration ? Boolean(await options.allowRegistration(user, request)) : false;
      },
      async options(user) {
        const existing = await options.passkeys.list(user.id);
        return {
          challenge: randomChallenge(),
          rp: { id: options.rpId, name: options.rpName ?? options.rpId },
          user: {
            id: toBase64Url(encoder.encode(user.id)),
            name: String(user.email ?? user.name ?? user.id),
            displayName: String(user.name ?? user.email ?? user.id),
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
          excludeCredentials: existing.map((k) => ({ id: k.id, type: 'public-key', transports: k.transports })),
          timeout,
          attestation: 'none',
        };
      },
      async verify(user, credential, expectedChallenge, name) {
        const clientData = parseClientData(credential?.response?.clientDataJSON ?? '');
        if (!clientData || clientData.type !== 'webauthn.create') throw new Error('Not a registration response.');
        if (clientData.challenge !== expectedChallenge || !origins.has(clientData.origin)) throw new Error('Challenge or origin mismatch.');
        const auth = parseAuthData(fromBase64Url(credential.response.authenticatorData));
        if (!auth || !equalBytes(auth.rpIdHash, await expectedRpIdHash())) throw new Error('Wrong relying party.');
        if (!auth.userPresent || !auth.userVerified) throw new Error('User verification is required.');
        if (![-7, -257].includes(credential.response.publicKeyAlgorithm)) throw new Error('Unsupported key algorithm.');
        // Make sure the key imports before storing it.
        const passkey: Passkey = {
          id: credential.id,
          userId: user.id,
          publicKey: credential.response.publicKey,
          algorithm: credential.response.publicKeyAlgorithm,
          counter: auth.signCount,
          createdAt: Date.now(),
          name: name?.slice(0, 60),
          transports: credential.response.transports,
        };
        await importKey(passkey);
        const taken = await options.passkeys.get(passkey.id);
        if (taken && taken.userId !== user.id) throw new Error('Credential already registered.');
        await options.passkeys.save(passkey);
        return passkey;
      },
    },
  };
}
