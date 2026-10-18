# saydo.config.ts reference

One file, `export default defineConfig({...})` from `saydo-js/config`. The top four options are the essentials; every group below them is optional with a safe default. An old or misplaced key logs a warning naming its new place.

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { defineConfig } from 'saydo-js/config';
import { postgresGrantStore } from 'saydo-js/server';
import { auth } from '@/lib/auth';
import { pool } from '@/lib/db';

export default defineConfig({
  model: anthropic('claude-sonnet-5-5'),
  getUser: async () => {
    const session = await auth();
    return session ? { id: session.user.id, role: session.user.role } : null;
  },
  store: postgresGrantStore(pool),
  instructions: 'Amounts are in EUR. Be brief.',

  knowledge: { about: 'Invoicing for small agencies.', docs: [{ title: 'Refunds', text: 'Within 30 days, from the invoice page.' }] },
  hide: { routes: ['/admin/*'], fields: ['tax-id'] },
  act: { defaultRisk: 'write' },
});
```

## The essentials

| Option | Default | Notes |
|---|---|---|
| `model` | mock planner in dev | Any AI SDK model; `[primary, backup]` fails over; or `({ user, route, request }) => model` per request (plans, tenants, a tenant's own key). Required in production unless `advanced.planner`. |
| `getUser` | per-browser visitor | `(request) => user \| null`. `null` refuses with 401. `'anonymous'` for public apps without sign-in: each browser gets an isolated identity. With neither, production refuses actions that change data. |
| `store` | memory in dev | Approvals. `postgresGrantStore(pool)` (run `await store.migrate()` once), `redisGrantStore({ eval })`, `firestoreGrantStore(getFirestore())`, or `'memory'` for one process. Production with gated actions needs one. |
| `instructions` | none | Appended to the safety rules, never replacing them. Can be `({ user, route }) => string`. |

## knowledge: what the assistant knows

| Option | Default | Notes |
|---|---|---|
| `name` | none | The app's name as the assistant says it. |
| `about` | none | A paragraph about the app. |
| `docs` | none | `[{ title, text, routes?, keywords? }]` or `({ user, route, request }) => docs` (async ok). Answers "how do I…". |
| `guide` | `true` | Also answer from a guide built from pages and actions. `false` uses only `docs`. |

## see: what it may look at

| Option | Default | Notes |
|---|---|---|
| `page` | `true` | Sends the visible page (as untrusted data). `false` sends nothing from the screen. |
| `redact` | `'basic'` | Masks card numbers, SSNs, IBANs before egress. `'strict'` adds emails and phones. `'none'`, or `(text) => text`. |

## hide: what it must never know

| Option | Notes |
|---|---|
| `routes` | Patterns. `'/admin/*'` hides a subtree. Hidden from the model, the palette and the fast path. |
| `actions` | Ids or prefixes (`'billing.export'`, `'admin.*'`). Also hidden from outside agents. |
| `fields` | Form fields by name, id or label. Their values never leave the browser. |
| `selectors` | CSS selectors treated like `data-saydo-private`. |
| `context` | Keys of `useSaydoContext` data dropped on the server. |

## act: what it may do, and how it asks

| Option | Default | Notes |
|---|---|---|
| `elements` | `'all'` | Page elements it may operate: `'all'`, `'annotated'` (only `data-saydo`), or `false`. |
| `defaultRisk` | `'write'` | Risk of clicks without `data-saydo-risk`. |
| `annotationsCanLowerRisk` | `true` | `false` when rendering rich user HTML. |
| `authorize` | none | `({ user, capability: { id, risk, version }, input, origin }) => true \| false \| { deny } \| 'confirm' \| 'step-up'`. Runs for every call. Can only add friction. Errors deny. |
| `stepUp` | none | `webauthn({ rpId, origins, passkeys, allowRegistration })`: a passkey for the riskiest approvals. |
| `confirmBudget` | `5` | Confirmations per request before step-up. |
| `taint` | `'confirm'` | After reading untrusted content, reversible steps ask first. |
| `clarify` | `true` | May ask one question with clickable options. |

## Other groups

| Group | Options |
|---|---|
| `tools` | `mcp({ url, prefix?, risk?, include?, trusted? })`, `aiTools(tools, { risk, trusted? })`, `fromOpenAPI(spec, { include, methods: { GET: 'read' }, forwardCookies?, trusted? })`, `fromTRPC(router, { caller, queries: 'read' })`. |
| `capabilities` | Extra actions besides the discovered ones. |
| `limits` | `perMinute` (30, or `false`), `perDay: { requests, tokens }`, `steps` (6), `tools` (40), `store` (`redisLimitStore({ eval })` with several instances). |
| `conversations` | `store` (`firestoreThreadStore(db)`, `postgresThreadStore(pool)`, `memoryThreadStore()`) for history and resume, `retentionDays` (30). |
| `agents` | MCP: `authenticate(request) => user`, `approvals: 'delegated'`, `appOrigin`, `approvalUrl`. |
| `observe` | `audit` (wrap with `createAuditLog`), `onUsage`, `pricing: { input, output, cachedInput }`, `tracer` (OpenTelemetry), `record` (replay with `replayPlanner`), `deploymentId`. |
| `advanced` | `planner` (custom agent loop; the gate still applies), `secret` (default `SAYDO_SECRET`), `search: { embed }`, `lockfile`. |

## Environment

| Variable | When |
|---|---|
| `SAYDO_SECRET` | Required in production: 32+ random characters (`openssl rand -hex 32`). Generated automatically in dev. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Whatever the AI SDK provider in `model` reads. |

## Provider props (`<SaydoProvider>`)

`endpoint` ('/api/saydo'), `ui` (true; `false` for your own UI with `useSaydo()`), `hotkey` (⌘K), `placeholder`, `messages` (translate any text), `stepUp`, `agents` (WebMCP for browser agents; also pass `agents: true` to `withSaydo`), `onInvalidate={(keys) => queryClient.invalidateQueries(keys ? { queryKey: keys } : undefined)}`, `stream` (true), `headers`.
