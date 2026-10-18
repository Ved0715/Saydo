import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateRegistry } from '../src/next/generate';
import { createHandler, withGrant } from '../src/core/handler';
import { scanProject } from '../src/next/scan';
import { mockPlanner } from '../src/core/server';
import { makeApp, makeDb, SECRET } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saydo-next-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function touch(file: string, content = 'export default function Page() { return null }\n') {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('App Router scanner', () => {
  touch('app/page.tsx');
  touch('app/(marketing)/pricing/page.tsx');
  touch('app/billing/page.tsx');
  touch('app/billing/nav.ts', 'export default {}');
  touch('app/billing/capabilities.ts', 'export {}');
  touch('app/posts/[id]/page.tsx');
  touch('app/posts/[id]/nav.ts', 'export default {}');
  touch('app/posts/[id]/@modal/share/page.tsx');
  touch('app/@analytics/page.tsx');
  touch('app/photos/(.)[id]/page.tsx');
  touch('app/_components/page.tsx');
  touch('app/docs/[[...slug]]/page.mdx');
  touch('app/api/ai/route.ts', 'export const POST = () => {}');
  touch('app/settings/nav.ts', 'export default {}');
  touch('capabilities/posts.ts', 'export {}');
  touch('capabilities/nested/billing.tsx', 'export {}');
  touch('capabilities/posts.test.ts', 'export {}');

  it('follows route groups, skips slots, interceptors and private folders', () => {
    const scan = scanProject(root);
    expect(scan.routes.map((r) => r.pattern)).toEqual(['/', '/billing', '/docs/[[...slug]]', '/posts/[id]', '/pricing']);
    expect(scan.routes.find((r) => r.pattern === '/billing')?.nav).toMatch(/billing[/\\]nav\.ts$/);
    expect(scan.warnings.some((w) => w.includes('settings') && w.includes('no page.tsx'))).toBe(true);
  });

  it("finds 'use server' files that define serverAction() actions", () => {
    touch('app/settings/actions.ts', "'use server';\nimport { serverAction } from 'saydo-js';\nexport const save = serverAction({ describe: 'Save', input: undefined as never }, async () => {});\n");
    touch('app/other/actions.ts', "'use server';\nexport async function plain() {}\n");
    const files = scanProject(root).capabilityFiles.map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(files).toContain('app/settings/actions.ts');
    expect(files).not.toContain('app/other/actions.ts');
    fs.rmSync(path.join(root, 'app/settings/actions.ts'));
    fs.rmSync(path.join(root, 'app/other'), { recursive: true });
  });

  it('finds capability modules but not tests', () => {
    const files = scanProject(root).capabilityFiles.map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(files).toEqual(['app/billing/capabilities.ts', 'capabilities/nested/billing.tsx', 'capabilities/posts.ts']);
  });

  it('generates a server-only registry and only rewrites it on change', () => {
    generateRegistry(root, { dev: true });
    const file = path.join(root, '.saydo/registry.ts');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain("import 'server-only';");
    expect(content).toContain("import * as cap2 from '../capabilities/posts';");
    expect(content).toContain("import nav1 from '../app/posts/[id]/nav';");
    expect(content).toContain('{ pattern: "/posts/[id]", nav: nav1 }');
    expect(content).toMatch(/devSecret: string \| undefined = "[0-9a-f]{64}"/);
    const before = fs.statSync(file).mtimeMs;
    generateRegistry(root, { dev: true });
    expect(fs.statSync(file).mtimeMs).toBe(before);
    expect(fs.readFileSync(path.join(root, '.saydo/.gitignore'), 'utf8')).toBe('*\n');
  });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://app.test/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const ctx = { route: '/', tabId: 't', mounted: [], uiActions: [] };

describe('createHandler', () => {
  const db = makeDb();
  const app = makeApp(db);
  const registry = { routes: app.routes, capabilities: app.capabilities };
  const handler = createHandler(registry, { getUser: () => ({ id: 'u1' }), advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false }, limits: { perMinute: 3 } });

  it('serves the per-user manifest and answers turns', async () => {
    const manifest = await (await handler(post({ type: 'manifest' }))).json();
    expect(manifest.routes.map((r: { pattern: string }) => r.pattern)).toContain('/billing');
    const turn = await (await handler(post({ type: 'message', text: 'take me to billing', client: ctx }))).json();
    expect(turn).toMatchObject({ ok: true, effects: [{ type: 'navigate', href: '/billing' }] });
  });

  it('rejects cross-site requests and bad bodies, and rate-limits per user', async () => {
    expect((await handler(post({ type: 'manifest' }, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await handler(post({ type: 'manifest' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await handler(post('{nope'))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await handler(post({ type: 'message', text: 'hi', client: ctx }))).status);
    expect(statuses).toContain(429);
  });

  it('fails with a fix when production config is missing', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    const secret = env.SAYDO_SECRET;
    env.NODE_ENV = 'production';
    delete process.env.SAYDO_SECRET;
    try {
      const noSecret = await (await createHandler(registry, { advanced: { planner: mockPlanner(), lockfile: false } })(post({ type: 'manifest' }))).json();
      expect(noSecret).toMatchObject({ ok: false, fix: expect.stringContaining('SAYDO_SECRET') });
      const noUser = await (await createHandler(registry, { store: 'memory', advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false } })(post({ type: 'manifest' }))).json();
      expect(noUser).toMatchObject({ ok: false, code: 'no_user', fix: expect.stringContaining("getUser: 'anonymous'") });
      const optedIn = await createHandler(registry, { store: 'memory', getUser: 'anonymous', advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false } })(post({ type: 'manifest' }));
      expect(optedIn.status).toBe(200);
      const getUser = () => ({ id: 'u1' });
      const noStore = await (await createHandler(registry, { getUser, advanced: { secret: SECRET, planner: mockPlanner(), lockfile: false } })(post({ type: 'manifest' }))).json();
      expect(noStore).toMatchObject({ ok: false, fix: expect.stringContaining('store') });
      const noModel = await (await createHandler(registry, { store: 'memory', getUser, advanced: { secret: SECRET, lockfile: false } })(post({ type: 'manifest' }))).json();
      expect(noModel).toMatchObject({ ok: false, fix: expect.stringContaining('model') });
    } finally {
      env.NODE_ENV = previous;
      if (secret) process.env.SAYDO_SECRET = secret;
    }
  });
});

describe('withGrant', () => {
  it('passes human requests through and consumes AI grants exactly once', async () => {
    const db = makeDb();
    const app = makeApp(db);
    const handler = createHandler(
      { routes: app.routes, capabilities: app.capabilities },
      { getUser: () => ({ id: 'u1' }), advanced: { secret: SECRET, lockfile: false, planner: mockPlanner({
          script: [
            (input) => ({ calls: [{ id: 'pub', name: 'posts_publish', args: { post: input.page.entities[0]!.handle } }] }),
            { text: 'Published.', calls: [] },
          ],
        }) }, limits: { perMinute: false } },
    );
    let published = 0;
    const route = withGrant(
      'posts.publish',
      async () => {
        published++;
        return Response.json({ ok: true });
      },
      { match: ({ body, args }) => (body as { id: string }).id === (args as { post: { id: string } }).post.id },
    );
    const api = (headers: Record<string, string> = {}, body: unknown = { id: 'p1' }) =>
      route(new Request('http://app.test/api/posts/p1/publish', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), {});

    expect((await api()).status).toBe(200); // a normal click in your UI
    expect(published).toBe(1);

    const client = { ...ctx, route: '/posts/p1', mounted: ['posts.publish'] };
    const staged = await (await handler(post({ type: 'message', text: 'publish it', client }))).json();
    expect(staged.pending.type).toBe('confirm');
    const approved = await (
      await handler(post({ type: 'approve', state: staged.state, grantId: staged.pending.grantId, approved: true, trusted: true, client }))
    ).json();
    expect(approved.pending).toMatchObject({ type: 'dispatch', grant: staged.pending.grantId });

    const grant = { 'x-saydo-grant': approved.pending.grant };
    expect((await api(grant, { id: 'p2' })).status).toBe(403); // not what was approved
    expect((await api(grant)).status).toBe(200);
    expect(published).toBe(2);
    expect((await api(grant)).status).toBe(410); // single use
    expect((await api({ 'x-saydo-grant': 'forged' })).status).toBe(403);
    expect(published).toBe(2);
  });
});
