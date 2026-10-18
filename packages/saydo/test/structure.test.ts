import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { configWarnings, mergeConfig } from '../src/core/config';
import { createHandler, normalizeConfig } from '../src/core/handler';
import { defineCapability } from '../src/core/index';
import { mockPlanner } from '../src/core/server';
import { alice, call, client, makeApp, makeDb, message, ok, say, SECRET, setup } from './fixtures';

describe('structured config', () => {
  it('maps groups onto the engine and warns about old or unknown keys', () => {
    const flat = normalizeConfig({
      getUser: 'anonymous',
      knowledge: { name: 'Acme', about: 'Invoices.' },
      see: { page: false, redact: 'strict' },
      limits: { perMinute: 10, perDay: { requests: 5, tokens: 100 }, steps: 3, tools: 12 },
      conversations: { retentionDays: 2 },
      act: { taint: 'off', clarify: false },
      advanced: { secret: SECRET, lockfile: false },
    });
    expect(flat).toMatchObject({
      anonymous: true,
      appName: 'Acme',
      see: { page: false },
      redact: 'strict',
      rateLimit: 10,
      budget: { requestsPerDay: 5, tokensPerDay: 100 },
      maxSteps: 3,
      maxTools: 12,
      threadTtlMs: 2 * 24 * 60 * 60_000,
      taint: 'off',
      clarify: false,
      secret: SECRET,
    });
    expect(configWarnings({ appName: 'x', rateLimit: 3, nope: 1 } as never)).toEqual([
      '"appName" is now knowledge.name in saydo.config.ts.',
      '"rateLimit" is now limits.perMinute in saydo.config.ts.',
      'Unknown option "nope" in saydo.config.ts.',
    ]);
    expect(mergeConfig({ limits: { perMinute: 3, steps: 2 } }, { limits: { steps: 9 } })).toEqual({ limits: { perMinute: 3, steps: 9 } });
  });
});

describe('knowledge and the app guide', () => {
  it('answers "how do I" from docs and from the app’s own pages and actions', async () => {
    const { engine, plannerCalls } = setup(
      [call('app_guide', { question: 'how do I archive a post?' }), say('Open the post and ask me to archive it; it can be undone.')],
      {
        knowledge: {
          name: 'Acme Posts',
          about: 'A blog editor for small teams.',
          docs: [{ title: 'Refund policy', text: 'Refunds within 30 days.', keywords: ['money back'] }],
        },
      },
    );
    const result = ok(await engine.handle(message('how do I archive a post?'), alice));
    expect(plannerCalls[0]!.instructions).toContain('About Acme Posts: A blog editor for small teams.');
    const guide = plannerCalls[1]!.history.find((h) => h.role === 'tool' && h.name === 'app_guide') as { receipt: { result: { answers: { title: string; text: string }[] } } };
    expect(guide.receipt.result.answers[0]).toMatchObject({ title: 'Archive a post', text: expect.stringContaining('can be undone') });
    expect(result.events.at(-1)).toMatchObject({ type: 'assistant' });

    const docs = setup([call('app_guide', { question: 'can I get my money back' }), say('ok')], {
      knowledge: { docs: async ({ user }) => [{ title: `Refunds for ${user.id}`, text: 'Within 30 days.', keywords: ['money back'] }] },
    });
    ok(await docs.engine.handle(message('can I get my money back'), alice));
    const answer = docs.plannerCalls[1]!.history.find((h) => h.role === 'tool' && h.name === 'app_guide') as { receipt: { result: { answers: { title: string }[] } } };
    expect(answer.receipt.result.answers[0]!.title).toBe('Refunds for u1');
  });

  it('can be turned off', async () => {
    const { engine, plannerCalls } = setup([say('ok')], { knowledge: { guide: false }, clarify: false });
    ok(await engine.handle(message('hi'), alice));
    const names = plannerCalls[0]!.tools.map((t) => t.name);
    expect(names).not.toContain('app_guide');
    expect(names).not.toContain('ask_user');
  });
});

