import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/core/handler';
import { memoryThreadStore, mockPlanner, type ThreadStore } from '../src/core/server';
import { alice, bob, call, client, makeApp, makeDb, message, ok, say, SECRET, setup } from './fixtures';

function withThreads(script: Parameters<typeof setup>[0], store: ThreadStore = memoryThreadStore()) {
  return { ...setup(script, { threads: store }), threads: store };
}

describe('stored conversations', () => {
  it('keeps the working state on the server and gives the browser a small signed pointer', async () => {
    const plain = setup([say('Hello!')]);
    const full = ok(await plain.engine.handle(message('hi there'), alice));
    const { engine, threads } = withThreads([say('Hello!'), say('Still here.')]);
    const first = ok(await engine.handle(message('plan the launch'), alice));
    expect(first.threadId).toBeTruthy();
    expect(first.state.length).toBeLessThan(260);
    expect(full.threadId).toBeUndefined();

    const second = ok(await engine.handle(message('and then?', first.state), alice));
    expect(second.threadId).toBe(first.threadId);
    const stored = await threads.get(first.threadId!);
    expect(stored).toMatchObject({ userId: 'u1', title: 'plan the launch', version: 2 });
    expect((await threads.transcript(first.threadId!)).map((e) => `${e.role}:${e.text}`)).toEqual([
      'user:plan the launch',
      'assistant:Hello!',
      'user:and then?',
      'assistant:Still here.',
    ]);
    expect((await engine.manifest(alice)).settings.history).toBe(true);
  });

  it('stores the transcript the user saw (successful navigations once, as the assistant line)', async () => {
    const { engine, threads } = withThreads([call('nav_goto', { route: '/billing' })]);
    const turn = ok(await engine.handle(message('take me to billing'), alice));
    expect((await threads.transcript(turn.threadId!)).map((e) => `${e.role}:${e.text}`)).toEqual(['user:take me to billing', 'assistant:Opened Billing.']);
  });

  it('lists, resumes in another tab, and deletes, only for the owner', async () => {
    const { engine } = withThreads([say('One.'), say('Two.')]);
    const first = ok(await engine.handle(message('first chat'), alice));
    const listed = await engine.conversations.list(alice);
    expect(listed).toMatchObject({ ok: true, threads: [{ id: first.threadId, title: 'first chat' }] });
    expect(await engine.conversations.list(bob)).toEqual({ ok: true, threads: [] });

    expect(await engine.conversations.open(bob, first.threadId!, client({ tabId: 'tab-x' }))).toMatchObject({ ok: false });
    const opened = await engine.conversations.open(alice, first.threadId!, client({ tabId: 'tab-2' }));
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.items.map((i) => i.text)).toEqual(['first chat', 'One.']);
    // The new pointer works in tab 2 and not in tab 1.
    const resumed = ok(await engine.handle(message('continue', opened.state, client({ tabId: 'tab-2' })), alice));
    expect(resumed.threadId).toBe(first.threadId);
    expect(await engine.handle(message('nope', opened.state, client({ tabId: 'tab-1' })), alice)).toMatchObject({ ok: false, status: 'forbidden' });

    expect(await engine.conversations.remove(bob, first.threadId!)).toMatchObject({ ok: false });
    expect(await engine.conversations.remove(alice, first.threadId!)).toEqual({ ok: true });
    expect(await engine.handle(message('after delete', resumed.state, client({ tabId: 'tab-2' })), alice)).toMatchObject({ ok: false, status: 'expired' });
  });

  it('keeps a pending confirmation across the server round trip', async () => {
    const { engine, db } = withThreads([call('posts_create', { title: 'Stored' }), say('Created.')]);
    const staged = ok(await engine.handle(message('create a post titled Stored'), alice));
    if (staged.pending?.type !== 'confirm') throw new Error('expected a confirm');
    const done = ok(await engine.handle({ type: 'approve', state: staged.state, grantId: staged.pending.grantId, approved: true, trusted: true, client: client() }, alice));
    expect(done.done).toBe(true);
    expect([...db.posts.values()].filter((p) => p.title === 'Stored')).toHaveLength(1);
  });

  it('expires conversations after the retention period', async () => {
    const { engine, advance } = { ...setup([say('Hi.')], { threads: memoryThreadStore(), threadTtlMs: 1000, stateTtlMs: 10_000 }) };
    const first = ok(await engine.handle(message('short lived'), alice));
    advance(2000);
    expect(await engine.conversations.list(alice)).toEqual({ ok: true, threads: [] });
    expect(await engine.handle(message('again', first.state), alice)).toMatchObject({ ok: false, status: 'expired' });
  });

  it('never loses a response when the store fails: it falls back to signed browser state', async () => {
    const inner = memoryThreadStore();
    let down = false;
    const flaky: ThreadStore = { ...inner, save: (t, e) => (down ? Promise.reject(new Error('store down')) : inner.save(t, e)) };
    const { engine, db } = withThreads([call('posts_count'), say('You have 2 posts.'), say('Back.')], flaky);
    down = true;
    const result = ok(await engine.handle(message('how many posts'), alice));
    expect(result.events.some((e) => e.type === 'assistant' && e.text === 'You have 2 posts.')).toBe(true);
    expect(result.state.length).toBeGreaterThan(260); // full sealed state, not a pointer
    down = false;
    const next = ok(await engine.handle(message('and now', result.state), alice));
    expect(await inner.get(next.threadId!)).toMatchObject({ version: 1 });
    void db;
  });

  it('rejects a tampered pointer', async () => {
    const { engine } = withThreads([say('Hi.')]);
    const first = ok(await engine.handle(message('hello'), alice));
    const bytes = Buffer.from(first.state.slice(3), 'base64url');
    bytes[bytes.length - 1]! ^= 1;
    expect((await engine.handle(message('x', `v2.${bytes.toString('base64url')}`), alice)).ok).toBe(false);
    expect((await engine.handle(message('x', first.state), bob)).ok).toBe(false);
  });

  it('is served by the handler: list, open and delete', async () => {
    const db = makeDb();
    const app = makeApp(db);
    const threads = memoryThreadStore();
    const handler = createHandler(
      { routes: app.routes, capabilities: app.capabilities },
      { secret: SECRET, planner: mockPlanner({ script: [say('Hi!')] }), getUser: () => alice, rateLimit: false, lockfile: false, store: 'memory', threads },
    );
    const post = async (body: unknown) =>
      (await handler(new Request('https://app.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(body) }))).json();
    const turn = await post({ type: 'message', text: 'hello from http', client: client() });
    expect(turn.threadId).toBeTruthy();
    expect(await post({ type: 'threads' })).toMatchObject({ ok: true, threads: [{ title: 'hello from http' }] });
    expect(await post({ type: 'thread-open', threadId: turn.threadId, client: client({ tabId: 'tab-9' }) })).toMatchObject({ ok: true, items: [{ role: 'user' }, { role: 'assistant', text: 'Hi!' }] });
    expect(await post({ type: 'thread-delete', threadId: turn.threadId })).toEqual({ ok: true });
    expect(await post({ type: 'threads' })).toEqual({ ok: true, threads: [] });
  });
});
