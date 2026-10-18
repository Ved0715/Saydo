import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMCPClient, type JSONRPCMessage, type MCPTransport } from '@ai-sdk/mcp';
import { defineCapability, type InvokeResult } from '../src/core/index';
import { createMcpHandler } from '../src/core/mcp';
import type { SaydoConfig } from '../src/core/config';
import { mockPlanner } from '../src/core/server';
import { alice, bob, makeApp, makeDb, SECRET, setup, type Db } from './fixtures';

function agentCaps(db: Db) {
  const { Post } = makeApp(db);
  return [
    defineCapability({
      id: 'posts.count',
      describe: 'Count the user posts',
      input: z.object({}),
      risk: 'read',
      expose: { external: true, browserAgent: true },
      handler: (_input, ctx) => ({ result: { count: [...db.posts.values()].filter((p) => p.ownerId === ctx.user.id).length } }),
    }),
    defineCapability({
      id: 'posts.archive',
      describe: 'Archive a post',
      input: z.object({ post: Post.ref() }),
      risk: 'reversible',
      expose: { external: true },
      handler: ({ post }) => {
        db.posts.get(post.id)!.archived = true;
      },
      undo: ({ post }) => {
        db.posts.get(post.id)!.archived = false;
      },
    }),
    defineCapability({
      id: 'posts.delete',
      describe: 'Permanently delete posts',
      input: z.object({ posts: z.array(Post.ref()).min(1) }),
      risk: 'destructive',
      expose: { external: true, browserAgent: true },
      handler: ({ posts }) => {
        for (const p of posts) db.posts.delete(p.id);
        return { result: { deleted: posts.length } };
      },
    }),
    defineCapability({
      id: 'posts.rename',
      describe: 'Rename a post (assistant only)',
      input: z.object({ post: Post.ref(), title: z.string() }),
      risk: 'write',
      handler: () => {},
    }),
    defineCapability({
      id: 'account.purge',
      describe: 'Delete the account',
      input: z.object({}),
      risk: 'never',
      expose: { external: true },
      handler: () => {
        throw new Error('must never run');
      },
    }),
  ];
}

function agentSetup(approvals: 'deny' | 'delegated' = 'delegated') {
  const db = makeDb();
  const env = setup(undefined, { capabilities: agentCaps(db), external: { approvals, approvalUrl: '/saydo/approve' } });
  return { ...env, db };
}

