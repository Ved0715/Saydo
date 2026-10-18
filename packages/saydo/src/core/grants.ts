import type { Effect, Receipt, StepUpChallenge, Tier } from './types';

export type GrantState = 'staged' | 'approved' | 'consumed' | 'denied';

/**
 * A server-side record of one consent decision, idempotency claim, or undo
 * token. Arguments are stored here by reference: approval sends only the id,
 * and execution uses these exact validated arguments.
 */
export interface Grant {
  id: string;
  /**
   * confirm: awaiting the user · client: approved, awaiting withGrant · undo: undo token ·
   * invocation: exactly-once claim for one tool call · request: cached response for a retried request.
   */
  kind: 'confirm' | 'client' | 'undo' | 'invocation' | 'request';
  capabilityId: string;
  userId: string;
  threadId: string;
  tabId: string;
  toolCallId: string;
  /** Validated input with entity handles resolved to records (as shown on the card). */
  args: unknown;
  /** Validated input with handles, re-resolved (fresh authz) at execution time. */
  input?: unknown;
  /** Entity versions at staging time; a change fails the approval instead of acting on new data. */
  versions?: Record<string, string>;
  tier: Tier;
  state: GrantState;
  createdAt: number;
  expiresAt: number;
  /** Step-up: the text the user must type to approve. */
  typed?: string;
  /** Step-up: this approval needs a passkey (or other verifier) proof. */
  stepUpRequired?: boolean;
  /** The challenge the proof must answer (single use, bound to this grant). */
  stepUp?: StepUpChallenge;
  /** Result of execution, kept so a retry replays instead of re-running. */
  outcome?: { receipt: Receipt; effects: Effect[] };
  /** Full response of a request, for request-level idempotency. */
  response?: unknown;
  /** Delegated approvals (external and browser agents): who asked, and the card to show the user. */
  origin?: 'external' | 'browser-agent';
  view?: import('./types').ConfirmView;
  /** Input references are record ids (not thread handles); re-resolved with access checks. */
  byId?: boolean;
}

export type GrantPatch = Partial<Pick<Grant, 'kind' | 'expiresAt' | 'outcome' | 'response' | 'args'>>;

/**
 * Storage contract for approvals. Implementations MUST make `claim` and
 * `transition` atomic; that is what guarantees exactly-once execution across
 * double clicks, retries and multiple server instances.
 */
export interface GrantStore {
  create(grant: Grant): Promise<void>;
  /** Atomic insert-if-absent. Returns false when the id already exists. */
  claim(grant: Grant): Promise<boolean>;
  get(id: string): Promise<Grant | undefined>;
  /**
   * Atomic compare-and-set. Returns the updated grant only if it was in `from`.
   * SQL: `UPDATE … SET state = $to WHERE id = $id AND state = $from RETURNING *`.
   */
  transition(id: string, from: GrantState, to: GrantState): Promise<Grant | undefined>;
  update(id: string, patch: GrantPatch): Promise<void>;
  /** Right to erasure: remove everything stored for a user. Returns the count removed. */
  deleteUser(userId: string): Promise<number>;
}

/** Single-process store for development, tests and single-instance servers. */
export class MemoryGrantStore implements GrantStore {
  readonly durable = false;
  private readonly grants = new Map<string, Grant>();

  async create(grant: Grant) {
    this.prune(grant.createdAt);
    this.grants.set(grant.id, { ...grant });
  }

  async claim(grant: Grant) {
    this.prune(grant.createdAt);
    const existing = this.grants.get(grant.id);
    if (existing && existing.expiresAt >= grant.createdAt) return false;
    this.grants.set(grant.id, { ...grant });
    return true;
  }

  async get(id: string) {
    const grant = this.grants.get(id);
    return grant ? { ...grant } : undefined;
  }

  async transition(id: string, from: GrantState, to: GrantState) {
    const grant = this.grants.get(id);
    if (!grant || grant.state !== from) return undefined;
    grant.state = to;
    return { ...grant };
  }

  async update(id: string, patch: GrantPatch) {
    const grant = this.grants.get(id);
    if (grant) Object.assign(grant, patch);
  }

