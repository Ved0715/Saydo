import { describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { aiSdkPlanner, toModelMessages } from '../src/core/ai-sdk';
import {
  DEFAULT_FIXES,
  buildPath,
  canonicalize,
  collectCapabilities,
  defineCapability,
  fastPath,
  findRoute,
  matchPath,
  searchRoutes,
  tierFor,
  titleFromPattern,
} from '../src/core/index';
import { seal, unseal } from '../src/core/server';
import { SECRET } from './fixtures';

describe('seal', () => {
  it('round-trips and rejects tampering or the wrong key', async () => {
    const token = await seal({ a: 1, text: 'héllo ✓' }, SECRET);
    expect(await unseal(token, SECRET)).toEqual({ a: 1, text: 'héllo ✓' });
    expect(await unseal(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), SECRET)).toBeNull();
    expect(await unseal(token, `${SECRET}-other`)).toBeNull();
    expect(await unseal('garbage', SECRET)).toBeNull();
    await expect(seal({}, 'short')).rejects.toThrow(/SAYDO_SECRET/);
  });
});

describe('canonicalize (RFC 8785)', () => {
  it('is independent of key order and unicode composition', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalize({ name: 'Café' })).toBe(canonicalize({ name: 'Café' }));
    expect(canonicalize(1e21)).toBe('1e+21');
    expect(canonicalize({ skip: undefined, keep: 0 })).toBe('{"keep":0}');
    expect(() => canonicalize(Number.NaN)).toThrow();
  });
});

describe('routes', () => {
  it('parses, builds and matches App Router patterns', () => {
    expect(buildPath('/posts/[id]', { id: 'a b' })).toBe('/posts/a%20b');
    expect(buildPath('/docs/[[...slug]]')).toBe('/docs');
    expect(buildPath('/docs/[...slug]', { slug: ['a', 'b'] })).toBe('/docs/a/b');
    expect(() => buildPath('/posts/[id]')).toThrow(/fix/);
    expect(matchPath('/posts/[id]', '/posts/42')).toEqual({ id: '42' });
    expect(matchPath('/posts/[id]', '/posts/42/edit')).toBeNull();
    expect(matchPath('/docs/[[...slug]]', '/docs')).toEqual({ slug: [] });
    const routes = [{ pattern: '/posts/[id]' }, { pattern: '/posts/new' }, { pattern: '/[...all]' }];
    expect(findRoute(routes, '/posts/new')?.pattern).toBe('/posts/new');
    expect(findRoute(routes, '/posts/7')?.pattern).toBe('/posts/[id]');
    expect(findRoute(routes, '/x/y')?.pattern).toBe('/[...all]');
    expect(titleFromPattern('/')).toBe('Home');
    expect(titleFromPattern('/team-settings/billing')).toBe('Team settings / Billing');
  });
});

describe('fast path', () => {
  const routes = [
    { pattern: '/billing', title: 'Billing', aliases: ['invoices'] },
    { pattern: '/settings', title: 'Settings' },
    { pattern: '/settings/billing', title: 'Billing settings' },
    { pattern: '/posts/new', title: 'New post' },
  ];
  it('answers unambiguous navigation locally', () => {
    expect(fastPath('take me to billing', routes)?.pattern).toBe('/billing');
    expect(fastPath('billing', routes)?.pattern).toBe('/billing');
    expect(fastPath('open my invoices', routes)?.pattern).toBe('/billing');
    expect(fastPath('go to the settings page', routes)?.pattern).toBe('/settings');
  });
  it('defers anything that is not plainly navigation', () => {
    expect(fastPath('delete billing', routes)).toBeNull();
    expect(fastPath('why was my billing wrong last month', routes)).toBeNull();
    expect(fastPath('start a new post titled Launch Notes', routes)).toBeNull();
  });
  it('ranks palette results', () => {
    expect(searchRoutes('bill', routes)[0]!.route.pattern).toBe('/billing');
  });
});

describe('capabilities', () => {
  it('defaults to destructive and enforces undo for reversible', () => {
    const cap = defineCapability({ id: 'a.b', describe: 'x', input: z.object({}), handler: () => {} });
    expect(cap.resolvedRisk).toBe('destructive');
    expect(cap.kind).toBe('server');
    expect(() =>
      // @ts-expect-error reversible requires undo (also enforced at runtime for JS callers)
      defineCapability({ id: 'a.c', describe: 'x', input: z.object({}), risk: 'reversible', handler: () => {} }),
    ).toThrow(/undo/);
    expect(() => defineCapability({ id: 'bad id', describe: 'x', input: z.object({}) })).toThrow(/fix/);
  });

  it('rejects duplicate ids during collection', () => {
    const a = defineCapability({ id: 'dup.x', describe: 'x', input: z.object({}) });
    const b = defineCapability({ id: 'dup.x', describe: 'y', input: z.object({}) });
    expect(() => collectCapabilities({ a, b })).toThrow(/unique/);
    expect(collectCapabilities({ a }, [a])).toHaveLength(1);
  });

  it('derives tiers from risk and blast radius', () => {
    expect(tierFor('read', {})).toBe(0);
    expect(tierFor('reversible', {})).toBe(1);
    expect(tierFor('write', {})).toBe(2);
    expect(tierFor('destructive', { ids: [1, 2] })).toBe(2);
    expect(tierFor('destructive', { ids: [1, 2, 3, 4, 5, 6] })).toBe(3);
    expect(tierFor('never', {})).toBe(4);
  });

  it('has a fix for every receipt status', () => {
    for (const [status, fix] of Object.entries(DEFAULT_FIXES)) {
      expect(fix.length, status).toBeGreaterThan(10);
    }
  });
});

describe('AI SDK planner', () => {
  it('maps model tool calls without executing anything', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          { type: 'text', text: 'Opening billing.' },
          { type: 'tool-call', toolCallId: 't1', toolName: 'nav_goto', input: JSON.stringify({ route: '/billing' }) },
        ],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const planner = aiSdkPlanner({ model });
    const output = await planner.plan({
      instructions: 'test',
      history: [{ role: 'user', text: 'take me to billing' }],
      tools: [
        {
          name: 'nav_goto',
          description: 'Open a page',
          inputSchema: { type: 'object', properties: { route: { type: 'string' } }, required: ['route'] },
        },
      ],
      page: { route: '/', entities: [] },
      hints: { routes: [] },
    });
    expect(output).toEqual({
      text: 'Opening billing.',
      calls: [{ id: 't1', name: 'nav_goto', args: { route: '/billing' } }],
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    });
    expect(typeof generateText).toBe('function');
  });

  it('pairs tool calls with tool results in model messages', () => {
    const messages = toModelMessages([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'ok', calls: [{ id: 'a', name: 'x', args: {} }, { id: 'b', name: 'y', args: {} }] },
      { role: 'tool', id: 'a', name: 'x', receipt: { status: 'ok' } },
      { role: 'tool', id: 'b', name: 'y', receipt: { status: 'denied', fix: undefined } },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect((messages[2]!.content as unknown[]).length).toBe(2);
  });
});
