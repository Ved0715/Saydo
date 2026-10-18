import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { firestoreGrantStore, firestoreThreadStore, memoryThreadStore, postgresThreadStore, type FirestoreLike } from '../src/core/server';
import { grantStoreContract, threadStoreContract } from './contracts';
import { fakeFirestore } from './firestore-fake';

// Compile-time proof that the real Firestore SDK satisfies the interface the stores use.
const _real: (db: Firestore) => FirestoreLike = (db) => db;
void _real;

threadStoreContract('memory', async () => memoryThreadStore());
threadStoreContract('postgres (PGlite)', async () => {
  const db = new PGlite();
  const store = postgresThreadStore({ query: (text, params) => db.query(text, params) as never });
  await store.migrate();
  return store;
});
threadStoreContract('firestore (in-memory fake)', async () => firestoreThreadStore(fakeFirestore()));
grantStoreContract('firestore (in-memory fake)', async () => firestoreGrantStore(fakeFirestore()));

// Real Firestore: `firebase emulators:exec --only firestore "pnpm vitest run packages/saydo/test/stores.test.ts"` (CI does this).
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator) {
  const realDb = async () => {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = getApps()[0] ?? initializeApp({ projectId: 'demo-saydo' });
    const db = getFirestore(app);
    await fetch(`http://${emulator}/emulator/v1/projects/demo-saydo/databases/(default)/documents`, { method: 'DELETE' });
    return db;
  };
  threadStoreContract('firestore (emulator)', async () => firestoreThreadStore(await realDb(), { collection: `threads_${Date.now()}_${Math.random().toString(36).slice(2)}` }));
  grantStoreContract('firestore (emulator)', async () => firestoreGrantStore(await realDb(), { collection: `grants_${Date.now()}_${Math.random().toString(36).slice(2)}` }));
}

describe('firestore stores', () => {
  it('encode ids that contain slashes, and store expiry for TTL policies', async () => {
    const db = fakeFirestore();
    const grants = firestoreGrantStore(db);
    await grants.create({
      id: 'req:auth0/123:abc',
      kind: 'request',
      capabilityId: '',
      userId: 'auth0/123',
      threadId: '',
      tabId: '',
      toolCallId: '',
      args: null,
      tier: 0,
      state: 'staged',
      createdAt: 1,
      expiresAt: 5000,
    });
    expect((await grants.get('req:auth0/123:abc'))?.userId).toBe('auth0/123');
    const snap = await db.collection('saydo_grants').doc(encodeURIComponent('req:auth0/123:abc')).get();
    expect(snap.data()!.expireAt).toBeInstanceOf(Date);
    expect(await grants.deleteUser('auth0/123')).toBe(1);
  });

  it('keep transcript lines as separate documents (no growing hot document)', async () => {
    const db = fakeFirestore();
    const threads = firestoreThreadStore(db);
    await threads.save({ id: 't', userId: 'u', title: 'x', createdAt: 1, updatedAt: 1, expiresAt: 10, version: 1, state: '{}' }, null);
    await threads.append('t', 'u', Array.from({ length: 5 }, (_, i) => ({ at: i, role: 'user' as const, text: String(i) })), 10);
    expect(db.size()).toBe(6);
    const thread = await db.collection('saydo_threads').doc('t').get();
    expect(JSON.stringify(thread.data()).length).toBeLessThan(300);
  });
});