describe('engine agent entry points', () => {
  it('lists only exposed, non-never actions, with ids instead of handles', async () => {
    const { engine } = agentSetup();
    const external = await engine.agentTools(alice, 'external');
    expect(external.map((t) => t.name)).toEqual(['posts_archive', 'posts_count', 'posts_delete']);
    expect((await engine.agentTools(alice, 'browser-agent')).map((t) => t.name)).toEqual(['posts_count', 'posts_delete']);
    const del = external.find((t) => t.name === 'posts_delete')!;
    expect(del.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(JSON.stringify(del.inputSchema)).toContain('The id of the post.');
    const manifest = await engine.manifest(alice);
    expect(manifest.agentTools?.map((t) => t.name)).toEqual(['posts_count', 'posts_delete']);
    expect(manifest.protocolVersion).toBeDefined();
  });

  it('runs reads directly and refuses unknown or hidden tools', async () => {
    const { engine } = agentSetup();
    expect(await engine.invoke(alice, { tool: 'posts_count', args: {}, origin: 'external' })).toMatchObject({ ok: true, status: 'ok', receipt: { result: { count: 2 } } });
    expect(await engine.invoke(alice, { tool: 'posts_rename', args: {}, origin: 'external' })).toMatchObject({ ok: false, status: 'not_found' });
    expect(await engine.invoke(alice, { tool: 'account_purge', args: {}, origin: 'external' })).toMatchObject({ ok: false, status: 'not_found' });
  });

  it('runs reversible actions with an undo token that works once', async () => {
    const { engine, db } = agentSetup();
    const result = await engine.invoke(alice, { tool: 'posts_archive', args: { post: 'p2' }, origin: 'external' });
    expect(result).toMatchObject({ ok: true, status: 'ok', undo: expect.any(String) });
    expect(db.posts.get('p2')!.archived).toBe(true);
    const token = (result as { undo: string }).undo;
    const undo = () => engine.handle({ type: 'undo', token, client: { route: '/', tabId: 'external', mounted: [], uiActions: [] } }, alice);
    expect((await undo()).ok).toBe(true);
    expect(db.posts.get('p2')!.archived).toBe(false);
    expect((await undo()).ok).toBe(false);
  });

  it('applies the entity authz to agent-supplied ids', async () => {
    const { engine, db } = agentSetup();
    const result = await engine.invoke(bob, { tool: 'posts_archive', args: { post: 'p1' }, origin: 'external' });
    expect(result.ok && result.status !== 'needs_approval' ? result.receipt.status : 'failed').not.toBe('ok');
    expect(db.posts.get('p1')!.archived).toBe(false);
  });

  it('refuses gated actions unless delegated approvals are on', async () => {
    const { engine, db } = agentSetup('deny');
    const result = await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' });
    expect(result).toMatchObject({ ok: false, status: 'forbidden', code: 'approval_required' });
    expect(db.posts.has('p1')).toBe(true);
  });

  it('stages gated actions for approval in the app: trusted, once, by the right user', async () => {
    const { engine, db, advance } = agentSetup();
    const staged = await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' });
    if (!staged.ok || staged.status !== 'needs_approval') throw new Error(`expected needs_approval, got ${staged.status}`);
    const { grantId, url, view } = staged.approval;
    expect(url).toBe(`/saydo/approve/${grantId}`);
    expect(view.title).toBeTruthy();
    expect(db.posts.has('p1')).toBe(true);

    expect(await engine.grantStatus(alice, grantId)).toMatchObject({ ok: true, state: 'pending', origin: 'external' });
    expect(await engine.grantStatus(bob, grantId)).toMatchObject({ ok: false });
    expect(await engine.approveDelegated(bob, { grantId, approved: true, trusted: true })).toMatchObject({ ok: false, status: 'forbidden' });
    expect(await engine.approveDelegated(alice, { grantId, approved: true, trusted: false })).toMatchObject({ ok: false, status: 'denied' });
    expect(db.posts.has('p1')).toBe(true);

    advance(1000);
    const approved = await engine.approveDelegated(alice, { grantId, approved: true, trusted: true });
    expect(approved).toMatchObject({ ok: true, status: 'ok', receipt: { result: { deleted: 1 } } });
    expect(db.posts.has('p1')).toBe(false);

    // Replays return the stored outcome without running again.
    db.posts.set('p1', { id: 'p1', title: 'Back', body: '', ownerId: 'u1', archived: false, published: false });
    expect(await engine.approveDelegated(alice, { grantId, approved: true, trusted: true })).toMatchObject({ ok: true, status: 'ok' });
    expect(db.posts.has('p1')).toBe(true);
    expect(await engine.grantStatus(alice, grantId)).toMatchObject({ ok: true, state: 'approved', receipt: { status: 'ok' } });
  });

  it('records denials and expiry', async () => {
    const { engine, db, advance } = agentSetup();
    const first = (await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' })) as Extract<InvokeResult, { status: 'needs_approval' }>;
    expect(await engine.approveDelegated(alice, { grantId: first.approval.grantId, approved: false })).toMatchObject({ ok: true, status: 'denied' });
    expect(await engine.grantStatus(alice, first.approval.grantId)).toMatchObject({ state: 'denied' });

    const second = (await engine.invoke(alice, { tool: 'posts_delete', args: { posts: ['p1'] }, origin: 'external' })) as Extract<InvokeResult, { status: 'needs_approval' }>;
    advance(60 * 60 * 1000);
    expect(await engine.grantStatus(alice, second.approval.grantId)).toMatchObject({ state: 'expired' });
    expect(await engine.approveDelegated(alice, { grantId: second.approval.grantId, approved: true, trusted: true })).toMatchObject({ ok: false, status: 'expired' });
    expect(db.posts.has('p1')).toBe(true);
  });
});

// ------------------------------------------------------------------ MCP server

function mcpHandler(db: Db, authenticate?: (r: Request) => { id: string } | null) {
  const app = makeApp(db);
  return createMcpHandler(
    { routes: app.routes, capabilities: agentCaps(db) },
    { getUser: () => alice, agents: authenticate ? { authenticate, approvals: 'delegated', appOrigin: 'https://blog.test' } : undefined, advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false }, limits: { perMinute: false }, knowledge: { name: 'Blog' } },
  );
}

const rpc = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer alice' }) =>
  new Request('https://blog.test/api/saydo/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const tokens = (r: Request) => (r.headers.get('authorization') === 'Bearer alice' ? alice : null);

/** An MCP client transport that calls the route handler in-process. */
function inProcess(handler: ReturnType<typeof createMcpHandler>, auth = 'Bearer alice'): MCPTransport {
  const transport: MCPTransport = {
    async start() {},
    async close() {
      transport.onclose?.();
    },
    async send(message: JSONRPCMessage) {
      const response = await handler.POST(rpc(message, { authorization: auth }));
      if (response.status === 202) return;
      const body = (await response.json()) as JSONRPCMessage | JSONRPCMessage[];
      for (const reply of Array.isArray(body) ? body : [body]) transport.onmessage?.(reply);
    },
  };
  return transport;
}

describe('MCP server', () => {
  it('is off without authenticate and rejects unauthenticated clients', async () => {
    expect((await mcpHandler(makeDb()).POST(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }))).status).toBe(404);
    const handler = mcpHandler(makeDb(), tokens);
    const denied = await handler.POST(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Bearer');
    expect((await handler.GET()).status).toBe(405);
  });

  it('speaks JSON-RPC: initialize, notifications, batches and errors', async () => {
    const handler = mcpHandler(makeDb(), tokens);
    const init = await (await handler.POST(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))).json();
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'Blog' }, capabilities: { tools: {} } });
    expect((await handler.POST(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status).toBe(202);
    const batch = await (
      await handler.POST(
        rpc([
          { jsonrpc: '2.0', id: 'a', method: 'ping' },
          { jsonrpc: '2.0', id: 'b', method: 'nope' },
        ]),
      )
    ).json();
    expect(batch).toEqual([
      { jsonrpc: '2.0', id: 'a', result: {} },
      { jsonrpc: '2.0', id: 'b', error: { code: -32601, message: 'Method not found: nope' } },
    ]);
    expect((await handler.POST(new Request('https://blog.test/mcp', { method: 'POST', body: '{nope', headers: { authorization: 'Bearer alice' } }))).status).toBe(400);
  });

  it('works with the AI SDK MCP client end to end, including delegated approval', async () => {
    const db = makeDb();
    const handler = mcpHandler(db, tokens);
    const client = await createMCPClient({ transport: inProcess(handler) });
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(['posts_archive', 'posts_count', 'posts_delete', 'saydo_approval_status', 'saydo_undo']);

    const count = (await client.callTool({ name: 'posts_count', arguments: {} })) as { structuredContent?: { result: unknown }; isError?: boolean };
    expect(count.isError).toBe(false);
    expect(count.structuredContent?.result).toEqual({ count: 2 });

    const staged = (await client.callTool({ name: 'posts_delete', arguments: { posts: ['p2'] } })) as {
      structuredContent: { status: string; grantId: string; approvalUrl: string };
      content: { text: string }[];
    };
    expect(staged.structuredContent).toMatchObject({ status: 'needs_approval', approvalUrl: expect.stringMatching(/^https:\/\/blog\.test\/saydo\/approve\//) });
    expect(staged.content[0]!.text).toContain('saydo_approval_status');
    expect(db.posts.has('p2')).toBe(true);
    const grantId = staged.structuredContent.grantId;

    const pending = (await client.callTool({ name: 'saydo_approval_status', arguments: { grantId } })) as { structuredContent: { state: string } };
    expect(pending.structuredContent.state).toBe('pending');

    await client.close();
  });

  it('approves through the app handler that shares the grant store', async () => {
    const db = makeDb();
    const app = makeApp(db);
    const { createHandler } = await import('../src/core/handler');
    const { MemoryGrantStore } = await import('../src/core/server');
    const store = new MemoryGrantStore();
    const options: SaydoConfig = {
      getUser: () => alice,
      store,
      agents: { authenticate: tokens, approvals: 'delegated', appOrigin: 'https://blog.test' },
      limits: { perMinute: false },
      advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false },
    };
    const registry = { routes: app.routes, capabilities: agentCaps(db) };
    const mcp = createMcpHandler(registry, options);
    const appPost = createHandler(registry, options);
    const client = await createMCPClient({ transport: inProcess(mcp) });
    const staged = (await client.callTool({ name: 'posts_delete', arguments: { posts: ['p2'] } })) as { structuredContent: { grantId: string } };
    const grantId = staged.structuredContent.grantId;

    const call = async (body: unknown) =>
      (await appPost(new Request('https://blog.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://blog.test' }, body: JSON.stringify(body) }))).json();
    expect(await call({ type: 'grant-status', grantId })).toMatchObject({ ok: true, state: 'pending', view: { title: expect.any(String) } });
    expect(await call({ type: 'grant-approve', grantId, approved: true, trusted: true })).toMatchObject({ ok: true, status: 'ok' });
    expect(db.posts.has('p2')).toBe(false);

    const done = (await client.callTool({ name: 'saydo_approval_status', arguments: { grantId } })) as { structuredContent: { state: string; status: string } };
    expect(done.structuredContent).toMatchObject({ state: 'approved', status: 'ok' });

    const archived = (await client.callTool({ name: 'posts_archive', arguments: { post: 'p1' } })) as { structuredContent: { undo: string } };
    expect(db.posts.get('p1')!.archived).toBe(true);
    const undone = (await client.callTool({ name: 'saydo_undo', arguments: { token: archived.structuredContent.undo } })) as { isError: boolean };
    expect(undone.isError).toBe(false);
    expect(db.posts.get('p1')!.archived).toBe(false);
    await client.close();
  });
});
