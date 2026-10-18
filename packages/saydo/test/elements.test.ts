import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCapability, type PageElement } from '../src/core/index';
import { createEngine, mockPlanner } from '../src/core/server';
import { alice, call, client, message, ok, say, SECRET, setup } from './fixtures';

const el = (ref: string, role: string, name: string, extra: Partial<PageElement> = {}): PageElement => ({
  ref,
  role,
  name,
  actions: role === 'textbox' ? ['fill'] : ['click'],
  ...extra,
});

const screen = {
  text: '# Workspace\n[button e1] Delete workspace\n[textbox e2] Title: (empty)\n[link e3] Settings\n[link e4] Docs\n[button e5] Help',
  elements: [
    el('e1', 'button', 'Delete workspace'),
    el('e2', 'textbox', 'Title', { inForm: true }),
    el('e3', 'link', 'Settings', { href: '/settings' }),
    el('e4', 'link', 'Docs', { href: 'https://docs.example', external: true }),
    el('e5', 'button', 'Help', { risk: 'read' }),
    el('e6', 'button', 'Wipe everything', { risk: 'never' }),
  ],
};
const onPage = (extra = {}) => client({ route: '/workspace', page: screen, ...extra });
const approve = (state: string, grantId: string) =>
  ({ type: 'approve', state, grantId, approved: true, trusted: true, client: onPage() }) as const;

describe('page vision', () => {
  it('shows the model the screen as untrusted content, and offers page_act', async () => {
    const { engine, plannerCalls } = setup([say('ok')]);
    ok(await engine.handle(message('what is here?', undefined, onPage()), alice));
    const input = plannerCalls[0]!;
    expect(input.instructions).toContain('What the user sees on screen');
    expect(input.instructions).toContain('<untrusted># Workspace');
    expect(input.tools.map((t) => t.name)).toContain('page_act');
  });

  it('can be turned off by the developer', async () => {
    const { engine, plannerCalls } = setup([say('ok')], { see: { page: false }, act: { elements: false } });
    ok(await engine.handle(message('what is here?', undefined, onPage()), alice));
    expect(plannerCalls[0]!.instructions).not.toContain('What the user sees');
    expect(plannerCalls[0]!.tools.map((t) => t.name)).not.toContain('page_act');
    expect((await engine.manifest(alice)).settings).toEqual({ page: false, elements: 'none' });
  });
});

describe('page_act policy', () => {
  it('types into fields without a confirm card (local and visible)', async () => {
    const { engine } = setup([call('page_act', { ref: 'e2', action: 'fill', value: 'Q4 plan' }, 'f1')]);
    const res = ok(await engine.handle(message('fill title with Q4 plan', undefined, onPage()), alice));
    expect(res.pending).toEqual({
      type: 'dispatch',
      toolCallId: 'f1',
      kind: 'element',
      target: 'e2',
      args: { ref: 'e2', action: 'fill', value: 'Q4 plan', role: 'textbox', name: 'Title', context: undefined },
    });
  });

  it('confirms unannotated clicks, showing exactly what will be clicked', async () => {
    const { engine } = setup([call('page_act', { ref: 'e1', action: 'click' }, 'c1'), say('Deleted.')]);
    const staged = ok(await engine.handle(message('click delete workspace', undefined, onPage()), alice));
    if (staged.pending?.type !== 'confirm') throw new Error('expected confirm');
    expect(staged.pending.view.title).toBe('Click “Delete workspace”');
    expect(staged.pending.view.fields).toContainEqual({ label: 'Element', value: 'button “Delete workspace”', untrusted: true });

    const approved = ok(await engine.handle(approve(staged.state, staged.pending.grantId), alice));
    expect(approved.pending).toMatchObject({ type: 'dispatch', kind: 'element', target: 'e1', grant: staged.pending.grantId });
    const replay = ok(await engine.handle(approve(staged.state, staged.pending.grantId), alice));
    expect(replay.pending?.type).not.toBe('dispatch'); // single use

    const done = ok(
      await engine.handle({ type: 'receipt', state: approved.state, toolCallId: 'c1', receipt: { status: 'ok', message: 'Clicked.' }, client: onPage() }, alice),
    );
    expect(done.done).toBe(true);
  });

  it('follows internal links freely, confirms external ones, honors data-saydo-risk', async () => {
    const internal = setup([call('page_act', { ref: 'e3', action: 'click' })]);
    expect(ok(await internal.engine.handle(message('open settings', undefined, onPage()), alice)).pending?.type).toBe('dispatch');
    const external = setup([call('page_act', { ref: 'e4', action: 'click' })]);
    expect(ok(await external.engine.handle(message('open docs', undefined, onPage()), alice)).pending?.type).toBe('confirm');
    const help = setup([call('page_act', { ref: 'e5', action: 'click' })]);
    expect(ok(await help.engine.handle(message('help', undefined, onPage()), alice)).pending?.type).toBe('dispatch');
    const never = setup([call('page_act', { ref: 'e6', action: 'click' }), say('You must do that yourself.')]);
    const res = ok(await never.engine.handle(message('wipe', undefined, onPage()), alice));
    expect(res.pending).toBeUndefined();
    expect(res.events.find((e) => e.type === 'action')).toMatchObject({ status: 'denied' });
  });

  it('lets the developer make every click free (full freedom) or stricter', async () => {
    const free = setup([call('page_act', { ref: 'e1', action: 'click' })], { act: { defaultRisk: 'read' } });
    expect(ok(await free.engine.handle(message('x', undefined, onPage()), alice)).pending?.type).toBe('dispatch');
    const strict = setup([call('page_act', { ref: 'e2', action: 'fill', value: 'x' }), say('no')], { act: { elements: false } });
    const res = ok(await strict.engine.handle(message('x', undefined, onPage()), alice));
    expect(res.pending).toBeUndefined();
  });

  it('rejects refs that are not on the screen', async () => {
    const { engine } = setup([call('page_act', { ref: 'e99', action: 'click' }), say('Not found.')]);
    const res = ok(await engine.handle(message('click ghost', undefined, onPage()), alice));
    expect(res.events.find((e) => e.type === 'action')).toMatchObject({ status: 'not_found' });
  });

  it('mock planner understands page verbs', async () => {
    const { engine } = setup();
    const res = ok(await engine.handle(message('fill Title with Q4 plan', undefined, onPage()), alice));
    expect(res.pending).toMatchObject({ kind: 'element', args: { action: 'fill', value: 'Q4 plan' } });
  });
});

