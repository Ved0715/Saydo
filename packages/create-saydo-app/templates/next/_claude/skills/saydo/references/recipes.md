# Recipes

## Start a new app

```bash
npx create-saydo-app my-app                    # Next.js App Router (default)
npx create-saydo-app my-app --template vite    # Vite + React Router
cd my-app && npm run dev                       # press ⌘K
```

It works without an API key (deterministic mock planner). For a real model, put `ANTHROPIC_API_KEY=…` in `.env.local`.

## Add Saydo to an existing Next.js app (App Router, Next 15.5+)

```bash
npx saydo-js init --install
```

It installs `saydo-js`, wraps `next.config`, adds the provider to the root layout, creates `app/api/saydo/route.ts` and `saydo.config.ts`, and installs this skill. By hand, it is three edits:

```ts
// next.config.ts
import { withSaydo } from 'saydo-js/next';
export default withSaydo({ /* your config */ });
```

```tsx
// app/layout.tsx
import { SaydoProvider } from 'saydo-js/next/client';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><SaydoProvider>{children}</SaydoProvider></body></html>;
}
```

```ts
// app/api/saydo/route.ts
export { POST } from 'saydo-js/next/route';
```

## Add Saydo to a Vite + React Router app

```ts
// vite.config.ts
import { saydo } from 'saydo-js/vite';
export default defineConfig({ plugins: [react(), saydo()] });
```

```tsx
// inside the router, e.g. the root layout route
import { SaydoProvider } from 'saydo-js/react-router';
<SaydoProvider><Outlet /></SaydoProvider>
```

Pages go in `saydo.routes.ts` with `pages([...])`. For production, build a server entry with `vite build --ssr server.ts`, using `toNodeHandler` and `serveStatic` from `saydo-js/node` (see the vite template).

## Other frameworks (Vue, Svelte, plain pages)

```ts
import { createSaydo } from 'saydo-js/dom';
const saydo = createSaydo();   // endpoint '/api/saydo'
saydo.action('theme.dark', 'Switch to dark mode', toDark, { phrases: ['dark mode'] });
```

The server side is `createHandler(registry)` from `saydo-js/handler` on any fetch-style server.

## Ship to production

1. `SAYDO_SECRET`: 32+ random characters.
2. `model` set (or `advanced.planner`).
3. `getUser` returns your signed-in user (or `getUser: 'anonymous'` for public apps).
4. A durable `store` when running more than one instance:
   ```ts
   import { postgresGrantStore } from 'saydo-js/server';
   const store = postgresGrantStore(pool);
   await store.migrate();   // once
   ```
5. With several instances: `limits: { store: redisLimitStore({ eval: (s, keys, args) => redis.eval(s, { keys, arguments: args }) }) }`.
6. Commit `saydo.capabilities.json`, and build in CI with `CI=true`.
7. Optional: `observe: { audit: createAuditLog(write), onUsage, tracer }`.

## Teach it about the app

```ts
knowledge: {
  name: 'Acme Books',
  about: 'Bookkeeping for freelancers: invoices, expenses, tax reports.',
  docs: async ({ user }) => (await cms.helpArticles()).map((a) => ({ title: a.title, text: a.body, keywords: a.tags })),
},
```

"How do I export my taxes?" is then answered from your docs and from the guide Saydo builds from pages and actions, and the assistant offers to do it.

## Keep data away from the model

```ts
hide: {
  routes: ['/admin/*', '/internal'],
  actions: ['billing.export', 'admin.*'],
  fields: ['tax-id', 'salary'],
  selectors: ['.internal-notes', '#payroll'],
  context: ['debug'],
},
see: { redact: 'strict' },
```

In markup: `data-saydo-private` on anything secret, `data-saydo-untrusted` around user-generated content.

## Your organization's permission rules

```ts
act: {
  authorize: async ({ user, capability, input, origin }) => {
    if (capability.id.startsWith('billing.') && user.role !== 'finance') return { deny: 'Only finance can do this.' };
    if (origin === 'external' && capability.risk !== 'read') return 'confirm';
    return true;
  },
},
```

## Passkeys for the riskiest steps

```ts
import { webauthn, postgresPasskeyStore } from 'saydo-js/server';

act: {
  stepUp: webauthn({
    rpId: 'example.com',
    origins: 'https://app.example.com',
    passkeys: postgresPasskeyStore(pool),
    allowRegistration: (user) => user.recentlySignedIn === true,
  }),
},
```

Users add a passkey from your settings page with `usePasskeys().register('MacBook')`.

## Conversation history

```ts
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreThreadStore, firestoreGrantStore } from 'saydo-js/server';

conversations: { store: firestoreThreadStore(getFirestore()) },
store: firestoreGrantStore(getFirestore()),
```

The palette shows **History**; `useConversations()` builds your own. Firestore needs one composite index (`saydo_threads`: `userId` asc, `updatedAt` desc) and TTL policies on `expireAt`. Postgres: `postgresThreadStore(pool)` with `migrate()`.

## Let outside agents (Claude, ChatGPT, Cursor) use the app

```ts
// on each action they may use
expose: { external: true },
```

```ts
// saydo.config.ts
agents: { authenticate: (request) => userFromToken(request.headers.get('authorization')), approvals: 'delegated' },
```

```ts
// app/api/saydo/mcp/route.ts
export { POST, GET, DELETE } from 'saydo-js/next/mcp';
// app/saydo/approve/[id]/page.tsx
export { default } from 'saydo-js/next/approve';
```

Gated calls return an approval link; the user approves in the app, and the agent polls `saydo_approval_status`.

Browser agents (WebMCP): `expose: { browserAgent: true }`, `<SaydoProvider agents>`, and `withSaydo(config, { agents: true })`.

## Keep React Query or SWR in sync

```tsx
<SaydoProvider onInvalidate={(keys) => queryClient.invalidateQueries(keys ? { queryKey: keys } : undefined)}>
```

Handlers can target keys with `invalidate('posts')`.

## Pick the model per request, or let tenants bring a key

```ts
model: ({ user }) => (user.plan === 'pro' ? anthropic('claude-sonnet-5-5') : anthropic('claude-haiku-5-5')),
// or: model: ({ user }) => createAnthropic({ apiKey: tenantKeys.get(user.tenantId) })('claude-sonnet-5-5'),
```

## Test the assistant

```ts
import { createEngine, mockPlanner } from 'saydo-js/server';
// a scripted "model": a tool call, then an answer
const planner = mockPlanner({ script: [{ calls: [{ id: '1', name: 'posts_archive', args: { post: 'post#1' } }] }, { text: 'Archived.', calls: [] }] });
```

Also: `npx saydo ask "…"` against the dev server, and `npx saydo eval` with `saydo.evals.json` (`[{ "say": "…", "route": "/", "expect": "posts.create" }]`).
