import type { ThreadSummary, TranscriptEntry } from './protocol';
import type { SqlClient } from './grants';

export type { ThreadSummary, TranscriptEntry };

/**
 * One stored conversation. `state` is opaque to stores (the engine's working
 * state as JSON), so a store never needs to understand the protocol and never
 * hits database limits on nested values.
 */
export interface StoredThread {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** After this, the conversation is gone: the engine ignores it and TTLs or `prune` remove it. */
  expiresAt: number;
  /** Incremented on every save; the compare-and-set key. */
  version: number;
  state: string;
}

/**
 * Optional server-side conversation storage. Without one, conversation state is
 * signed and kept by the browser tab (zero setup, nothing stored). With one, users
 * get history, resume on any device, and erasure you can prove.
 *
 * Two rules every implementation MUST follow (the contract tests check both):
 * - `save` is an atomic compare-and-set on `version`, so two concurrent turns
 *   cannot silently overwrite each other.
 * - the transcript is append-only: one record per entry, never a rewritten blob,
 *   so long conversations never become a hot, growing document.
 */
export interface ThreadStore {
  get(id: string): Promise<StoredThread | undefined>;
  /** `expected: null` creates (fails if it exists); otherwise saves only if the stored version equals `expected`. */
  save(thread: StoredThread, expected: number | null): Promise<boolean>;
  /** Append what the user saw this turn. */
  append(threadId: string, userId: string, entries: TranscriptEntry[], expiresAt: number): Promise<void>;
  /** The last `limit` entries (default 100), oldest first. */
  transcript(threadId: string, options?: { limit?: number }): Promise<TranscriptEntry[]>;
  /** The user's conversations, most recent first (default 20). */
  list(userId: string, options?: { limit?: number }): Promise<ThreadSummary[]>;
  /** Remove a conversation and its transcript. */
  delete(id: string): Promise<void>;
  /** Right to erasure: every conversation of a user. Returns the number removed. */
  deleteUser(userId: string): Promise<number>;
}

const summary = (t: StoredThread): ThreadSummary => ({ id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt });

/** In-process store for development, tests and single-instance servers. */
export function memoryThreadStore(): ThreadStore & { readonly durable: false } {
  const threads = new Map<string, StoredThread>();
  const entries = new Map<string, TranscriptEntry[]>();
  return {
    durable: false,
    async get(id) {
      const thread = threads.get(id);
      return thread ? { ...thread } : undefined;
    },
    async save(thread, expected) {
      const current = threads.get(thread.id);
      if (expected === null ? current !== undefined : current?.version !== expected || current.userId !== thread.userId) return false;
      threads.set(thread.id, { ...thread });
      return true;
    },
    async append(threadId, _userId, items) {
      const list = entries.get(threadId) ?? [];
      list.push(...items.map((e) => ({ ...e })));
      entries.set(threadId, list.slice(-1000));
    },
    async transcript(threadId, options = {}) {
      return (entries.get(threadId) ?? []).slice(-(options.limit ?? 100)).map((e) => ({ ...e }));
    },
    async list(userId, options = {}) {
      return [...threads.values()]
        .filter((t) => t.userId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, options.limit ?? 20)
        .map(summary);
    },
    async delete(id) {
      threads.delete(id);
      entries.delete(id);
    },
    async deleteUser(userId) {
      let removed = 0;
      for (const [id, thread] of threads) {
        if (thread.userId !== userId) continue;
        threads.delete(id);
        entries.delete(id);
        removed++;
      }
      return removed;
    },
  };
}

/**
 * Durable Postgres conversations. Saves are a single conditional statement
 * (`UPDATE … WHERE version = $expected`), entries are rows.
 *
 *   threads: postgresThreadStore(pool)
 *   await threads.migrate()     // once, or run .schema in your migrations
 */
