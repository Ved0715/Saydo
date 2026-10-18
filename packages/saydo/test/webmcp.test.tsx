// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCapability, type InvokeResult } from '../src/core/index';
import { Registry, SaydoApproval, SaydoProvider, SaydoRuntime, registerWebMcpTools } from '../src/react/index';
import { alice, makeApp, makeDb, setup, type Db } from './fixtures';
import type { Engine } from '../src/core/server';

afterEach(cleanup);

function caps(db: Db) {
  const { Post } = makeApp(db);
  return [
    defineCapability({
      id: 'posts.count',
      describe: 'Count the user posts',
      input: z.object({}),
      risk: 'read',
      expose: { browserAgent: true },
      handler: (_input, ctx) => ({ result: { count: [...db.posts.values()].filter((p) => p.ownerId === ctx.user.id).length } }),
    }),
    defineCapability({
      id: 'posts.delete',
      describe: 'Permanently delete posts',
      input: z.object({ posts: z.array(Post.ref()).min(1) }),
      risk: 'destructive',
      expose: { browserAgent: true, external: true },
      handler: ({ posts }) => {
        for (const p of posts) db.posts.delete(p.id);
        return { result: { deleted: posts.length } };
      },
    }),
  ];
}

/** Routes runtime requests to the engine the way the handler does. */
function serverFetch(engine: Engine) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const data =
      body.type === 'manifest'
        ? await engine.manifest(alice)
        : body.type === 'invoke'
          ? await engine.invoke(alice, { tool: body.tool, args: body.args, origin: 'browser-agent' })
          : body.type === 'grant-approve'
            ? await engine.approveDelegated(alice, body)
            : body.type === 'grant-status'
              ? await engine.grantStatus(alice, body.grantId)
              : await engine.handle(body, alice);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

function env() {
  const db = makeDb();
  const { engine } = setup(undefined, { capabilities: caps(db), external: { approvals: 'delegated' } });
  const runtime = new SaydoRuntime({
    endpoint: '/api/saydo',
    registry: new Registry(),
    tabId: 'tab-1',
    fetch: serverFetch(engine),
    onNavigated: () => {},
    router: { push: () => {}, refresh: () => {} },
  });
  return { db, engine, runtime };
}

type Registered = { name: string; annotations: Record<string, boolean>; execute: (input: unknown) => Promise<unknown> };

function fakeModelContext() {
  const registered: Registered[] = [];
  const aborted: string[] = [];
  (document as unknown as { modelContext?: unknown }).modelContext = {
    registerTool(tool: Registered, options?: { signal?: AbortSignal }) {
      registered.push(tool);
      options?.signal?.addEventListener('abort', () => aborted.push(tool.name));
    },
  };
  return { registered, aborted, restore: () => delete (document as unknown as { modelContext?: unknown }).modelContext };
}