  async deleteUser(userId: string) {
    let removed = 0;
    for (const [id, grant] of this.grants) {
      if (grant.userId === userId) {
        this.grants.delete(id);
        removed++;
      }
    }
    return removed;
  }

  private prune(now: number) {
    if (this.grants.size < 1000) return;
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt < now - 60_000) this.grants.delete(id);
    }
  }
}

/** Minimal SQL client shape: works with `pg`, `postgres` (via a wrapper), Neon, PGlite. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Durable Postgres store. Atomicity comes from single-statement
 * `INSERT … ON CONFLICT DO NOTHING` and `UPDATE … WHERE state = $from`, so it
 * is safe across any number of server instances.
 *
 *   store: postgresGrantStore(pool)            // pg.Pool, or anything with query()
 *   await store.migrate()                      // once, or run postgresGrantStore.schema yourself
 */
export function postgresGrantStore(client: SqlClient, options: { table?: string } = {}) {
  const table = options.table ?? 'saydo_grants';
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('[saydo] Invalid table name.');
  const parse = (row: Record<string, unknown> | undefined): Grant | undefined => {
    if (!row) return undefined;
    const data = row.data;
    return (typeof data === 'string' ? JSON.parse(data) : data) as Grant;
  };
  const store = {
    durable: true as const,
    schema: `CREATE TABLE IF NOT EXISTS ${table} (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  state text NOT NULL,
  expires_at bigint NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ${table}_user_idx ON ${table} (user_id);
CREATE INDEX IF NOT EXISTS ${table}_expiry_idx ON ${table} (expires_at);`,

    async migrate() {
      for (const statement of store.schema.split(';').map((s) => s.trim()).filter(Boolean)) await client.query(statement);
    },

    async create(grant: Grant) {
      await client.query(
        `INSERT INTO ${table} (id, user_id, state, expires_at, data) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, state = EXCLUDED.state, expires_at = EXCLUDED.expires_at, data = EXCLUDED.data`,
        [grant.id, grant.userId, grant.state, grant.expiresAt, JSON.stringify(grant)],
      );
    },

    async claim(grant: Grant) {
      // Expired claims may be taken over; live ones never.
      const result = await client.query(
        `INSERT INTO ${table} (id, user_id, state, expires_at, data) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, state = EXCLUDED.state, expires_at = EXCLUDED.expires_at, data = EXCLUDED.data
         WHERE ${table}.expires_at < $6
         RETURNING id`,
        [grant.id, grant.userId, grant.state, grant.expiresAt, JSON.stringify(grant), grant.createdAt],
      );
      return result.rows.length === 1;
    },

    async get(id: string) {
      const result = await client.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
      return parse(result.rows[0]);
    },

    async transition(id: string, from: GrantState, to: GrantState) {
      const result = await client.query(
        `UPDATE ${table} SET state = $3, data = jsonb_set(data, '{state}', to_jsonb($3::text))
         WHERE id = $1 AND state = $2 RETURNING data`,
        [id, from, to],
      );
      return parse(result.rows[0]);
    },

    async update(id: string, patch: GrantPatch) {
      await client.query(
        `UPDATE ${table} SET data = data || $2::jsonb, expires_at = COALESCE(($2::jsonb ->> 'expiresAt')::bigint, expires_at) WHERE id = $1`,
        [id, JSON.stringify(patch)],
      );
    },

    async deleteUser(userId: string) {
      const result = await client.query(`DELETE FROM ${table} WHERE user_id = $1 RETURNING id`, [userId]);
      return result.rows.length;
    },

    /** Delete expired rows older than `graceMs`. Call it from a cron job. */
    async prune(now = Date.now(), graceMs = 60 * 60_000) {
      const result = await client.query(`DELETE FROM ${table} WHERE expires_at < $1 RETURNING id`, [now - graceMs]);
      return result.rows.length;
    },
  };
  return store satisfies GrantStore;
}

/**
 * Minimal Redis surface: one `eval`. Adapters for common clients:
 *   ioredis:     { eval: (s, keys, args) => redis.eval(s, keys.length, ...keys, ...args) }
 *   node-redis:  { eval: (s, keys, args) => redis.eval(s, { keys, arguments: args }) }
 *   Upstash:     { eval: (s, keys, args) => redis.eval(s, keys, args) }
 */