export function postgresThreadStore(client: SqlClient, options: { table?: string } = {}) {
  const table = options.table ?? 'saydo_threads';
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('[saydo] Invalid table name.');
  const entriesTable = `${table}_entries`;
  const toThread = (row: Record<string, unknown>): StoredThread => ({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
    state: String(row.state),
  });
  const store = {
    durable: true as const,
    schema: `CREATE TABLE IF NOT EXISTS ${table} (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  version integer NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  state text NOT NULL
);
CREATE INDEX IF NOT EXISTS ${table}_user_idx ON ${table} (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ${table}_expiry_idx ON ${table} (expires_at);
CREATE TABLE IF NOT EXISTS ${entriesTable} (
  seq bigserial PRIMARY KEY,
  thread_id text NOT NULL,
  user_id text NOT NULL,
  expires_at bigint NOT NULL,
  entry jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ${entriesTable}_thread_idx ON ${entriesTable} (thread_id, seq);
CREATE INDEX IF NOT EXISTS ${entriesTable}_user_idx ON ${entriesTable} (user_id)`,

    async migrate() {
      for (const statement of store.schema.split(';').map((s) => s.trim()).filter(Boolean)) await client.query(statement);
    },

    async get(id: string) {
      const result = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return result.rows[0] ? toThread(result.rows[0]) : undefined;
    },

    async save(thread: StoredThread, expected: number | null) {
      const values = [thread.id, thread.userId, thread.title, thread.version, thread.createdAt, thread.updatedAt, thread.expiresAt, thread.state];
      const result =
        expected === null
          ? await client.query(
              `INSERT INTO ${table} (id, user_id, title, version, created_at, updated_at, expires_at, state)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
              values,
            )
          : await client.query(
              `UPDATE ${table} SET title = $3, version = $4, updated_at = $5, expires_at = $6, state = $7
               WHERE id = $1 AND user_id = $2 AND version = $8 RETURNING id`,
              [thread.id, thread.userId, thread.title, thread.version, thread.updatedAt, thread.expiresAt, thread.state, expected],
            );
      return result.rows.length === 1;
    },

    async append(threadId: string, userId: string, entries: TranscriptEntry[], expiresAt: number) {
      for (const entry of entries) {
        await client.query(`INSERT INTO ${entriesTable} (thread_id, user_id, expires_at, entry) VALUES ($1, $2, $3, $4::jsonb)`, [
          threadId,
          userId,
          expiresAt,
          JSON.stringify(entry),
        ]);
      }
    },

    async transcript(threadId: string, opts: { limit?: number } = {}) {
      const result = await client.query(
        `SELECT entry FROM (SELECT entry, seq FROM ${entriesTable} WHERE thread_id = $1 ORDER BY seq DESC LIMIT $2) recent ORDER BY seq ASC`,
        [threadId, opts.limit ?? 100],
      );
      return result.rows.map((row) => (typeof row.entry === 'string' ? JSON.parse(row.entry) : row.entry) as TranscriptEntry);
    },

    async list(userId: string, opts: { limit?: number } = {}) {
      const result = await client.query(
        `SELECT id, user_id, title, version, created_at, updated_at, expires_at, '' AS state FROM ${table}
         WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
        [userId, opts.limit ?? 20],
      );
      return result.rows.map((row) => summary(toThread(row)));
    },

    async delete(id: string) {
      await client.query(`DELETE FROM ${entriesTable} WHERE thread_id = $1`, [id]);
      await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },

    async deleteUser(userId: string) {
      await client.query(`DELETE FROM ${entriesTable} WHERE user_id = $1`, [userId]);
      const result = await client.query(`DELETE FROM ${table} WHERE user_id = $1 RETURNING id`, [userId]);
      return result.rows.length;
    },

    /** Delete expired conversations. Call it from a cron job. */
    async prune(now = Date.now()) {
      await client.query(`DELETE FROM ${entriesTable} WHERE expires_at < $1`, [now]);
      const result = await client.query(`DELETE FROM ${table} WHERE expires_at < $1 RETURNING id`, [now]);
      return result.rows.length;
    },
  };
  return store satisfies ThreadStore;
}