describe('WebMCP', () => {
  it('registers exposed tools once, routes calls through the runtime, and cleans up', async () => {
    const mc = fakeModelContext();
    try {
      const { engine } = env();
      const tools = await engine.agentTools(alice, 'browser-agent');
      const invokeAgent = vi.fn(async (): Promise<InvokeResult> => ({ ok: true, status: 'ok', receipt: { status: 'ok', message: 'Counted', result: { count: 2 } } as never }));
      const runtime = { invokeAgent } as unknown as SaydoRuntime;
      const dispose = registerWebMcpTools(runtime, tools);
      registerWebMcpTools(runtime, tools); // StrictMode double effect: no duplicates
      expect(mc.registered.map((t) => t.name)).toEqual(['posts_count', 'posts_delete']);
      expect(mc.registered[1]!.annotations).toMatchObject({ readOnlyHint: false, consequentialHint: true });
      const out = (await mc.registered[0]!.execute({})) as { content: { text: string }[]; isError: boolean };
      expect(invokeAgent).toHaveBeenCalledWith('posts_count', {});
      expect(out).toMatchObject({ isError: false });
      expect(out.content[0]!.text).toContain('"count":2');
      dispose();
      expect(mc.aborted).toEqual(['posts_count', 'posts_delete']);
    } finally {
      mc.restore();
    }
  });

  it('is a no-op without a browser model context', async () => {
    const { engine, runtime } = env();
    const tools = await engine.agentTools(alice, 'browser-agent');
    expect(() => registerWebMcpTools(runtime, tools)()).not.toThrow();
  });

  it('runs a gated browser-agent call only after the user approves the normal card', async () => {
    const { db, runtime } = env();
    const pending = runtime.invokeAgent('posts_delete', { posts: ['p1'] });
    await waitFor(() => expect(runtime.getSnapshot().confirm?.agent).toBe(true));
    expect(runtime.getSnapshot().open).toBe(true);
    expect(db.posts.has('p1')).toBe(true);

    await runtime.approve(false);
    expect(runtime.getSnapshot().confirmError).toMatch(/real click/);
    expect(db.posts.has('p1')).toBe(true);

    await runtime.approve(true);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, status: 'ok', receipt: { result: { deleted: 1 } } });
    expect(db.posts.has('p1')).toBe(false);
    expect(runtime.getSnapshot().confirm).toBeUndefined();
  });

  it('tells the agent when the user declines', async () => {
    const { db, runtime } = env();
    const pending = runtime.invokeAgent('posts_delete', { posts: ['p1'] });
    await waitFor(() => expect(runtime.getSnapshot().confirm).toBeDefined());
    await runtime.deny();
    expect(await pending).toMatchObject({ ok: true, status: 'denied' });
    expect(db.posts.has('p1')).toBe(true);
  });

  it('the provider registers tools only with agents enabled', async () => {
    const mc = fakeModelContext();
    try {
      const db = makeDb();
      const { engine } = setup(undefined, { capabilities: caps(db) });
      const fetchImpl = serverFetch(engine);
      vi.stubGlobal('fetch', fetchImpl);
      const { unmount } = render(<SaydoProvider router={{ push: () => {}, refresh: () => {} }} pathname="/" agents ui={false}><p>app</p></SaydoProvider>);
      await waitFor(() => expect(mc.registered.map((t) => t.name)).toEqual(['posts_count', 'posts_delete']));
      unmount();
      expect(mc.aborted).toEqual(['posts_count', 'posts_delete']);
      mc.registered.length = 0;
      render(<SaydoProvider router={{ push: () => {}, refresh: () => {} }} pathname="/" ui={false}><p>app</p></SaydoProvider>);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(mc.registered).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      mc.restore();
    }
  });
});

describe('SaydoApproval page', () => {
  it('shows the server-built card for a pending external request and records a decline', async () => {
    const db = makeDb();
    const { engine } = setup(undefined, { capabilities: caps(db), external: { approvals: 'delegated' } });
    const staged = (await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' })) as Extract<InvokeResult, { status: 'needs_approval' }>;
    vi.stubGlobal('fetch', serverFetch(engine));
    try {
      render(
        <SaydoProvider router={{ push: () => {}, refresh: () => {} }} pathname="/saydo/approve" ui={false}>
          <SaydoApproval grantId={staged.approval.grantId} />
        </SaydoProvider>,
      );
      expect(await screen.findByText(/An AI agent connected to your account/)).toBeTruthy();
      expect(screen.getByText(staged.approval.view.title)).toBeTruthy();
      // Synthetic clicks are untrusted: approving is refused, nothing runs.
      fireEvent.click(screen.getByRole('button', { name: /yes, do it/i }));
      await waitFor(() => expect(screen.getByText(/real click/)).toBeTruthy());
      expect(db.posts.has('p1')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(await screen.findByText(/Declined/)).toBeTruthy();
      expect(await engine.grantStatus(alice, staged.approval.grantId)).toMatchObject({ state: 'denied' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('explains a request that is no longer pending', async () => {
    const db = makeDb();
    const { engine } = setup(undefined, { capabilities: caps(db), external: { approvals: 'delegated' } });
    const staged = (await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' })) as Extract<InvokeResult, { status: 'needs_approval' }>;
    await engine.approveDelegated(alice, { grantId: staged.approval.grantId, approved: false });
    vi.stubGlobal('fetch', serverFetch(engine));
    try {
      render(
        <SaydoProvider router={{ push: () => {}, refresh: () => {} }} pathname="/" ui={false}>
          <SaydoApproval grantId={staged.approval.grantId} />
        </SaydoProvider>,
      );
      expect(await screen.findByText('This request was declined.')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
