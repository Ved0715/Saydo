import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantStoreContract as contractTests } from './contracts';
import { z } from 'zod';
import { defineCapability, defineEntity, defineRoute } from '../src/core/index';
import { createHandler } from '../src/core/handler';
import {
  createAuditLog,
  createEngine,
  MemoryGrantStore,
  mockPlanner,
  postgresGrantStore,
  redactor,
  redisGrantStore,
  verifyAuditChain,
  type AuditEntry,
  type AuditRecord,
  type Grant,
  type GrantStore,
} from '../src/core/server';
import { alice, call, client, message, ok, say, SECRET, setup } from './fixtures';

const approve = (state: string, grantId: string, ctx = client()) =>
  ({ type: 'approve', state, grantId, approved: true, trusted: true, client: ctx }) as const;

describe('idempotency', () => {
  it('a retried request returns the stored response and never runs twice', async () => {
    const { engine, db, plannerCalls } = setup([(i) => call('posts_archive', { post: i.page.entities[0]!.handle }), say('Archived.')]);
    const request = { ...message('archive this', undefined, client({ route: '/posts/p2' })), requestId: 'req-0001-abcdef' };
    const first = ok(await engine.handle(request, alice));
    const retry = ok(await engine.handle(request, alice));
    expect(retry).toEqual(first);
    expect(plannerCalls).toHaveLength(2); // only the first request reached the planner
    expect(db.posts.get('p2')!.archived).toBe(true);
  });

  it('claims each undoable tool call exactly once per thread', async () => {
    let runs = 0;
    const Post = defineEntity<{ id: string; title: string }>({ type: 'post', label: (p) => p.title, get: (id) => ({ id, title: id }) });
    const toggle = defineCapability({
      id: 'posts.toggle',
      describe: 'Toggle',
      input: z.object({ post: Post.ref() }),
      risk: 'reversible',
      handler: () => {
        runs++;
      },
      undo: () => {},
    });
    const engine = createEngine({
      capabilities: [toggle],
      routes: [{ pattern: '/posts/[id]', nav: defineRoute({ params: { id: Post.param() } }) }],
      secret: SECRET,
      planner: mockPlanner({ script: [(i) => call('posts_toggle', { post: i.page.entities[0]!.handle }, 'same-call'), say('ok')] }),
    });
    const ctx = client({ route: '/posts/a' });
    const first = ok(await engine.handle(message('toggle', undefined, ctx), alice));
    // A stale replay of the same thread proposing the same call id must not run it again.
    ok(await engine.handle(message('toggle', first.state, ctx), alice));
    expect(runs).toBe(1);
  });
});

