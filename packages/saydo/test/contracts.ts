// Behavior every store must have. Each implementation runs the same suite.
import { describe, expect, it } from 'vitest';
import type { Grant, GrantStore, StoredThread, ThreadStore } from '../src/core/server';

export function grantStoreContract(name: string, makeStore: () => Promise<GrantStore>) {
  describe(`grant store contract: ${name}`, () => {
    const grant = (id: string, extra: Partial<Grant> = {}): Grant => ({
      id,
      kind: 'confirm',
      capabilityId: 'x',
      userId: 'u1',
      threadId: 't',
      tabId: 'tab',
      toolCallId: 'c',
      args: { a: 1 },
      tier: 2,
      state: 'staged',
      createdAt: 1000,
      expiresAt: 999_999,
      ...extra,
    });

    it('consumes a grant exactly once under concurrent approvals', async () => {
      const store = await makeStore();
      await store.create(grant('g1'));
      const results = await Promise.all(Array.from({ length: 20 }, () => store.transition('g1', 'staged', 'consumed')));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.get('g1'))?.state).toBe('consumed');
    });

    it('claims an id once, but lets an expired claim be taken over', async () => {
      const store = await makeStore();
      const claims = await Promise.all(Array.from({ length: 10 }, () => store.claim(grant('c1', { expiresAt: 5000 }))));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await store.claim(grant('c1', { createdAt: 6000, expiresAt: 9000 }))).toBe(true);
    });

    it('patches, and erases a user', async () => {
      const store = await makeStore();
      await store.create(grant('p1'));
      await store.create(grant('p2', { userId: 'u2' }));
      await store.update('p1', { outcome: { receipt: { status: 'ok' }, effects: [] }, expiresAt: 42 });
      expect(await store.get('p1')).toMatchObject({ outcome: { receipt: { status: 'ok' } }, expiresAt: 42 });
      expect(await store.deleteUser('u1')).toBe(1);
      expect(await store.get('p1')).toBeUndefined();
      expect(await store.get('p2')).toBeDefined();
    });
  });
}

export function threadStoreContract(name: string, makeStore: () => Promise<ThreadStore>) {
  describe(`thread store contract: ${name}`, () => {
    const thread = (id: string, extra: Partial<StoredThread> = {}): StoredThread => ({
      id,
      userId: 'u1',
      title: 'Plan the launch',
      createdAt: 1000,
      updatedAt: 1000,
      expiresAt: 10_000_000,
      version: 1,
      state: JSON.stringify({ history: [[1, 2], { nested: [[3]] }] }),
      ...extra,
    });

    it('creates once and round-trips the opaque state', async () => {
      const store = await makeStore();
      expect(await store.save(thread('t1'), null)).toBe(true);
      expect(await store.save(thread('t1'), null)).toBe(false);
      expect(await store.get('t1')).toEqual(thread('t1'));
      expect(await store.get('missing')).toBeUndefined();
    });

    it('saves with compare-and-set: one winner under concurrent turns', async () => {
      const store = await makeStore();
      await store.save(thread('t2'), null);
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => store.save(thread('t2', { version: 2, updatedAt: 2000 + i, title: `v2-${i}` }), 1)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.get('t2'))?.version).toBe(2);
      expect(await store.save(thread('t2', { version: 3 }), 1)).toBe(false);
      expect(await store.save(thread('t2', { version: 3, userId: 'u2' }), 2)).toBe(false);
      expect(await store.save(thread('t2', { version: 3 }), 2)).toBe(true);
    });

    it('appends the transcript in order and returns the latest entries', async () => {
      const store = await makeStore();
      await store.save(thread('t3'), null);
      await store.append('t3', 'u1', [{ at: 1, role: 'user', text: 'one' }, { at: 1, role: 'assistant', text: 'two' }], 10_000_000);
      await store.append('t3', 'u1', [{ at: 2, role: 'action', text: 'three', status: 'ok', capability: 'posts.create' }], 10_000_000);
      expect((await store.transcript('t3')).map((e) => e.text)).toEqual(['one', 'two', 'three']);
      expect(await store.transcript('t3', { limit: 2 })).toEqual([
        { at: 1, role: 'assistant', text: 'two' },
        { at: 2, role: 'action', text: 'three', status: 'ok', capability: 'posts.create' },
      ]);
    });

    it('orders the transcript by the engine’s sequence, not by clock time', async () => {
      const store = await makeStore();
      await store.save(thread('t4'), null);
      // Two instances with skewed clocks: the later entries carry an earlier timestamp.
      await store.append('t4', 'u1', [{ seq: 1, at: 5000, role: 'user', text: 'first' }], 10_000_000);
      await store.append('t4', 'u1', [{ seq: 2, at: 4000, role: 'assistant', text: 'second' }, { seq: 3, at: 4000, role: 'user', text: 'third' }], 10_000_000);
      expect((await store.transcript('t4')).map((e) => e.text)).toEqual(['first', 'second', 'third']);
    });

    it('lists a user’s conversations, newest first', async () => {
      const store = await makeStore();
      await store.save(thread('a', { updatedAt: 1 }), null);
      await store.save(thread('b', { updatedAt: 3, title: 'Newest' }), null);
      await store.save(thread('c', { updatedAt: 2 }), null);
      await store.save(thread('d', { userId: 'u2', updatedAt: 9 }), null);
      expect((await store.list('u1')).map((t) => t.id)).toEqual(['b', 'c', 'a']);
      expect(await store.list('u1', { limit: 1 })).toEqual([{ id: 'b', title: 'Newest', createdAt: 1000, updatedAt: 3 }]);
    });

    it('deletes a conversation with its transcript, and erases a user', async () => {
      const store = await makeStore();
      await store.save(thread('x'), null);
      await store.append('x', 'u1', [{ at: 1, role: 'user', text: 'secret' }], 10_000_000);
      await store.save(thread('y'), null);
      await store.save(thread('z', { userId: 'u2' }), null);
      await store.delete('x');
      expect(await store.get('x')).toBeUndefined();
      expect(await store.transcript('x')).toEqual([]);
      expect(await store.deleteUser('u1')).toBe(1);
      expect(await store.get('y')).toBeUndefined();
      expect(await store.get('z')).toBeDefined();
    });
  });
}