export interface RedisEval {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

// TTLs are relative (grant lifetime + grace), so app clocks and Redis clocks never need to agree.
const LUA_WRITE = `
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'data', ARGV[1], 'state', ARGV[2], 'exp', ARGV[3], 'user', ARGV[4], 'created', ARGV[6])
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[3]) - tonumber(ARGV[6]), 0) + tonumber(ARGV[5]))
return 1`;

const LUA_CLAIM = `
local exp = redis.call('HGET', KEYS[1], 'exp')
if exp and tonumber(exp) >= tonumber(ARGV[6]) then return 0 end
${LUA_WRITE}`;

const LUA_TRANSITION = `
if redis.call('HGET', KEYS[1], 'state') ~= ARGV[1] then return false end
redis.call('HSET', KEYS[1], 'state', ARGV[2])
return redis.call('HGETALL', KEYS[1])`;

const LUA_UPDATE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
for i = 2, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
local exp = tonumber(redis.call('HGET', KEYS[1], 'exp'))
local created = tonumber(redis.call('HGET', KEYS[1], 'created'))
redis.call('PEXPIRE', KEYS[1], math.max(exp - created, 0) + tonumber(ARGV[1]))
return 1`;

const LUA_DELETE_USER = `
local cursor = '0'
local removed = 0
repeat
  local page = redis.call('SCAN', cursor, 'MATCH', ARGV[1], 'COUNT', 500)
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    if redis.call('HGET', key, 'user') == ARGV[2] then removed = removed + redis.call('DEL', key) end
  end
until cursor == '0'
return removed`;

/**
 * Durable Redis store. Every operation is one single-key Lua script, so it is
 * atomic and Redis Cluster safe. Keys expire on their own (an hour after the
 * grant expires). `deleteUser` scans, which is fine for rare erasure requests.
 *
 *   store: redisGrantStore({ eval: (s, keys, args) => redis.eval(s, { keys, arguments: args }) })
 */
export function redisGrantStore(client: RedisEval, options: { prefix?: string; graceMs?: number } = {}) {
  const prefix = options.prefix ?? 'saydo';
  const grace = options.graceMs ?? 60 * 60_000;
  const key = (id: string) => `${prefix}:g:${id}`;
  const writeArgs = (grant: Grant) => [JSON.stringify(grant), grant.state, String(grant.expiresAt), grant.userId, String(grace), String(grant.createdAt)];
  const parse = (flat: unknown): Grant | undefined => {
    if (!Array.isArray(flat) || !flat.length) return undefined;
    const fields: Record<string, string> = {};
    for (let i = 0; i < flat.length; i += 2) fields[String(flat[i])] = String(flat[i + 1]);
    if (!fields.data) return undefined;
    const grant = JSON.parse(fields.data) as Grant;
    grant.state = fields.state as GrantState;
    grant.expiresAt = Number(fields.exp);
    for (const [name, value] of Object.entries(fields)) {
      if (name.startsWith('p:')) (grant as unknown as Record<string, unknown>)[name.slice(2)] = JSON.parse(value);
    }
    return grant;
  };
  const store = {
    durable: true as const,
    async create(grant: Grant) {
      await client.eval(LUA_WRITE, [key(grant.id)], writeArgs(grant));
    },
    async claim(grant: Grant) {
      return Number(await client.eval(LUA_CLAIM, [key(grant.id)], writeArgs(grant))) === 1;
    },
    async get(id: string) {
      return parse(await client.eval(`return redis.call('HGETALL', KEYS[1])`, [key(id)], []));
    },
    async transition(id: string, from: GrantState, to: GrantState) {
      return parse(await client.eval(LUA_TRANSITION, [key(id)], [from, to]));
    },
    async update(id: string, patch: GrantPatch) {
      const args = [String(grace)];
      for (const [name, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (name === 'expiresAt') args.push('exp', String(value));
        else args.push(`p:${name}`, JSON.stringify(value));
      }
      await client.eval(LUA_UPDATE, [key(id)], args);
    },
    async deleteUser(userId: string) {
      return Number(await client.eval(LUA_DELETE_USER, [], [`${prefix}:g:*`, userId]));
    },
  };
  return store satisfies GrantStore;
}