describe('time of check vs time of use', () => {
  it('refuses when a record disappeared or access was revoked after the card was shown', async () => {
    const { engine, db } = setup([(i) => call('posts_delete', { posts: [i.page.entities[0]!.handle] }), say('Not done.')]);
    const ctx = client({ route: '/posts/p2' });
    const staged = ok(await engine.handle(message('delete this', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    db.posts.get('p2')!.ownerId = 'someone-else'; // access revoked in the meantime
    const res = ok(await engine.handle(approve(staged.state, staged.pending.grantId, ctx), alice));
    expect(db.posts.has('p2')).toBe(true);
    expect(res.events.find((e) => e.type === 'action')).toMatchObject({ status: 'precondition_failed' });
  });

  it('refuses when the record changed (entity version) instead of overwriting newer data', async () => {
    const rows = new Map([['d1', { id: 'd1', title: 'Doc', rev: 1 }]]);
    const Doc = defineEntity<{ id: string; title: string; rev: number }>({
      type: 'doc',
      label: (d) => d.title,
      get: (id) => rows.get(id) ?? null,
      version: (d) => d.rev,
    });
    let writes = 0;
    const overwrite = defineCapability({
      id: 'docs.overwrite',
      describe: 'Overwrite a document',
      input: z.object({ doc: Doc.ref(), body: z.string() }),
      risk: 'write',
      handler: () => {
        writes++;
      },
    });
    const engine = createEngine({
      capabilities: [overwrite],
      routes: [{ pattern: '/docs/[id]', nav: defineRoute({ params: { id: Doc.param() } }) }],
      secret: SECRET,
      planner: mockPlanner({ script: [(i) => call('docs_overwrite', { doc: i.page.entities[0]!.handle, body: 'x' }), say('ok')] }),
    });
    const ctx = client({ route: '/docs/d1' });
    const staged = ok(await engine.handle(message('overwrite', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    rows.get('d1')!.rev = 2; // someone edited it
    const res = ok(await engine.handle(approve(staged.state, staged.pending.grantId, ctx), alice));
    expect(writes).toBe(0);
    expect(res.events.find((e) => e.type === 'action')).toMatchObject({ status: 'precondition_failed' });
    expect(JSON.stringify(res.events)).toContain('changed after the confirmation');
  });
});

describe('model misbehavior', () => {
  it('retries invalid arguments once, then stops', async () => {
    const { engine, plannerCalls } = setup([call('posts_create', { title: 'x'.repeat(99) }), call('posts_create', { title: 'y'.repeat(99) }), call('posts_create', { title: 'z'.repeat(99) })]);
    const res = ok(await engine.handle(message('create'), alice));
    expect(plannerCalls).toHaveLength(2);
    expect(res.events.at(-1)).toMatchObject({ text: expect.stringContaining('rephrase') });
  });

  it('reports a model outage with a machine-readable code', async () => {
    const engine = createEngine({
      capabilities: [],
      routes: [{ pattern: '/' }],
      secret: SECRET,
      onError: () => {},
      planner: { name: 'down', plan: async () => { throw new Error('529 overloaded'); } },
    });
    expect(await engine.handle(message('hi'), alice)).toMatchObject({ ok: false, code: 'planner_unavailable' });
  });
});

describe('unsaved changes', () => {
  it('blocks AI navigation while the page is dirty', async () => {
    const { engine } = setup([call('nav_goto', { route: '/billing' }), say('Save first.')]);
    const res = ok(await engine.handle(message('go to billing', undefined, client({ guard: 'Draft not saved' })), alice));
    expect(res.effects).toEqual([]);
    expect(res.events.find((e) => e.type === 'action')).toMatchObject({ status: 'blocked', message: 'Draft not saved' });
  });
});

describe('redaction before egress', () => {
  it('masks cards, SSNs and IBANs by default, and emails/phones in strict mode', () => {
    const basic = redactor('basic');
    expect(basic('Card 4242 4242 4242 4242, order 1234567890123')).toBe('Card [card], order 1234567890123');
    expect(basic('SSN 123-45-6789')).toBe('SSN [ssn]');
    expect(basic('IBAN DE89 3704 0044 0532 0130 00')).toBe('IBAN [iban]');
    expect(basic('mail ada@example.com')).toBe('mail ada@example.com');
    const strict = redactor('strict');
    expect(strict('mail ada@example.com, call +1 (415) 555-0100')).toBe('mail [email], call [phone]');
  });

  it('applies to the screen before the model sees it', async () => {
    const { engine, plannerCalls } = setup([say('ok')]);
    ok(await engine.handle(message('what is here', undefined, client({ page: { text: 'Card on file 4242 4242 4242 4242', elements: [] } })), alice));
    expect(plannerCalls[0]!.instructions).toContain('Card on file [card]');
    expect(plannerCalls[0]!.instructions).not.toContain('4242 4242');
  });
});

describe('element annotations from untrusted HTML', () => {
  it('can be prevented from lowering risk', async () => {
    const page = { text: '[button e1] Free gift', elements: [{ ref: 'e1', role: 'button', name: 'Free gift', actions: ['click' as const], risk: 'read' as const }] };
    const loose = setup([call('page_act', { ref: 'e1', action: 'click' })]);
    expect(ok(await loose.engine.handle(message('click it', undefined, client({ page })), alice)).pending?.type).toBe('dispatch');
    const strict = setup([call('page_act', { ref: 'e1', action: 'click' })], { act: { annotationsCanLowerRisk: false } });
    expect(ok(await strict.engine.handle(message('click it', undefined, client({ page })), alice)).pending?.type).toBe('confirm');
  });
});

describe('audit', () => {
  it('records consent method, the shown card digest, and forms a verifiable hash chain', async () => {
    const records: AuditRecord[] = [];
    const log = createAuditLog((r) => {
      records.push(r);
    });
    const { engine } = setup([call('posts_create', { title: 'Hi' }), say('ok')], { audit: log });
    const staged = ok(await engine.handle(message('create'), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    ok(await engine.handle(approve(staged.state, staged.pending.grantId), alice));
    await log.flush();
    const decisions = records.map((r: AuditEntry) => [r.decision, r.consent]);
    expect(decisions).toEqual([
      ['staged', undefined],
      ['approved', 'click'],
      ['executed', undefined],
    ]);
    expect(records[0]!.view).toMatch(/^[a-z0-9]+$/);
    expect(records[0]!.manifestHash).toBe(engine.manifestHash);
    expect(await verifyAuditChain(records)).toBe(-1);
    records[1]!.userId = 'mallory';
    expect(await verifyAuditChain(records)).toBe(1);
  });
});

contractTests('memory', async () => new MemoryGrantStore());

// Real Redis: start a throwaway redis-server on a free port when the binary exists.
const redisBinary = ['/opt/homebrew/bin/redis-server', '/usr/local/bin/redis-server', '/usr/bin/redis-server'].find((p) => fs.existsSync(p));
let redisProcess: ChildProcess | undefined;
let redisUrl = '';
if (redisBinary) {
  beforeAll(async () => {
    const port = 6400 + Math.floor(Math.random() * 500);
    redisProcess = spawn(redisBinary, ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    redisUrl = `redis://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        const probe = createClient({ url: redisUrl });
        await probe.connect();
        await probe.quit();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  afterAll(() => {
    redisProcess?.kill();
  });
  contractTests('redis (real redis-server)', async () => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.flushAll();
    return redisGrantStore({ eval: (script, keys, args) => redis.eval(script, { keys, arguments: args }) });
  });
}
contractTests('postgres (PGlite)', async () => {
  const db = new PGlite();
  const store = postgresGrantStore({ query: (text, params) => db.query(text, params) as never });
  await store.migrate();
  return store;
});

describe('end to end on Postgres', () => {
  it('runs a full confirm flow on the durable store', async () => {
    const db = new PGlite();
    const store = postgresGrantStore({ query: (text, params) => db.query(text, params) as never });
    await store.migrate();
    const ctx = setup([call('posts_create', { title: 'Durable' }), say('ok')], { grants: store });
    const staged = ok(await ctx.engine.handle(message('create'), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    ok(await ctx.engine.handle(approve(staged.state, staged.pending.grantId), alice));
    const replay = ok(await ctx.engine.handle(approve(staged.state, staged.pending.grantId), alice));
    expect([...ctx.db.posts.values()].filter((p) => p.title === 'Durable')).toHaveLength(1);
    expect(replay.ok).toBe(true);
  });
});

describe('handler protections', () => {
  const post = (handler: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    handler(new Request('http://app.test/api/saydo', { method: 'POST', headers: { host: 'app.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  const turn = { type: 'message', text: 'hi', client: { route: '/', tabId: 't', mounted: [], uiActions: [] } };

  it('accepts JSON only (cross-site form posts cannot send it)', async () => {
    const handler = createHandler({ routes: [{ pattern: '/' }], capabilities: [] }, { secret: SECRET, lockfile: false, planner: mockPlanner() });
    expect((await post(handler, 'type=manifest', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await post(handler, { type: 'manifest' })).status).toBe(200);
  });

  it('opens a circuit breaker after repeated model failures', async () => {
    let calls = 0;
    const handler = createHandler(
      { routes: [{ pattern: '/' }], capabilities: [] },
      { secret: SECRET, lockfile: false, rateLimit: false, planner: { name: 'down', plan: async () => { calls++; throw new Error('down'); } } },
    );
    const original = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 5; i++) await post(handler, turn);
      const blocked = await post(handler, turn);
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toMatchObject({ code: 'planner_unavailable' });
      expect(calls).toBe(5); // the 6th never reached the provider
    } finally {
      console.error = original;
    }
  });

  it('enforces per-user daily budgets', async () => {
    const handler = createHandler(
      { routes: [{ pattern: '/' }], capabilities: [] },
      { secret: SECRET, lockfile: false, rateLimit: false, budget: { requestsPerDay: 2 }, planner: mockPlanner({ script: [say('ok')] }) },
    );
    // A browser keeps the visitor cookie it was given.
    const first = await post(handler, turn);
    expect(first.status).toBe(200);
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
    const json = { 'content-type': 'application/json', cookie };
    expect((await post(handler, turn, json)).status).toBe(200);
    const third = await post(handler, turn, json);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: 'budget' });
  });

  it('gives each signed-out visitor an isolated identity, and limits cookie-less clients per IP', async () => {
    const handler = createHandler(
      { routes: [{ pattern: '/' }], capabilities: [] },
      { secret: SECRET, lockfile: false, rateLimit: false, budget: { requestsPerDay: 2 }, planner: mockPlanner({ script: [say('ok')] }) },
    );
    const a = await post(handler, turn);
    const b = await post(handler, turn);
    const cookieA = a.headers.get('set-cookie')!;
    expect(cookieA).toMatch(/^saydo_visitor=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(cookieA.split(';')[0]).not.toBe(b.headers.get('set-cookie')!.split(';')[0]);
    // Returning visitors keep their identity: no new cookie.
    expect((await post(handler, turn, { 'content-type': 'application/json', cookie: cookieA.split(';')[0]! })).headers.get('set-cookie')).toBeNull();
    // A script that drops cookies is still counted per client IP.
    const ip = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
    expect((await post(handler, turn, ip)).status).toBe(200);
    expect((await post(handler, turn, ip)).status).toBe(200);
    expect((await post(handler, turn, ip)).status).toBe(429);
    // A forged visitor cookie is ignored (a fresh identity is issued).
    expect((await post(handler, turn, { 'content-type': 'application/json', cookie: 'saydo_visitor=forged.sig' })).headers.get('set-cookie')).toMatch(/^saydo_visitor=/);
  });

  it('caps the body by bytes read, not by the content-length header', async () => {
    const handler = createHandler({ routes: [{ pattern: '/' }], capabilities: [] }, { secret: SECRET, lockfile: false, planner: mockPlanner() });
    const big = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'message', text: 'x'.repeat(300_000) })));
        controller.close();
      },
    });
    const response = await handler(
      new Request('http://app.test/api/saydo', { method: 'POST', headers: { host: 'app.test', 'content-type': 'application/json' }, body: big, duplex: 'half' } as RequestInit),
    );
    expect(response.status).toBe(413);
  });
});
