import type { RedisEval } from './grants';

/**
 * Counters for rate limits and daily budgets. The default lives in the process; with
 * several instances (serverless, autoscaling) use a shared store, or limits multiply by
 * the instance count.
 */
export interface LimitStore {
  /** Atomically add `amount` to `key` (created with a lifetime of `ttlMs`) and return the new total. */
  hit(key: string, amount: number, ttlMs: number): Promise<number>;
  /** The current total, 0 when missing or expired. */
  peek(key: string): Promise<number>;
}

/** In-process counters. Expired windows are dropped individually; nobody's budget is ever reset early. */
export function memoryLimitStore(options: { now?: () => number } = {}): LimitStore & { readonly durable: false } {
  const now = options.now ?? Date.now;
  const counters = new Map<string, { value: number; expiresAt: number }>();
  let lastSweep = 0;
  const sweep = () => {
    const t = now();
    if (t - lastSweep < 30_000 && counters.size < 100_000) return;
    lastSweep = t;
    for (const [key, counter] of counters) if (counter.expiresAt <= t) counters.delete(key);
  };
  return {
    durable: false,
    async hit(key, amount, ttlMs) {
      sweep();
      const t = now();
      const current = counters.get(key);
      if (!current || current.expiresAt <= t) {
        counters.set(key, { value: amount, expiresAt: t + ttlMs });
        return amount;
      }
      current.value += amount;
      return current.value;
    },
    async peek(key) {
      const current = counters.get(key);
      return current && current.expiresAt > now() ? current.value : 0;
    },
  };
}

const LUA_HIT = `
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
if v == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return v`;

/**
 * Shared counters on Redis: one atomic script per hit, keys expire on their own.
 *
 *   limits: redisLimitStore({ eval: (s, keys, args) => redis.eval(s, { keys, arguments: args }) })
 */
export function redisLimitStore(client: RedisEval & { get?: (key: string) => Promise<string | null> }, options: { prefix?: string } = {}): LimitStore & { readonly durable: true } {
  const prefix = options.prefix ?? 'saydo:l:';
  return {
    durable: true,
    async hit(key, amount, ttlMs) {
      return Number(await client.eval(LUA_HIT, [prefix + key], [String(Math.round(amount)), String(Math.max(1, Math.round(ttlMs)))]));
    },
    async peek(key) {
      const value = await client.eval(`return redis.call('GET', KEYS[1])`, [prefix + key], []);
      return Number(value ?? 0) || 0;
    },
  };
}

/** Fixed one-minute windows per user: works the same on one instance or a thousand. */
export function createRateLimiter(store: LimitStore, perMinute: number, now: () => number = Date.now) {
  return async (userId: string): Promise<boolean> => {
    const window = Math.floor(now() / 60_000);
    return (await store.hit(`rl:${userId}:${window}`, 1, 61_000)) > perMinute;
  };
}

/** Per-user daily request and token budgets (UTC days). */
export function createBudget(store: LimitStore, limits: { requestsPerDay?: number; tokensPerDay?: number }, now: () => number = Date.now) {
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const TTL = 26 * 60 * 60_000;
  return {
    async exceeded(userId: string) {
      const today = day();
      const [requests, tokens] = await Promise.all([store.peek(`bud:r:${userId}:${today}`), store.peek(`bud:t:${userId}:${today}`)]);
      return (limits.requestsPerDay !== undefined && requests >= limits.requestsPerDay) || (limits.tokensPerDay !== undefined && tokens >= limits.tokensPerDay);
    },
    async countRequest(userId: string) {
      await store.hit(`bud:r:${userId}:${day()}`, 1, TTL);
    },
    async countTokens(userId: string, tokens: number) {
      if (tokens > 0) await store.hit(`bud:t:${userId}:${day()}`, tokens, TTL);
    },
  };
}