describe('tool search for large apps', () => {
  it('sends a bounded tool list and finds the rest on demand', async () => {
    const caps = Array.from({ length: 120 }, (_, i) =>
      defineCapability({ id: `area${i}.do`, describe: `Do thing number ${i} in area ${i}`, input: z.object({}), risk: 'read', handler: () => ({ result: i }) }),
    );
    const report = defineCapability({ id: 'reports.export', describe: 'Export the quarterly revenue report', input: z.object({}), risk: 'read', handler: () => ({ result: 'csv' }) });
    const seen: string[][] = [];
    const engine = createEngine({
      capabilities: [...caps, report],
      routes: [{ pattern: '/' }],
      secret: SECRET,
      maxTools: 20,
      planner: {
        name: 'spy',
        plan: async (input) => {
          seen.push(input.tools.map((t) => t.name));
          if (seen.length === 1) return { calls: [{ id: 'q', name: 'find_capability', args: { query: 'export revenue report' } }] };
          if (seen.length === 2) return { calls: [{ id: 'r', name: 'reports_export', args: {} }] };
          return { text: 'Exported.', calls: [] };
        },
      },
    });
    const res = ok(await engine.handle(message('export the revenue report'), alice));
    expect(seen[0]!.length).toBeLessThanOrEqual(25);
    expect(seen[0]).toContain('find_capability');
    expect(seen[0]).not.toContain('reports_export');
    expect(seen[1]).toContain('reports_export');
    expect(res.events.at(-1)).toEqual({ type: 'assistant', text: 'Exported.' });
  });
});

describe('entity ids for Server Actions', () => {
  it('passes the id (not the record) when declared with ref({ as: "id" })', async () => {
    const db = await import('./fixtures');
    const { app } = db.setup();
    let received: unknown;
    const archive = defineCapability({
      id: 'posts.archiveById',
      describe: 'Archive by id',
      input: z.object({ post: app.Post.ref({ as: 'id' }) }),
      risk: 'read',
      handler: ({ post }) => {
        received = post;
      },
    });
    const engine = createEngine({
      capabilities: [archive],
      routes: app.routes,
      secret: SECRET,
      planner: mockPlanner({ script: [(i) => call('posts_archiveById', { post: i.page.entities[0]!.handle }), say('ok')] }),
    });
    ok(await engine.handle(message('archive', undefined, client({ route: '/posts/p2' })), alice));
    expect(received).toBe('p2');
  });
});
