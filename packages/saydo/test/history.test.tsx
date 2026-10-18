// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandler } from '../src/core/handler';
import { memoryThreadStore, mockPlanner } from '../src/core/server';
import { SaydoProvider } from '../src/react/index';
import { alice, makeApp, makeDb, say, SECRET } from './fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function app(threads = true) {
  const db = makeDb();
  const { routes, capabilities } = makeApp(db);
  const handler = createHandler(
    { routes, capabilities },
    {
      secret: SECRET,
      planner: mockPlanner({ script: [say('First answer.'), say('Second answer.')] }),
      getUser: () => alice,
      rateLimit: false,
      lockfile: false,
      store: 'memory',
      threads: threads ? memoryThreadStore() : undefined,
    },
  );
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) =>
    handler(new Request('https://app.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: init?.body })),
  );
  return render(
    <SaydoProvider router={{ push: () => {} }} pathname="/">
      <p>app</p>
    </SaydoProvider>,
  );
}

async function ask(text: string) {
  const input = await screen.findByRole('combobox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('conversation history UI', () => {
  it('lists earlier conversations and resumes one', async () => {
    app();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await ask('plan the launch');
    expect(await screen.findByText('First answer.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    // Even if the reply was still streaming, nothing from it lands in the new conversation.
    expect(screen.queryByText('First answer.')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('First answer.')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'History' }));
    const entry = await screen.findByText('plan the launch');
    fireEvent.click(entry);
    await waitFor(() => expect(screen.getByText('First answer.')).toBeTruthy());

    await ask('and then?');
    expect(await screen.findByText('Second answer.')).toBeTruthy();
  });

  it('deletes a conversation from the list', async () => {
    app();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await ask('throwaway chat');
    await screen.findByText('First answer.');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation: throwaway chat' }));
    await waitFor(() => expect(screen.queryByText('throwaway chat')).toBeNull());
    expect(screen.getByText('No earlier conversations yet.')).toBeTruthy();
  });

  it('shows no History button when conversations stay in the browser', async () => {
    app(false);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await ask('hello');
    await screen.findByText('First answer.');
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
  });
});
