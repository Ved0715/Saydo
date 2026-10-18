// An in-memory stand-in for the Firestore server SDK, faithful where Saydo's stores depend on it:
// transactions retry on conflicting writes, reads interleave across awaits, `undefined` values are
// rejected, `update` on a missing document fails, and queries see direct children only.
// The same contract tests also run against the real emulator when FIRESTORE_EMULATOR_HOST is set.
import type { FirestoreLike, FsBatch, FsCollection, FsDocRef, FsDocSnapshot, FsQuery, FsTransaction } from '../src/core/firestore';

type Row = { data: Record<string, unknown>; version: number };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function check(data: Record<string, unknown>, path: string) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${key}" of ${path}).`);
  }
}

export function fakeFirestore(): FirestoreLike & { size(): number } {
  const rows = new Map<string, Row>();
  let seq = 0;

  const snapshot = (ref: FsDocRef & { path: string }): FsDocSnapshot => {
    const row = rows.get(ref.path);
    return { exists: !!row, id: ref.id, ref, data: () => (row ? structuredClone(row.data) : undefined) };
  };

  const write = (path: string, data: Record<string, unknown>) => {
    check(data, path);
    rows.set(path, { data: structuredClone(data), version: (rows.get(path)?.version ?? 0) + 1 });
  };

  function docRef(path: string): FsDocRef & { path: string } {
    const id = path.split('/').at(-1)!;
    const ref = {
      id,
      path,
      async get() {
        await tick();
        return snapshot(ref);
      },
      async set(data: Record<string, unknown>) {
        await tick();
        write(path, data);
      },
      async delete() {
        await tick();
        rows.delete(path);
      },
      collection: (sub: string) => collection(`${path}/${sub}`),
    };
    return ref;
  }

  function query(path: string, filters: [string, unknown][] = [], order?: [string, 'asc' | 'desc'], max?: number): FsQuery {
    return {
      where: (field, _op, value) => query(path, [...filters, [field, value]], order, max),
      orderBy: (field, direction = 'asc') => query(path, filters, [field, direction], max),
      limit: (n) => query(path, filters, order, n),
      async get() {
        await tick();
        const depth = path.split('/').length + 1;
        let docs = [...rows.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === depth)
          .filter(([, row]) => filters.every(([field, value]) => row.data[field] === value))
          .map(([key]) => snapshot(docRef(key)));
        if (order) {
          const [field, direction] = order;
          docs.sort((a, b) => {
            const x = a.data()![field] as number;
            const y = b.data()![field] as number;
            return direction === 'asc' ? x - y : y - x;
          });
        }
        if (max !== undefined) docs = docs.slice(0, max);
        return { docs };
      },
    };
  }

  function collection(path: string): FsCollection {
    return { ...query(path), doc: (id?: string) => docRef(`${path}/${id ?? `auto${++seq}`}`) };
  }

  return {
    size: () => rows.size,
    collection,
    batch(): FsBatch {
      const ops: (() => void)[] = [];
      return {
        set: (ref, data) => ops.push(() => write((ref as FsDocRef & { path: string }).path, data)),
        delete: (ref) => ops.push(() => rows.delete((ref as FsDocRef & { path: string }).path)),
        async commit() {
          await tick();
          for (const op of ops) op();
        },
      };
    },
    async runTransaction<T>(fn: (tx: FsTransaction) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: (() => void)[] = [];
        const tx: FsTransaction = {
          async get(ref) {
            await tick();
            const path = (ref as FsDocRef & { path: string }).path;
            reads.set(path, rows.get(path)?.version ?? 0);
            return snapshot(ref as FsDocRef & { path: string });
          },
          set(ref, data) {
            const path = (ref as FsDocRef & { path: string }).path;
            check(data, path);
            writes.push(() => write(path, data));
          },
          update(ref, data) {
            const path = (ref as FsDocRef & { path: string }).path;
            check(data, path);
            writes.push(() => {
              const row = rows.get(path);
              if (!row) throw Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
              write(path, { ...row.data, ...data });
            });
          },
        };
        const result = await fn(tx);
        await tick();
        // Commit atomically only if nothing this transaction read has changed since.
        if ([...reads].every(([path, version]) => (rows.get(path)?.version ?? 0) === version)) {
          for (const w of writes) w();
          return result;
        }
      }
      throw Object.assign(new Error('Transaction contention: too many retries.'), { code: 10 });
    },
    async recursiveDelete(ref) {
      const path = (ref as FsDocRef & { path: string }).path;
      for (const key of [...rows.keys()]) if (key === path || key.startsWith(`${path}/`)) rows.delete(key);
    },
  };
}
