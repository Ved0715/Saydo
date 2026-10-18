// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaydo, type SaydoClient } from '../src/dom';
import { alice, call, setup } from './fixtures';
import type { Engine } from '../src/core/server';

let client: SaydoClient | undefined;
afterEach(() => {
  client?.destroy();
  client = undefined;
});

function serverFetch(engine: Engine) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const data = body.type === 'manifest' ? await engine.manifest(alice) : await engine.handle(body, alice);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const settle = () => new Promise((r) => setTimeout(r, 10));
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;

describe('saydo/dom', () => {
  it('mounts the palette, opens with Cmd+K, and navigates from the page list', async () => {
    const { engine } = setup();
    const pushes: string[] = [];
    client = createSaydo({ fetch: serverFetch(engine), router: { push: (href) => pushes.push(href) } });
    await settle();
    expect(q('.saydo-launcher')?.textContent).toContain('Ask AI');
    expect(q('.saydo-overlay')?.hidden).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(q('.saydo-overlay')?.hidden).toBe(false);
    expect(q('.saydo-launcher')?.hidden).toBe(true);

    const input = q<HTMLInputElement>('.saydo-inputrow input')!;
    input.value = 'billing';
    input.dispatchEvent(new Event('input'));
    const option = [...document.querySelectorAll('.saydo-option')].find((o) => o.textContent?.includes('/billing')) as HTMLButtonElement;
    expect(option).toBeTruthy();
    option.click();
    await settle();
    expect(pushes).toEqual(['/billing']);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(q('.saydo-overlay')?.hidden).toBe(true);
  });

  it('renders model text as text, never HTML', async () => {
    const { engine } = setup([{ text: '<img src=x onerror="window.__pwned=1"> hello', calls: [] }]);
    client = createSaydo({ fetch: serverFetch(engine), router: { push: () => {} } });
    await client.ask('say something');
    const item = q('.saydo-assistant')!;
    expect(item.textContent).toContain('<img src=x');
    expect(item.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('shows the server-built confirm card and refuses synthetic clicks', async () => {
    const { engine, db } = setup([call('posts_create', { title: 'Launch Notes' }), { text: 'Done.', calls: [] }]);
    client = createSaydo({ fetch: serverFetch(engine), router: { push: () => {} } });
    await client.ask('start a post titled Launch Notes');
    const card = q('.saydo-confirm')!;
    expect(card.textContent).toContain('Launch Notes');
    const approve = card.querySelector('button.primary') as HTMLButtonElement;
    approve.click(); // untrusted
    await settle();
    expect(q('.saydo-confirm .saydo-error')?.textContent).toMatch(/real click/);
    expect([...db.posts.values()].some((p) => p.title === 'Launch Notes')).toBe(false);
    (card.querySelector('.saydo-actions button:not(.primary)') as HTMLButtonElement).click();
    await settle();
    expect(q('.saydo-confirm')).toBeNull();
  });

  it('registers UI actions, context and guards for the assistant', async () => {
    const { engine, plannerCalls } = setup([{ text: 'ok', calls: [] }]);
    client = createSaydo({ fetch: serverFetch(engine), router: { push: () => {} }, ui: false });
    const run = vi.fn();
    const off = client.action('theme.toggle', 'Switch between light and dark mode', run);
    const offContext = client.context('cart', { items: 2 });
    client.guard('Unsaved draft');
    await client.ask('hi');
    const tools = plannerCalls[0]!.tools.map((t) => t.name);
    expect(tools).toContain('ui_theme_toggle');
    expect(JSON.stringify(plannerCalls[0]!.instructions)).toContain('cart');
    off();
    offContext();
    expect(q('.saydo-root')).toBeNull();
  });

  it('keeps client caches in sync: onInvalidate and a DOM event after AI writes', async () => {
    const { engine, db } = setup([call('posts_archive', { post: 'post#1' }), { text: 'Archived.', calls: [] }]);
    const onInvalidate = vi.fn();
    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('saydo:invalidate', listener);
    client = createSaydo({ fetch: serverFetch(engine), router: { push: () => {}, refresh: () => {} }, ui: false, onInvalidate });
    client.navigated('/posts/p2');
    await client.ask('archive this post');
    window.removeEventListener('saydo:invalidate', listener);
    expect(db.posts.get('p2')!.archived).toBe(true);
    expect(onInvalidate).toHaveBeenCalledWith(undefined);
    expect(events).toEqual([{ keys: undefined }]);
  });

  it('answers declared phrases and "undo" instantly, without calling the server', async () => {
    const { engine, db } = setup([call('posts_archive', { post: 'post#1' }), { text: 'Archived.', calls: [] }]);
    const fetchImpl = serverFetch(engine);
    client = createSaydo({ fetch: fetchImpl, router: { push: () => {} }, ui: false });
    await new Promise((r) => setTimeout(r, 10));
    const toggled = vi.fn(() => ({ message: 'Dark mode on.' }));
    client.action('theme.dark', 'Switch to dark mode', toggled, { phrases: ['dark mode', 'turn on dark mode'] });
    const before = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await client.ask('Dark mode, please!');
    expect(toggled).toHaveBeenCalledTimes(1);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
    expect(client.getSnapshot().items.at(-1)).toMatchObject({ role: 'assistant', text: 'Dark mode on.' });

    client.navigated('/posts/p2');
    await client.ask('archive this post');
    expect(db.posts.get('p2')!.archived).toBe(true);
    await client.ask('undo that');
    expect(db.posts.get('p2')!.archived).toBe(false);
  });

  it('destroy removes the UI and listeners', async () => {
    const { engine } = setup();
    client = createSaydo({ fetch: serverFetch(engine), router: { push: () => {} } });
    expect(q('.saydo-root')).not.toBeNull();
    client.destroy();
    client = undefined;
    expect(q('.saydo-root')).toBeNull();
  });
});