describe('clarifying questions', () => {
  it('asks with options and ends the turn; the answer is the next message', async () => {
    const { engine, plannerCalls } = setup([
      call('ask_user', { question: 'Which post?', options: ['Launch notes', 'Roadmap'] }),
      say('Archived Roadmap.'),
    ]);
    const asked = ok(await engine.handle(message('archive the post'), alice));
    expect(asked.events).toEqual([{ type: 'question', question: 'Which post?', options: ['Launch notes', 'Roadmap'] }]);
    expect(plannerCalls).toHaveLength(1);
    const answered = ok(await engine.handle(message('Roadmap', asked.state), alice));
    expect(answered.events).toContainEqual({ type: 'assistant', text: 'Archived Roadmap.' });
  });

  it('rejects a question without enough options', async () => {
    const { engine } = setup([call('ask_user', { question: 'Which?', options: ['only one'] }), say('ok')]);
    const result = ok(await engine.handle(message('do it'), alice));
    expect(result.events.find((e) => e.type === 'action')).toMatchObject({ status: 'invalid_args' });
  });
});

describe('hide', () => {
  it('removes pages, actions and context from everything the model sees, and from agents', async () => {
    const db = makeDb();
    const app = makeApp(db);
    const exposed = defineCapability({ id: 'admin.export', describe: 'Export all data', input: z.object({}), risk: 'read', expose: { external: true }, handler: () => 'csv' });
    const { engine, plannerCalls } = setup([say('ok')], {
      capabilities: [...app.capabilities, exposed],
      routes: app.routes,
      hide: { routes: ['/billing', '/admin/*'], actions: ['posts.delete', 'admin.*'], context: ['secretNote'] },
    });
    ok(await engine.handle(message('hi', undefined, client({ context: { secretNote: 'xyz', cart: 2 } })), alice));
    const input = plannerCalls[0]!;
    const tools = input.tools.map((t) => t.name);
    expect(tools).not.toContain('posts_delete');
    expect(tools).not.toContain('admin_export');
    expect(JSON.stringify(input.tools.find((t) => t.name === 'nav_goto'))).not.toContain('/billing');
    expect(input.instructions).not.toContain('xyz');
    expect(input.instructions).toContain('cart');
    expect((await engine.manifest(alice)).routes.map((r) => r.pattern)).not.toContain('/billing');
    expect(await engine.agentTools(alice, 'external')).toEqual([]);
  });

  it('sends hidden fields and selectors to the browser, and masks form values on the server too', async () => {
    const { engine, plannerCalls } = setup([say('ok')], { hide: { fields: ['salary'], selectors: ['.payroll'] } });
    expect((await engine.manifest(alice)).settings).toMatchObject({ privateFields: ['salary'], privateSelectors: ['.payroll'] });
    const page = {
      text: 'Form',
      truncated: false,
      elements: [{ ref: 'e1', role: 'button', name: 'Save', actions: ['click' as const], submits: true, formValues: { Salary: '90000', Name: 'Ada' } }],
    };
    ok(await engine.handle(message('save it', undefined, client({ page })), alice));
    expect(JSON.stringify(plannerCalls[0])).not.toContain('90000');
  });
});

describe('streamed progress', () => {
  it('reports a label as each step starts', async () => {
    const steps: string[] = [];
    const { engine } = setup([call('nav_goto', { route: '/billing' })]);
    ok(await engine.handle(message('billing please'), alice, { onStep: (label) => steps.push(label) }));
    expect(steps).toEqual(['Opening Billing…']);

    const db = makeDb();
    const app = makeApp(db);
    const handler = createHandler(
      { routes: app.routes, capabilities: app.capabilities },
      { getUser: () => alice, store: 'memory', limits: { perMinute: false }, advanced: { secret: SECRET, lockfile: false, planner: mockPlanner({ script: [call('posts_count'), say('Two.')] }) } },
    );
    const response = await handler(
      new Request('https://app.test/api/saydo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.test' },
        body: JSON.stringify({ type: 'message', text: 'count', client: client(), stream: true }),
      }),
    );
    const events = (await response.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'step').map((e) => e.text)).toEqual(['Count the user posts…']);
  });
});
