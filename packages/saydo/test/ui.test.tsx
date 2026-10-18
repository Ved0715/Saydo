// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaydoProvider, useAction, useSaydo } from '../src/react/index';
import { alice, setup } from './fixtures';

afterEach(cleanup);

function stubServer() {
  const ctx = setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const data = body.type === 'manifest' ? await ctx.engine.manifest(alice) : await ctx.engine.handle(body, alice);
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    }),
  );
  return ctx;
}

function SharePage() {
  const [open, setOpen] = useState(false);
  useAction('share.open', 'Open the share dialog for this post', () => setOpen(true));
  return <main><h1>Post</h1>{open && <div role="dialog" aria-label="Share">Share dialog</div>}</main>;
}

function Opener() {
  const nav = useSaydo();
  return <button onClick={() => nav.setOpen(true)}>open assistant</button>;
}

describe('SaydoProvider', () => {
  it('opens with Cmd+K, lists pages, and runs a UI action under StrictMode', async () => {
    stubServer();
    const push = vi.fn();
    render(
      <StrictMode>
        <SaydoProvider router={{ push }} pathname="/posts/p1">
          <SharePage />
        </SaydoProvider>
      </StrictMode>,
    );
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: /Billing/ });

    fireEvent.change(input, { target: { value: 'open the share dialog' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('dialog', { name: 'Share' });
  });

  it('refuses approvals from synthetic (untrusted) clicks', async () => {
    const { db } = stubServer();
    render(
      <SaydoProvider router={{ push: vi.fn() }} pathname="/billing">
        <Opener />
      </SaydoProvider>,
    );
    fireEvent.click(screen.getByText('open assistant'));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'start a new post titled Launch Notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const confirm = await screen.findByRole('button', { name: 'Confirm' });
    expect(screen.getByText('Launch Notes')).toBeTruthy();

    // fireEvent dispatches a script-generated event: isTrusted === false.
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/real click/));
    expect([...db.posts.values()].some((p) => p.title === 'Launch Notes')).toBe(false);
  });
});
