import type { Grant, GrantPatch, GrantState, GrantStore } from './grants';
import type { StoredThread, ThreadStore } from './threads';
import type { ThreadSummary, TranscriptEntry } from './protocol';

// The part of the Firestore server SDK (firebase-admin / @google-cloud/firestore) these stores use.
// Pass `getFirestore()`; no Firebase package is imported by Saydo itself.
export interface FirestoreLike {
  collection(path: string): FsCollection;
  runTransaction<T>(fn: (tx: FsTransaction) => Promise<T>): Promise<T>;
  batch(): FsBatch;
  recursiveDelete?(ref: unknown): Promise<void>;
}
export interface FsQuery {
  where(field: string, op: '==', value: unknown): FsQuery;
  orderBy(field: string, direction?: 'asc' | 'desc'): FsQuery;
  limit(n: number): FsQuery;
  get(): Promise<{ docs: FsDocSnapshot[] }>;
}
export interface FsCollection extends FsQuery {
  doc(id?: string): FsDocRef;
}
export interface FsDocRef {
  readonly id: string;
  get(): Promise<FsDocSnapshot>;
  set(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  collection(path: string): FsCollection;
}
export interface FsDocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  readonly ref: FsDocRef;
  data(): Record<string, unknown> | undefined;
}
export interface FsTransaction {
  get(ref: FsDocRef): Promise<FsDocSnapshot>;
  set(ref: FsDocRef, data: Record<string, unknown>): unknown;
  update(ref: FsDocRef, data: Record<string, unknown>): unknown;
}
export interface FsBatch {
  set(ref: FsDocRef, data: Record<string, unknown>): unknown;
  delete(ref: FsDocRef): unknown;
  commit(): Promise<unknown>;
}

// Document ids cannot contain '/'; grant ids embed user ids, which might.
const docId = (id: string) => encodeURIComponent(id);
const GRACE = 60 * 60_000;

