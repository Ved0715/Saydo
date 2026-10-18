import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { aiSdkPlanner } from '../src/core/ai-sdk';
import { createHandler } from '../src/core/handler';
import { mockPlanner } from '../src/core/server';
import { Registry, SaydoRuntime } from '../src/react/index';
import { alice, bob, call, client, makeApp, makeDb, message, ok, say, SECRET, setup } from './fixtures';

const usage = { inputTokens: { total: 7, noCache: 7, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 3, text: 3, reasoning: undefined } };

function streamingModel(parts: unknown[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part as never);
          controller.close();
        },
      }),
    }),
  });
}

const input = (text = 'hi') => ({ instructions: 'x', history: [{ role: 'user' as const, text }], tools: [{ name: 'posts_count', description: 'Count', inputSchema: { type: 'object', properties: {} } }], page: { route: '/', entities: [] }, hints: { routes: [] } });

describe('streaming planner', () => {
  it('streams text deltas and still returns tool calls and usage', async () => {
    const model = streamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Let me ' },
      { type: 'text-delta', id: 't', delta: 'check.' },
      { type: 'text-end', id: 't' },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'posts_count', input: '{}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ]);
    const deltas: string[] = [];
    const output = await aiSdkPlanner({ model, maxRetries: 0 }).plan(input(), { onText: (d) => deltas.push(d) });
    expect(deltas).toEqual(['Let me ', 'check.']);
    expect(output).toMatchObject({ text: 'Let me check.', calls: [{ id: 'c1', name: 'posts_count', args: {} }], usage: { inputTokens: 7, outputTokens: 3 } });
  });

  it('fails over before any text, never after', async () => {
    const down = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('overloaded');
      },
    });
    const up = streamingModel([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Backup here.' },
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ]);
    const deltas: string[] = [];
    expect((await aiSdkPlanner({ model: [down, up], maxRetries: 0 }).plan(input(), { onText: (d) => deltas.push(d) })).text).toBe('Backup here.');
    expect(deltas).toEqual(['Backup here.']);

    const breaksMidway = streamingModel([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Half a' },
      { type: 'error', error: new Error('connection reset') },
    ]);
    await expect(aiSdkPlanner({ model: [breaksMidway, up], maxRetries: 0 }).plan(input(), { onText: () => {} })).rejects.toThrow();
  });

  it('picks the model and instructions per request', async () => {
    const fast = streamingModel([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'fast' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]);
    const strong = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'strong' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }),
    });
    const planner = aiSdkPlanner({ model: ({ user }) => (user.plan === 'pro' ? strong : fast), maxRetries: 0 });
    const instructions = vi.fn(({ user, route }: { user: { id: string }; route: string }) => `Speak to ${user.id} on ${route}.`);
    const pro = setup(undefined, { planner, instructions });
    const result = ok(await pro.engine.handle(message('hello', undefined, client({ route: '/billing' })), { id: 'u1', plan: 'pro' }));
    expect(result.events).toContainEqual({ type: 'assistant', text: 'strong' });
    expect(instructions).toHaveBeenCalledWith({ user: expect.objectContaining({ id: 'u1' }), route: '/billing' });
    const free = setup(undefined, { planner, instructions });
    const deltas: string[] = [];
    expect(ok(await free.engine.handle(message('hello'), bob, { onText: (d) => deltas.push(d) })).events).toContainEqual({ type: 'assistant', text: 'fast' });
    expect(deltas).toEqual(['fast']);
  });
});

describe('streaming over HTTP', () => {
  function app() {
    const db = makeDb();
    const { routes, capabilities } = makeApp(db);
    return createHandler(
      { routes, capabilities },
      { getUser: () => alice, store: 'memory', advanced: { secret: SECRET, lockfile: false, planner: mockPlanner({ script: [call('posts_count'), say('You have 2 posts.')] }) }, limits: { perMinute: false } },
    );
  }
  const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
    handler(new Request('https://app.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(body) }));

  it('sends text events, then exactly one result', async () => {
    const response = await post(app(), { type: 'message', text: 'how many posts', client: client(), stream: true });
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('You have 2 posts.');
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { ok: true, done: true } });
    expect(events.filter((e) => e.type === 'result')).toHaveLength(1);
  });

  it('streams into the runtime and ends with the authoritative result', async () => {
    const handler = app();
    const seen: string[] = [];
    const runtime = new SaydoRuntime({
      endpoint: '/api/saydo',
      registry: new Registry(),
      tabId: 'tab-1',
      fetch: (async (_url: unknown, init?: RequestInit) =>
        handler(new Request('https://app.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: init?.body as string }))) as typeof fetch,
      onNavigated: () => {},
      router: { push: () => {} },
    });
    runtime.subscribe(() => {
      const streaming = runtime.getSnapshot().streaming;
      if (streaming && seen.at(-1) !== streaming) seen.push(streaming);
    });
    await runtime.send('how many posts');
    expect(seen).toContain('You have 2 posts.');
    expect(runtime.getSnapshot().streaming).toBeUndefined();
    expect(runtime.getSnapshot().items.filter((i) => i.role === 'assistant').map((i) => i.text)).toEqual(['You have 2 posts.']);
  });

  it('keeps plain JSON for clients that do not ask to stream', async () => {
    const response = await post(app(), { type: 'message', text: 'how many posts', client: client() });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
