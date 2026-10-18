import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBudget, createRateLimiter, memoryLimitStore, redisLimitStore, type LimitStore } from '../src/core/limits';
import { withSaydo } from '../src/next/index';
import { serveStatic } from '../src/vite/node';

function limitContract(name: string, make: () => Promise<LimitStore>) {
  describe(`limit store contract: ${name}`, () => {
    it('counts atomically under concurrency and expires windows', async () => {
      const store = await make();
      const totals = await Promise.all(Array.from({ length: 25 }, () => store.hit('k', 1, 60_000)));
      expect(totals.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
      expect(await store.peek('k')).toBe(25);
      expect(await store.hit('tokens', 1200, 60_000)).toBe(1200);
      expect(await store.peek('missing')).toBe(0);
    });

    it('rate-limits per user per minute and budgets per day', async () => {
      const store = await make();
      let now = Date.UTC(2026, 9, 18, 12, 0, 0);
      const limited = createRateLimiter(store, 3, () => now);
      expect([await limited('a'), await limited('a'), await limited('a'), await limited('a')]).toEqual([false, false, false, true]);
      expect(await limited('b')).toBe(false);
      now += 61_000;
      expect(await limited('a')).toBe(false);

      const budget = createBudget(store, { requestsPerDay: 2, tokensPerDay: 1000 }, () => now);
      await budget.countRequest('u');
      expect(await budget.exceeded('u')).toBe(false);
      await budget.countRequest('u');
      expect(await budget.exceeded('u')).toBe(true);
      await budget.countTokens('v', 1500);
      expect(await budget.exceeded('v')).toBe(true);
      now += 24 * 60 * 60_000; // next UTC day
      expect(await budget.exceeded('u')).toBe(false);
    });
  });
}

limitContract('memory', async () => memoryLimitStore());

describe('memory limit store', () => {
  it('never resets other users when it grows (expired windows are dropped one by one)', async () => {
    let now = 0;
    const store = memoryLimitStore({ now: () => now });
    await store.hit('long', 5, 10 * 60_000);
    for (let i = 0; i < 1000; i++) await store.hit(`short${i}`, 1, 1000);
    now = 60_000;
    await store.hit('trigger', 1, 1000);
    expect(await store.peek('long')).toBe(5);
    expect(await store.peek('short1')).toBe(0);
  });
});

const redisBinary = ['/opt/homebrew/bin/redis-server', '/usr/local/bin/redis-server', '/usr/bin/redis-server'].find((p) => fs.existsSync(p));
if (redisBinary) {
  let proc: ChildProcess | undefined;
  let url = '';
  beforeAll(async () => {
    const port = 7000 + Math.floor(Math.random() * 500);
    proc = spawn(redisBinary, ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    url = `redis://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        // No reconnect loop and an error listener: a failed probe must not leave a client retrying in the background.
        const probe = createClient({ url, socket: { reconnectStrategy: false } });
        probe.on('error', () => {});
        await probe.connect();
        await probe.quit();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  const clients: { quit(): Promise<unknown> }[] = [];
  afterAll(async () => {
    // Close every client before the server goes away, or its socket error is uncaught.
    await Promise.all(clients.map((c) => c.quit().catch(() => {})));
    proc?.kill();
  });
  limitContract('redis (real redis-server)', async () => {
    const redis = createClient({ url });
    redis.on('error', () => {});
    clients.push(redis);
    await redis.connect();
    await redis.flushAll();
    return redisLimitStore({ eval: (script, keys, args) => redis.eval(script, { keys, arguments: args }) });
  });
}

describe('WebMCP permissions policy (S5)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saydo-policy-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app/page.tsx'), 'export default function Page() { return null }\n');
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('withSaydo turns WebMCP off unless agents are on, keeping the app’s own headers', async () => {
    const config = withSaydo({ headers: async () => [{ source: '/x', headers: [{ key: 'X-A', value: '1' }] }] }, { dir: root, watch: false });
    const headers = await config.headers!();
    expect(headers[0]!.source).toBe('/x');
    expect(headers).toContainEqual({ source: '/:path*', headers: [{ key: 'Permissions-Policy', value: 'tools=()' }] });
    expect(await withSaydo({}, { dir: root, watch: false, agents: true }).headers!()).toContainEqual({
      source: '/:path*',
      headers: [{ key: 'Permissions-Policy', value: 'tools=(self)' }],
    });
    expect(withSaydo({}, { dir: root, watch: false, permissionsPolicy: false }).headers).toBeUndefined();
  });

  it('serveStatic sends the same policy', async () => {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    const http = await import('node:http');
    for (const [options, expected] of [[{}, 'tools=()'], [{ agents: true }, 'tools=(self)']] as const) {
      const server = http.createServer(serveStatic(root, options));
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.headers.get('permissions-policy')).toBe(expected);
      expect(await response.text()).toBe('<!doctype html>');
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