async function deleteAll(db: FirestoreLike, refs: FsDocRef[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}

/**
 * Durable approvals on Firestore. Claims, transitions and updates run in
 * transactions, so a grant is consumed exactly once across any number of
 * server instances. Enable a TTL policy on `expireAt` and old grants delete
 * themselves.
 *
 *   store: firestoreGrantStore(getFirestore())
 */
export function firestoreGrantStore(db: FirestoreLike, options: { collection?: string } = {}) {
  const col = () => db.collection(options.collection ?? 'saydo_grants');
  const ref = (id: string) => col().doc(docId(id));
  const fields = (grant: Grant) => ({
    userId: grant.userId,
    state: grant.state,
    expiresAt: grant.expiresAt,
    expireAt: new Date(grant.expiresAt + GRACE),
    data: JSON.stringify(grant),
  });
  const parse = (snap: FsDocSnapshot): Grant | undefined => {
    if (!snap.exists) return undefined;
    const raw = snap.data()!;
    return { ...(JSON.parse(String(raw.data)) as Grant), state: raw.state as GrantState };
  };
  const store = {
    durable: true as const,
    async create(grant: Grant) {
      await ref(grant.id).set(fields(grant));
    },
    async claim(grant: Grant) {
      return db.runTransaction(async (tx) => {
        const target = ref(grant.id);
        const existing = parse(await tx.get(target));
        // Expired claims may be taken over; live ones never.
        if (existing && existing.expiresAt >= grant.createdAt) return false;
        tx.set(target, fields(grant));
        return true;
      });
    },
    async get(id: string) {
      return parse(await ref(id).get());
    },
    async transition(id: string, from: GrantState, to: GrantState) {
      return db.runTransaction(async (tx) => {
        const target = ref(id);
        const grant = parse(await tx.get(target));
        if (!grant || grant.state !== from) return undefined;
        const next = { ...grant, state: to };
        tx.update(target, { state: to, data: JSON.stringify(next) });
        return next;
      });
    },
    async update(id: string, patch: GrantPatch) {
      await db.runTransaction(async (tx) => {
        const target = ref(id);
        const grant = parse(await tx.get(target));
        if (!grant) return;
        tx.update(target, fields({ ...grant, ...patch }));
      });
    },
    async deleteUser(userId: string) {
      const { docs } = await col().where('userId', '==', userId).get();
      await deleteAll(db, docs.map((d) => d.ref));
      return docs.length;
    },
  };
  return store satisfies GrantStore;
}

/**
 * Conversations on Firestore: one document per conversation (written once per
 * request, well under Firestore's per-document write rate) and an `entries`
 * subcollection with one document per transcript line, so history never becomes
 * a growing hot document. Saves are transactional compare-and-set.
 *
 *   threads: firestoreThreadStore(getFirestore())
 *
 * Listing needs one composite index: collection `saydo_threads`, fields
 * `userId ASC, updatedAt DESC`. TTL policies on `expireAt` (collection
 * `saydo_threads` and collection group `entries`) delete expired data.
 */
export function firestoreThreadStore(db: FirestoreLike, options: { collection?: string } = {}) {
  const col = () => db.collection(options.collection ?? 'saydo_threads');
  const ref = (id: string) => col().doc(docId(id));
  let counter = 0;
  const toThread = (snap: FsDocSnapshot): StoredThread | undefined => {
    if (!snap.exists) return undefined;
    const d = snap.data()!;
    return {
      id: String(d.id),
      userId: String(d.userId),
      title: String(d.title),
      version: Number(d.version),
      createdAt: Number(d.createdAt),
      updatedAt: Number(d.updatedAt),
      expiresAt: Number(d.expiresAt),
      state: String(d.state),
    };
  };
  const removeThread = async (target: FsDocRef) => {
    if (db.recursiveDelete) return db.recursiveDelete(target);
    const { docs } = await target.collection('entries').get();
    await deleteAll(db, [...docs.map((d) => d.ref), target]);
  };
  const store = {
    durable: true as const,
    async get(id: string) {
      return toThread(await ref(id).get());
    },
    async save(thread: StoredThread, expected: number | null) {
      return db.runTransaction(async (tx) => {
        const target = ref(thread.id);
        const current = toThread(await tx.get(target));
        if (expected === null ? current !== undefined : current?.version !== expected || current.userId !== thread.userId) return false;
        tx.set(target, { ...thread, expireAt: new Date(thread.expiresAt) });
        return true;
      });
    },
    async append(threadId: string, userId: string, entries: TranscriptEntry[], expiresAt: number) {
      if (!entries.length) return;
      const target = ref(threadId).collection('entries');
      const batch = db.batch();
      for (const entry of entries) {
        counter = (counter + 1) % 1000;
        // The engine numbers entries per conversation; the timestamp form is only for other callers.
        batch.set(target.doc(), { seq: entry.seq ?? entry.at * 1000 + counter, userId, entry: JSON.stringify(entry), expireAt: new Date(expiresAt) });
      }
      await batch.commit();
    },
    async transcript(threadId: string, opts: { limit?: number } = {}) {
      const { docs } = await ref(threadId).collection('entries').orderBy('seq', 'desc').limit(opts.limit ?? 100).get();
      return docs.map((d) => JSON.parse(String(d.data()!.entry)) as TranscriptEntry).reverse();
    },
    async list(userId: string, opts: { limit?: number } = {}) {
      try {
        const { docs } = await col().where('userId', '==', userId).orderBy('updatedAt', 'desc').limit(opts.limit ?? 20).get();
        return docs.map((d) => {
          const t = toThread(d)!;
          return { id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt } satisfies ThreadSummary;
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === 9) {
          console.error('[saydo] Listing conversations needs a Firestore index on saydo_threads (userId ASC, updatedAt DESC). Open the link in the error below to create it.');
        }
        throw error;
      }
    },
    async delete(id: string) {
      await removeThread(ref(id));
    },
    async deleteUser(userId: string) {
      const { docs } = await col().where('userId', '==', userId).get();
      for (const doc of docs) await removeThread(doc.ref);
      return docs.length;
    },
  };
  return store satisfies ThreadStore;
}
