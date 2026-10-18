import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/core/handler';
import { memoryPasskeyStore, webauthn, type AuditEntry, type PasskeyStore } from '../src/core/server';
import { fromBase64Url, toBase64Url } from '../src/core/webauthn';
import { alice, bob, call, client, message, ok, say, SECRET, setup } from './fixtures';

const approve = (state: string, grantId: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'approve', state, grantId, approved: true, trusted: true, client: client(), ...extra }) as const;

describe('one card for several actions', () => {
  it('folds consecutive gated actions of one step into a single approval', async () => {
    const { engine, db } = setup([
      (i) => ({
        calls: [
          { id: 'a', name: 'posts_create', args: { title: 'One' } },
          { id: 'b', name: 'posts_create', args: { title: 'Two' } },
          { id: 'c', name: 'posts_delete', args: { posts: [i.page.entities[0]!.handle] } },
        ],
      }),
      say('All done.'),
    ]);
    const ctx = client({ route: '/posts/p2' });
    const staged = ok(await engine.handle(message('make two posts and delete this one', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm') throw new Error('expected one card');
    expect(staged.pending.batch).toHaveLength(3);
    expect(staged.pending.view).toMatchObject({ title: 'Approve 3 actions', danger: true, confirmLabel: 'Approve all' });
    expect(db.posts.has('p2')).toBe(true);

    const done = ok(await engine.handle({ ...approve(staged.state, staged.pending.grantId), client: ctx }, alice));
    const titles = [...db.posts.values()].map((p) => p.title);
    expect(titles).toEqual(expect.arrayContaining(['One', 'Two']));
    expect(db.posts.has('p2')).toBe(false);
    expect(done.events.filter((e) => e.type === 'action')).toHaveLength(3);
  });

  it('declining the card declines every action in it', async () => {
    const { engine, db } = setup([
      { calls: [{ id: 'a', name: 'posts_create', args: { title: 'One' } }, { id: 'b', name: 'posts_create', args: { title: 'Two' } }] },
      say('Okay.'),
    ]);
    const staged = ok(await engine.handle(message('two posts'), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    const res = ok(await engine.handle({ ...approve(staged.state, staged.pending.grantId), approved: false }, alice));
    expect([...db.posts.values()].some((p) => p.title === 'One' || p.title === 'Two')).toBe(false);
    expect(res.events.filter((e) => e.type === 'action' && e.status === 'denied')).toHaveLength(2);
  });

  it('keeps order: a read between gated actions ends the group', async () => {
    const { engine } = setup([
      {
        calls: [
          { id: 'a', name: 'posts_create', args: { title: 'One' } },
          { id: 'b', name: 'posts_count', args: {} },
          { id: 'c', name: 'posts_create', args: { title: 'Two' } },
        ],
      },
      say('ok'),
    ]);
    const first = ok(await engine.handle(message('go'), alice));
    if (first.pending?.type !== 'confirm') throw new Error();
    expect(first.pending.batch).toBeUndefined();
    const second = ok(await engine.handle(approve(first.state, first.pending.grantId), alice));
    expect(second.pending?.type).toBe('confirm'); // the second create gets its own card, after the read ran
  });
});

describe('confirmation budget', () => {
  it('requires step-up once a request has asked for too many confirmations', async () => {
    const { engine } = setup([call('posts_create', { title: '1' }, 'x1'), call('posts_create', { title: '2' }, 'x2'), call('posts_create', { title: '3' }, 'x3'), say('ok')], {
      confirmBudget: 2,
    });
    let res = ok(await engine.handle(message('make three posts one by one'), alice));
    const views: Array<string | undefined> = [];
    while (res.pending?.type === 'confirm') {
      views.push(res.pending.view.requireTyped);
      res = ok(await engine.handle(approve(res.state, res.pending.grantId, { typed: res.pending.view.requireTyped }), alice));
    }
    expect(views).toEqual([undefined, undefined, 'confirm']);
  });
});

// ---------------------------------------------------------------- passkeys

const RP_ID = 'app.test';
const ORIGIN = 'https://app.test';
const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0]! & 0x80) v = Uint8Array.from([0, ...v]);
    return Uint8Array.from([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

/** A software authenticator producing genuine WebAuthn ES256 signatures. */
async function authenticator() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const rpHash = await sha256(encoder.encode(RP_ID));
  let counter = 0;
  const authData = (flags: number, count: number) => {
    const out = new Uint8Array(37);
    out.set(rpHash, 0);
    out[32] = flags;
    new DataView(out.buffer).setUint32(33, count, false);
    return out;
  };
  const clientData = (type: string, challenge: string, origin: string) => encoder.encode(JSON.stringify({ type, challenge, origin }));
  return {
    id,
    register(challenge: string) {
      return {
        id,
        response: {
          clientDataJSON: toBase64Url(clientData('webauthn.create', challenge, ORIGIN)),
          authenticatorData: toBase64Url(authData(0x45, 0)),
          publicKey: toBase64Url(spki),
          publicKeyAlgorithm: -7,
        },
      };
    },
    async assert(challenge: string, options: { flags?: number; origin?: string; count?: number } = {}) {
      const data = authData(options.flags ?? 0x05, options.count ?? ++counter);
      const cd = clientData('webauthn.get', challenge, options.origin ?? ORIGIN);
      const signed = new Uint8Array([...data, ...(await sha256(cd))]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
      return {
        id,
        response: { clientDataJSON: toBase64Url(cd), authenticatorData: toBase64Url(data), signature: toBase64Url(rawToDer(raw)) },
      };
    },
  };
}

async function registerThroughHandler(passkeys: PasskeyStore, user: { id: string }, allow = true) {
  const stepUp = webauthn({ rpId: RP_ID, origins: ORIGIN, passkeys, allowRegistration: () => allow });
  const handler = createHandler({ routes: [{ pattern: '/' }], capabilities: [] }, { getUser: () => user, advanced: { secret: SECRET, lockfile: false, planner: { name: 'x', plan: async () => ({ calls: [] }) } }, limits: { perMinute: false }, act: { stepUp } });
  const post = async (body: unknown) =>
    (await handler(new Request('http://app.test/api/saydo', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.test' }, body: JSON.stringify(body) }))).json();
  const device = await authenticator();
  const start = await post({ type: 'passkey-options' });
  if (!start.ok) return { start, device, post };
  const registered = await post({ type: 'passkey-register', token: start.token, credential: device.register(start.publicKey.challenge), name: 'Laptop' });
  return { start, registered, device, post, stepUp };
}

describe('passkey step-up (WebAuthn)', () => {
  it('registers a passkey only when allowed, with a single-use challenge', async () => {
    const passkeys = memoryPasskeyStore();
    const denied = await registerThroughHandler(passkeys, alice, false);
    expect(denied.start).toMatchObject({ ok: false, status: 'forbidden' });

    const { start, registered, device, post } = await registerThroughHandler(passkeys, alice);
    expect(registered).toMatchObject({ ok: true, passkey: { id: device.id, name: 'Laptop' } });
    expect((await passkeys.list(alice.id)).map((k) => k.id)).toEqual([device.id]);
    const again = await post({ type: 'passkey-register', token: start.token, credential: device.register(start.publicKey.challenge) });
    expect(again).toMatchObject({ ok: false });
  });

  it('requires a valid passkey assertion for step-up approvals, and rejects every forgery', async () => {
    const passkeys = memoryPasskeyStore();
    const { device, stepUp } = await registerThroughHandler(passkeys, alice);
    const audit: AuditEntry[] = [];
    const run = () =>
      setup([(i) => call('posts_delete', { posts: [i.page.entities[0]!.handle] }), say('Deleted.')], { stepUp: { ...stepUp!, when: 'destructive' }, audit: (e) => audit.push(e) });
    const ctx = client({ route: '/posts/p2' });

    const { engine, db } = run();
    const staged = ok(await engine.handle(message('delete this', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm' || !staged.pending.stepUp) throw new Error('expected a passkey challenge');
    expect(staged.pending.view.requireTyped).toBeUndefined();
    const challenge = staged.pending.stepUp.challenge;
    const grantId = staged.pending.grantId;
    const tryApprove = (proof: unknown) => engine.handle({ ...approve(staged.state, grantId), client: ctx, proof }, alice);

    expect(await tryApprove(undefined)).toMatchObject({ ok: false, code: 'step_up_required' });
    expect(await tryApprove(await device.assert(challenge, { origin: 'https://evil.test' }))).toMatchObject({ ok: false, code: 'step_up_failed' });
    expect(await tryApprove(await device.assert(challenge, { flags: 0x01 }))).toMatchObject({ ok: false, code: 'step_up_failed' }); // no user verification
    expect(await tryApprove(await device.assert('another-challenge'))).toMatchObject({ ok: false, code: 'step_up_failed' });
    expect(db.posts.has('p2')).toBe(true);

    const good = ok(await tryApprove(await device.assert(challenge, { count: 10 })));
    expect(db.posts.has('p2')).toBe(false);
    expect(good.events.find((e) => e.type === 'action')).toMatchObject({ status: 'ok' });
    expect(audit.find((e) => e.decision === 'approved')).toMatchObject({ consent: 'passkey' });

    // A cloned authenticator (counter not increasing) is refused next time.
    const second = run();
    const staged2 = ok(await second.engine.handle(message('delete this', undefined, client({ route: '/posts/p1' })), alice));
    const pending2 = staged2.pending;
    if (pending2?.type !== 'confirm' || !pending2.stepUp) throw new Error();
    const cloned = await device.assert(pending2.stepUp.challenge, { count: 10 });
    expect(await second.engine.handle({ ...approve(staged2.state, pending2.grantId), client: client({ route: '/posts/p1' }), proof: cloned }, alice)).toMatchObject({
      ok: false,
      code: 'step_up_failed',
    });
  });

  it("rejects another user's passkey", async () => {
    const passkeys = memoryPasskeyStore();
    const { device: bobsDevice, stepUp } = await registerThroughHandler(passkeys, bob);
    await registerThroughHandler(passkeys, alice);
    const { engine } = setup([(i) => call('posts_delete', { posts: [i.page.entities[0]!.handle] }), say('ok')], { stepUp: { ...stepUp!, when: 'destructive' } });
    const ctx = client({ route: '/posts/p2' });
    const staged = ok(await engine.handle(message('delete this', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm' || !staged.pending.stepUp) throw new Error();
    const proof = await bobsDevice.assert(staged.pending.stepUp.challenge);
    expect(await engine.handle({ ...approve(staged.state, staged.pending.grantId), client: ctx, proof }, alice)).toMatchObject({ ok: false, code: 'step_up_failed' });
  });

  it('falls back to typed confirmation, or refuses, when the user has no passkey', async () => {
    const stepUp = webauthn({ rpId: RP_ID, origins: ORIGIN, passkeys: memoryPasskeyStore(), when: 'destructive' });
    const ctx = client({ route: '/posts/p2' });
    const typed = setup([(i) => call('posts_delete', { posts: [i.page.entities[0]!.handle] }), say('ok')], { stepUp });
    const staged = ok(await typed.engine.handle(message('delete this', undefined, ctx), alice));
    if (staged.pending?.type !== 'confirm') throw new Error();
    expect(staged.pending).toMatchObject({ stepUpMissing: true, view: { requireTyped: 'confirm' } });
    expect(await typed.engine.handle({ ...approve(staged.state, staged.pending.grantId), client: ctx }, alice)).toMatchObject({ ok: false, status: 'invalid_args' });
    ok(await typed.engine.handle({ ...approve(staged.state, staged.pending.grantId, { typed: 'confirm' }), client: ctx }, alice));
    expect(typed.db.posts.has('p2')).toBe(false);

    const strict = setup([(i) => call('posts_delete', { posts: [i.page.entities[0]!.handle] }), say('ok')], { stepUp: { ...stepUp, fallback: 'deny' } });
    const staged2 = ok(await strict.engine.handle(message('delete this', undefined, ctx), alice));
    if (staged2.pending?.type !== 'confirm') throw new Error();
    expect(await strict.engine.handle({ ...approve(staged2.state, staged2.pending.grantId, { typed: 'confirm' }), client: ctx }, alice)).toMatchObject({
      ok: false,
      code: 'step_up_unavailable',
    });
    expect(strict.db.posts.has('p2')).toBe(true);
  });

  it('round-trips base64url', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });
});
