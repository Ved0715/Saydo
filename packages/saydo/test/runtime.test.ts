import { describe, expect, it, vi } from 'vitest';
import { SaydoRuntime, Registry } from '../src/react/index';
import { alice, setup } from './fixtures';
import type { Engine } from '../src/core/server';

function harness(engine: Engine) {
  const registry = new Registry();
  const pushes: string[] = [];
  let calls = 0;
  const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const data = body.type === 'manifest' ? await engine.manifest(alice) : await engine.handle(body, alice);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const runtime: SaydoRuntime = new SaydoRuntime({
    endpoint: '/api/ai',
    registry,
    tabId: 'tab-1',
    fetch: fakeFetch,
    onNavigated: () => {},
    router: {
      push: (href) => {
        pushes.push(href);
        runtime.notifyPath(href.split('?')[0]!);
      },
      refresh: () => {},
    },
  });
  return { runtime, registry, pushes, fetchCount: () => calls };
}

describe('SaydoRuntime', () => {
  it('answers plain navigation locally without calling the server', async () => {
    const { engine } = setup();
    const { runtime, pushes, fetchCount } = harness(engine);
    await runtime.loadManifest();
    const before = fetchCount();
    await runtime.send('take me to billing');
    expect(pushes).toEqual(['/billing']);
    expect(fetchCount()).toBe(before);
    expect(runtime.getSnapshot().announcement).toBe('Assistant opened Billing');
  });

  it('runs a gated action end to end: confirm card, trusted approval, navigation', async () => {
    const { engine, db } = setup();
    const { runtime, pushes } = harness(engine);
    await runtime.loadManifest();
    runtime.notifyPath('/billing');
    await runtime.send('start a new post titled Launch Notes');
    const confirm = runtime.getSnapshot().confirm;
    expect(confirm?.view.fields).toEqual([{ label: 'title', value: 'Launch Notes', untrusted: true }]);

    await runtime.approve(false);
    expect(runtime.getSnapshot().confirmError).toMatch(/real click/);
    expect(runtime.getSnapshot().confirm).toBeDefined();
    expect([...db.posts.values()].some((p) => p.title === 'Launch Notes')).toBe(false);

    await runtime.approve(true);
    expect([...db.posts.values()].some((p) => p.title === 'Launch Notes')).toBe(true);
    expect(pushes.at(-1)).toBe('/posts/p10');
    expect(runtime.getSnapshot().confirm).toBeUndefined();
  });

  it('dispatches UI actions to mounted handlers and reports back', async () => {
    const { engine } = setup();
    const { runtime, registry } = harness(engine);
    const opened = vi.fn();
    registry.register(Symbol(), { id: 'share.open', kind: 'ui', describe: 'Open the share dialog', run: opened });
    await runtime.send('open the share dialog');
    expect(opened).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().busy).toBe(false);
  });

  it('passes the grant to client capabilities so withGrant can verify it', async () => {
    const { engine } = setup();
    const { runtime, registry } = harness(engine);
    runtime.notifyPath('/posts/p1');
    let verdict: unknown;
    registry.register(Symbol(), {
      id: 'posts.publish',
      kind: 'capability',
      run: async (args, ctx) => {
        verdict = await engine.consumeClientGrant(ctx.headers['x-saydo-grant']!, {
          capabilityId: 'posts.publish',
          user: alice,
          body: { id: (args as { post: { id: string } }).post.id },
          match: (body, approved) => (body as { id: string }).id === (approved as { post: { id: string } }).post.id,
        });
        return { status: 'ok', message: 'Published.' };
      },
    });
    await runtime.send('publish this post');
    expect(runtime.getSnapshot().confirm?.capability).toBe('posts.publish');
    await runtime.approve(true);
    expect(verdict).toMatchObject({ ok: true });
  });

  it('degrades to a notice when the server is unreachable', async () => {
    const registry = new Registry();
    const runtime = new SaydoRuntime({
      endpoint: '/api/ai',
      registry,
      tabId: 't',
      router: { push: () => {} },
      fetch: (async () => {
        throw new TypeError('network down');
      }) as unknown as typeof fetch,
    });
    await runtime.send('summarize my week');
    const snapshot = runtime.getSnapshot();
    expect(snapshot.offline).toBe(true);
    expect(snapshot.items.at(-1)).toMatchObject({ role: 'notice' });
  });
});

describe('AINavRuntime resilience', () => {
  it('retries a dropped response with the same requestId, and the server runs it once', async () => {
    const { engine, db } = setup();
    const seen: string[] = [];
    let drops = 1;
    const registry = new Registry();
    const runtime: SaydoRuntime = new SaydoRuntime({
      endpoint: '/api/saydo',
      registry,
      tabId: 'tab-1',
      onNavigated: () => {},
      router: { push: (href) => runtime.notifyPath(href.split('?')[0]!) },
      fetch: (async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.requestId) seen.push(body.requestId);
        const data = body.type === 'manifest' ? await engine.manifest(alice) : await engine.handle(body, alice);
        if (body.type !== 'manifest' && drops-- > 0) throw new TypeError('connection reset'); // executed, response lost
        return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch,
    });
    runtime.notifyPath('/posts/p2');
    await runtime.send('archive this post');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(db.posts.get('p2')!.archived).toBe(true);
    // The second (replayed) response is the original success, not "already archived".
    expect(runtime.getSnapshot().items.some((i) => i.status === 'precondition_failed')).toBe(false);
    expect(runtime.getSnapshot().offline).toBe(false);
  });

  it('will not navigate away from unsaved changes', async () => {
    const { engine } = setup();
    const { runtime, registry, pushes } = harness(engine);
    await runtime.loadManifest();
    registry.setGuard(Symbol(), 'Your draft is not saved.');
    await runtime.send('take me to billing');
    expect(pushes).toEqual([]);
    expect(runtime.getSnapshot().items.at(-1)).toMatchObject({ role: 'notice', status: 'blocked' });
  });
});

describe('Registry', () => {
  it('is idempotent across StrictMode-style double registration and waits for mounts', async () => {
    const registry = new Registry();
    const owner = Symbol();
    const action = { id: 'a', kind: 'ui' as const, run: () => {} };
    const off1 = registry.register(owner, action);
    off1();
    const off2 = registry.register(owner, action);
    expect(registry.ids()).toEqual(['a']);
    off2();
    expect(registry.ids()).toEqual([]);

    const waiting = registry.waitFor('later', 1000);
    setTimeout(() => registry.register(Symbol(), { id: 'later', kind: 'ui', run: () => {} }), 10);
    expect(await waiting).toBe(true);
    expect(await registry.waitFor('never', 20)).toBe(false);
  });
});
