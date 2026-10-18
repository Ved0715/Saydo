# Saydo

**Say it. It's done.** The AI-native framework for React and Next.js.

Your users type (or say) what they want: *"take me to billing"*, *"rename this post to Q4 Roadmap"*, *"turn off email notifications and save"*. Your app does it. The assistant can see and do anything a user can see and do in your app, limited only by what you allow. Anything consequential waits for the user's click on a card that shows exactly what will happen.

```bash
npx create-saydo-app my-app
cd my-app && npm run dev        # open the app, press ⌘K
```

Already have an app? Run `npx saydo init` inside it.

---

## Why Saydo

| | |
|---|---|
| **Works on day one** | Every page is navigable with zero configuration. A ⌘K palette is included. You write no prompts, no tool schemas, no confirm dialogs. |
| **Sees what users see** | The assistant reads the visible page (headings, tables, form fields and their values) and can operate any button, link, field or form, just as a person would. |
| **Uses your code, not a new stack** | Server Actions, API routes, React Query mutations, OpenAPI specs, tRPC routers, MCP servers and AI SDK tools each become an assistant ability with one line. |
| **You decide everything** | One config file and a few HTML attributes control what the assistant may see and do. Every exposed action is recorded in a lockfile you review in pull requests. |
| **Safe by structure, not by prompt** | The server alone decides risk. A risky action runs only after the user approves a card built from the real arguments, and each approval works once. A prompt-injected model can propose actions but never carry them out. |
| **Fast and cheap** | Plain navigation is answered locally with no model call. Large apps send only the relevant tools, and the rest are a search away. Tool ordering is kept stable so provider prompt caching works. |
| **Any model** | Built on the [AI SDK](https://ai-sdk.dev), so it works with Claude, GPT, Gemini or local models. A deterministic mock planner makes demos and CI run without a key. |
| **Accessible and resilient** | Navigation is announced to screen readers, focus is managed, and everything is keyboard-complete. If the model is down, the palette still works. |

## How it works

```mermaid
flowchart LR
  U["User: 'turn off notifications and save'"] --> C[Saydo in the browser<br/>reads the visible page]
  C --> S[Saydo on your server<br/>decides what is allowed and how risky]
  S --> M[Your model<br/>proposes steps]
  M --> S
  S -->|safe steps| R[Run: fill fields, navigate, call actions]
  S -->|risky steps| K[Confirm card from the real arguments]
  K -->|user clicks| R
  R --> V[Results go back to the model;<br/>the screen updates]
```

The pieces you will meet:

| Concept | What it is | Where it lives |
|---|---|---|
| **Pages** | Everywhere the assistant can go | Derived from `app/` (Next.js) or `saydo.routes.ts` (React Router) |
| **Screen** | What the user sees right now, plus numbered elements (`e4`) the assistant can operate | Automatic; you restrict it with attributes |
| **Actions** | Things your app can do: server functions, Server Actions, APIs, tools | `capabilities/`, `serverAction()`, `saydo.config.ts` |
| **Entities** | Records the assistant refers to by safe handles (`post#1`) instead of guessable ids | `entities/` |
| **Risk** | `read` · `reversible` · `write` · `destructive` · `never` | On each action or element |

## Contents

1. [Install](#1-install)
2. [Configure](#2-configure-saydoconfigts)
3. [Seeing and using the page](#3-seeing-and-using-the-page-no-code)
4. [Actions](#4-actions)
5. [Server Actions](#5-server-actions)
6. [Entities](#6-entities)
7. [Pages and URL state](#7-pages-and-url-state)
8. [UI actions and page context](#8-ui-actions-and-page-context)
9. [Existing client calls](#9-existing-client-calls-react-query-fetch)
10. [External tools and APIs](#10-external-tools-and-apis)
11. [Your own UI](#11-your-own-ui)
12. [Passkeys for the riskiest steps](#12-passkeys-for-the-riskiest-steps)
13. [Agents outside your app (MCP, WebMCP)](#13-agents-outside-your-app-mcp-webmcp)
14. [Without React (`saydo/dom`)](#14-without-react-saydodom)
15. [Conversations and storage](#15-conversations-and-storage)
16. [Production](#16-production)
17. [The safety model](#the-safety-model)
18. [CLI](#cli)
19. [API reference](#api-reference)
20. [FAQ](#faq)

---

## 1. Install

### A new app

```bash
npx create-saydo-app my-app                   # Next.js (default)
npx create-saydo-app my-app --template vite   # React + Vite + React Router
```

Both templates are complete demo apps you can explore and then trim down.

### An existing Next.js app (App Router, Next 15.5+)

```bash
npx saydo init --install
```

This makes three small edits and creates one config file:

```ts
// next.config.ts
import { withSaydo } from 'saydo/next';
export default withSaydo(nextConfig);
```

```tsx
// app/layout.tsx
import { SaydoProvider } from 'saydo/next/client';
// …
<body><SaydoProvider>{children}</SaydoProvider></body>
```

```ts
// app/api/saydo/route.ts
export { POST } from 'saydo/next/route';
```

### An existing React app (Vite + React Router)

```bash
npx saydo init --install
```

```ts
// vite.config.ts
import { saydo } from 'saydo/vite';
export default defineConfig({ plugins: [react(), saydo()] });
```

```tsx
// your root layout route
import { SaydoProvider } from 'saydo/react-router';
<SaydoProvider><Outlet /></SaydoProvider>
```

```ts
// saydo.routes.ts: the pages the assistant may open
import { pages } from 'saydo';
export default pages([
  { path: '/', title: 'Home' },
  { path: '/settings', title: 'Settings', aliases: ['preferences'] },
]);
```

For production, serve the endpoint from your server. See [Production](#16-production).

**Requirements:** React 19.2+, Node 20.9+, `ai` 7+ and `zod` 4+.

## 2. Configure (`saydo.config.ts`)

One file, grouped by the question each part answers. Only the first four options are common; every group is optional, with a safe default.

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { defineConfig } from 'saydo/config';
import { auth } from './lib/auth';

export default defineConfig({
  // The essentials
  model: anthropic('claude-sonnet-5-5'),          // any AI SDK model
  getUser: async () => {
    const session = await auth();
    return session ? { id: session.user.id, role: session.user.role } : null;
  },
  store: postgresGrantStore(pool),                 // where approvals live ('memory' for one process)
  instructions: 'Be brief. Amounts are in EUR.',  // appended to the safety rules, never replacing them

  // What the assistant knows about your app
  knowledge: {
    about: 'Invoicing for small agencies: clients, invoices, payments.',
    docs: [{ title: 'Refunds', text: 'Refunds are possible for 30 days, from the invoice page.', keywords: ['money back'] }],
  },
  // What it must never know about
  hide: { routes: ['/admin/*'], actions: ['billing.export'], fields: ['tax-id'], selectors: ['.internal-notes'] },
  // What it may do, and how it asks
  act: { defaultRisk: 'write', authorize: myPolicy },
});
```

**The essentials**

| Option | Default | What it does |
|---|---|---|
| `model` | mock planner in dev | Any AI SDK model; several (`[primary, backup]`) to fail over; or a function `({ user, route, request }) => model` that picks per request (by plan, tenant or page; return a provider created with a tenant's own key to let tenants bring theirs). |
| `getUser` | per-browser visitor | Your signed-in user `{ id, …anything }`, or `null` to refuse. `'anonymous'` is for public apps without sign-in: each browser gets its own isolated identity. With neither, production refuses actions that change data. |
| `store` | memory in dev | Where approvals live: `postgresGrantStore`, `redisGrantStore`, `firestoreGrantStore`, or `'memory'` for one process. |
| `instructions` | none | Brand voice and domain hints. A function picks them per request: `({ user, route }) => …`. |

**`knowledge`: what it knows about your app**

| Option | Default | What it does |
|---|---|---|
| `name` | none | Your app's name, as the assistant says it. |
| `about` | none | A paragraph about what the app is for. |
| `docs` | none | How-tos, policies and FAQs (`{ title, text, routes?, keywords? }`), or a function of `{ user, route }` that returns them. "How do I…" questions are answered from these. |
| `guide` | `true` | Also answer from a guide Saydo builds from your pages and actions: where each action lives and what needs confirmation. The assistant explains the steps, then offers to do them. |

**`see`: what it may look at** · `page` (default `true`): the visible page as untrusted context. `redact` (default `'basic'`): masks card numbers (Luhn-checked), SSNs and IBANs in everything before egress; `'strict'` adds emails and phones; or your own function.

**`hide`: what it must never know about**

| Option | What it hides |
|---|---|
| `routes` | Pages it never sees, lists or opens (`'/admin/*'` hides a subtree). |
| `actions` | Actions it never sees or calls, by id or prefix (`'admin.*'`); outside agents can't see them either. |
| `fields` | Form fields whose values never leave the browser, by name, id or label. |
| `selectors` | Parts of the page it never reads (CSS selectors, like `data-saydo-private`). |
| `context` | Keys of `useSaydoContext` data dropped on the server. |

**`act`: what it may do, and how it asks**

| Option | Default | What it does |
|---|---|---|
| `elements` | `'all'` | Page elements it may operate: `'all'`, `'annotated'` (only `data-saydo` ones) or `false`. |
| `defaultRisk` | `'write'` | Risk of clicks you did not annotate (`'read'` removes those confirmations, `'destructive'` is stricter). |
| `annotationsCanLowerRisk` | `true` | Set `false` if you render rich user HTML that could carry `data-saydo-risk`. |
| `authorize` | none | Central policy for every call (assistant, MCP, browser agents): return `true`, `false`, `{ deny }`, `'confirm'` or `'step-up'`. Plug in OPA, Cedar or your RBAC. It can add friction, never remove it. |
| `stepUp` | none | `webauthn({ … })`: a passkey for the riskiest approvals (§12). |
| `confirmBudget` | `5` | Confirmations per request before more need step-up. |
| `taint` | `'confirm'` | After it reads content written by others, reversible steps in that request ask first. `'off'` relies on Undo. |
| `clarify` | `true` | It may ask one short question with clickable options ("Which post: Launch notes or Roadmap?") instead of guessing. |

**The other groups**

| Group | Options |
|---|---|
| `tools` | `mcp()`, `aiTools()`, `fromOpenAPI()`, `fromTRPC()`, or plain actions (§10). `capabilities` adds extra actions. |
| `limits` | `perMinute` (default 30 per user, or `false`), `perDay: { requests, tokens }`, `steps` (default 6), `tools` (default 40, the rest are found by search), `store` (`redisLimitStore(…)` with several instances). |
| `conversations` | `store` (keep conversations on the server: history, resume, erasure; §15), `retentionDays` (default 30). |
| `agents` | Agents outside your app over MCP: `authenticate`, `approvals: 'delegated'`, `appOrigin`, `approvalUrl` (§13). |
| `observe` | `audit` (wrap with `createAuditLog()`), `onUsage`, `pricing` (USD per million tokens, gives `costUsd`), `tracer` (OpenTelemetry), `record` (replay with `replayPlanner`), `deploymentId`. |
| `advanced` | `planner` (your own agent loop; the gate still applies), `secret` (default `SAYDO_SECRET`), `search` (`{ embed }` for meaning-based action search), `lockfile`. |

A misplaced or old option name prints a warning that says where it belongs.

## 3. Seeing and using the page (no code)

With the defaults, the assistant sees what the user sees. It can fill fields, choose options, tick boxes, follow links, click buttons and submit forms, without you writing anything. You shape it with plain attributes:

| Attribute | Effect |
|---|---|
| `data-saydo-private` | The assistant never sees or touches this subtree. Use it for card numbers, secrets and anything sensitive. |
| `data-saydo="off"` | Visible to the assistant, but it may not operate it. |
| `data-saydo="Publishes the post to readers"` | Describes what an element or form does, which helps the model choose. In `'annotated'` mode it also marks the element as allowed. |
| `data-saydo-risk="read \| reversible \| write \| destructive \| never"` | Sets the risk for an element or a whole form. `never` means the assistant can point to it but never press it. |
| `data-saydo-untrusted` | User-generated content (comments, post bodies). It is readable as untrusted data, and **nothing inside it can be operated**, so injected buttons and links cannot become actions. |
| `data-saydo-context="Invoice INV-1042"` | Labels a row or card, so "Delete" in one row is never confused with another. |
| `toolname` / `tooldescription` on `<form>` | WebMCP-compatible form annotations are honored too. |

How risk is decided for page elements (on the server):

| Action | Risk |
|---|---|
| Typing in a field, choosing an option | `read`: it is local and visible, and the user can still edit before submitting |
| Ticking a checkbox inside a form | `read` (the submit is the consequential step) |
| Following an internal link | `read` |
| Anything you annotated with `data-saydo-risk` | your risk |
| Any other click (buttons, external links, submits) | `act.defaultRisk`, `write` by default, so the user confirms |

Password fields are never filled, and they are hidden in the screen outline along with payment and one-time-code fields. The confirm card for a submit lists the exact values the form will send.

## 4. Actions

An action is a typed function the assistant can call. Put it in `capabilities/`. The file path becomes the id: `capabilities/posts/create.ts` becomes `posts.create`. You can also pass an explicit `id`.

```ts
// capabilities/posts.ts
import 'server-only';
import { z } from 'zod';
import { action, navigate, CapabilityError } from 'saydo';
import { Post } from '@/entities/post';

export const createPost = action({
  id: 'posts.create',
  describe: 'Start a new draft post, optionally with a title',
  input: z.object({ title: z.string().max(200).optional() }),
  risk: 'write',                                  // confirm card first
  handler: async ({ title }, ctx) => {
    const id = await db.post.create({ title, authorId: ctx.user.id });
    return { result: { id }, effects: [navigate(`/posts/${id}`)] };
  },
});

export const archivePost = action({
  id: 'posts.archive',
  describe: 'Archive a post',
  input: z.object({ post: Post.ref() }),          // resolved record, access already checked
  risk: 'reversible',                             // runs at once, with an Undo button
  handler: async ({ post }) => {
    if (post.archived) throw new CapabilityError('precondition_failed', 'That post is already archived.');
    await db.post.archive(post.id);
  },
  undo: async ({ post }) => db.post.unarchive(post.id), // required by the type for 'reversible'
});
```

**Risk ladder:**

| Risk | What happens | Use for |
|---|---|---|
| `read` | Runs immediately | Lookups, counts, search |
| `reversible` | Runs immediately and offers **Undo** (your `undo` function) | Archive, hide, move |
| `write` | Confirm card first | Create, update, send |
| `destructive` *(default if you say nothing)* | Confirm card with full details. When it affects many records, the user must also type the count. | Delete, refund, bulk changes |
| `never` | Never offered to the model; the user is directed to the page | Delete account, change password |

**Handler context** (`ctx`): `user`, `request` (the incoming `Request`), `signal`, `invocationId` (use it as an idempotency key), `threadId`, `route`.

**Effects** you can return: `navigate(href)`, `refresh()`, `toast(message)`, `invalidate(...keys)` (client caches, see §9). After any successful write the page refreshes its server data on its own, so the screen never shows stale rows.

**Errors:** throw `new CapabilityError(status, hint)` to give the model a clear, safe reason. Raw exception text never reaches the model.

Other options: `title`, `can(user)` (hidden from users who fail it), `scope: { routes }` (a relevance hint), `expose`, `version` (bump it when behavior changes: approvals shown for the old version are refused, never run against the new code), `confirm: { view }` (a custom card built from the validated input), and two safety hints:

- `blastRadius: (input, { user }) => count`: for inputs that select by filter (`{ status: 'draft' }`) instead of listing records. A destructive call above 5 records then needs step-up and the card shows the count. If counting fails, the count is treated as unlimited. Inputs that list records (`z.array(Post.ref())`) are counted for you.
- `untrustedResults: true`: the results contain text other people wrote (comments, emails, web pages). They reach the model marked as untrusted, and later steps in that request ask first.

### Workflows: several steps, one approval

When a request needs several actions in a fixed order ("publish it and email the subscribers"), compose them. The steps, their order and the data flow are yours; the model only fills the input. The user approves once, on a card that lists every step:

```ts
import { workflow } from 'saydo';

export const launchPost = workflow({
  describe: 'Publish a post and email its subscribers',
  input: z.object({ post: Post.ref(), subject: z.string().max(80) }),
  steps: [
    { run: publishPost, input: ({ post }) => ({ post }) },
    { run: notifySubscribers, input: ({ post, subject }, [published]) => ({ postId: post.id, subject }) },
    { run: postToSlack, input: ({ post }) => ({ text: post.title }), when: ({ post }) => post.public },
  ],
});
```

- The risk is the riskiest step's (you can raise it with `risk`, never lower it).
- If a step fails, the completed steps that have `undo` are undone in reverse order, and the receipt says exactly which steps stay done.
- Each step's plain fields are validated with that step's own schema, and each step gets its own `ctx.invocationId` (`<id>:<step>`).

## 5. Server Actions

One function serves both your UI and the assistant:

```ts
// app/settings/actions.ts
'use server';
import { z } from 'zod';
import { serverAction } from 'saydo';

export const updateSettings = serverAction(
  {
    describe: 'Update profile settings (display name, notifications, language)',
    input: z.object({ displayName: z.string().max(60).optional(), language: z.enum(['en', 'es', 'fr']).optional() }),
    risk: 'write',
  },
  async (input) => {
    await db.settings.update(input);
    return { ok: true };
  },
);
```

```tsx
<form action={updateSettings}>…</form>          // FormData works, validated by the same schema
await updateSettings({ language: 'fr' });        // so do objects
```

Saydo finds `'use server'` files that use `serverAction()`, so there is nothing to register. The id is the export name. As with any Server Action, check authorization inside the function, because humans can call it directly.

## 6. Entities

Entities let the assistant refer to *your* records without ever handling raw ids:

```ts
// entities/post.ts
import 'server-only';
import { entity } from 'saydo';

export const Post = entity<PostRecord>({
  type: 'post',
  label: (p) => p.title,
  get: (id, { user }) => db.post.findFirst({ where: { id, authorId: user.id } }), // the access check
  find: (query, { user }) => db.post.search({ query, authorId: user.id }),       // enables "find my Q4 post"
});
```

- `Post.ref()` in an action input means the handler receives the **record**.
- `Post.ref({ as: 'id' })` means the handler receives its **id**, which suits Server Actions that also take ids from forms.
- `entityRef<PostRecord>('post')` is the browser-safe form, for client actions that must not import database code.
- The model only ever sees handles like `post#1`, minted by the server from the current page or a search. Invented or foreign ids are rejected, and every handle is re-checked through `get` when it is used.
- **When the user approves, records are re-checked:** every handle is re-resolved through `get`, so deleted records and revoked access are caught. Add `version: (p) => p.updatedAt` to an entity and Saydo also refuses (`precondition_failed`) if the record changed after the confirm card was shown, instead of overwriting newer data.

## 7. Pages and URL state

Next.js pages are discovered from `app/` (route groups, parallel routes and intercepting routes are handled). Add an optional `nav.ts` next to a page:

```ts
// app/billing/nav.ts
import { z } from 'zod';
import { page } from 'saydo';

export default page({
  title: 'Billing',
  aliases: ['invoices', 'payments'],
  search: z.object({ status: z.enum(['paid', 'unpaid']).optional() }), // "show unpaid invoices"
});
```

```ts
// app/posts/[id]/nav.ts: binding [id] makes the page reachable and gives the assistant "this post"
export default page({ title: 'Post editor', params: { id: Post.param() } });
```

`access: (user) => boolean` hides a page per user (it is never sent to the model or the palette). `hidden: true` hides it for everyone. A dynamic page is only offered once its params are bound to entities, so the model cannot guess ids into URLs. Undeclared query parameters are rejected.

## 8. UI actions and page context

```tsx
'use client';
import { useAction, useSaydoContext } from 'saydo/next/client';   // or 'saydo/react-router'

useAction('share.open', 'Open the share dialog', () => setOpen(true));

useAction('theme.set', 'Switch the color theme', ({ theme }) => setTheme(theme), {
  input: z.object({ theme: z.enum(['light', 'dark']) }),
});

useSaydoContext('cart', { items: cart.length, total });   // small, opt-in state; treated as untrusted
```

UI actions run in the browser with no confirmation, so keep them to UI changes. Use `action()` or `serverAction()` for anything that changes data.

**Instant answers, no model call:** give a UI action `phrases` and those exact words run it in the browser in milliseconds: `useAction('theme.dark', 'Switch to dark mode', toDark, { phrases: ['dark mode', 'lights off'] })`. Navigation by page name, "undo that", "go back" and "new chat" are instant too.

**Ask instead of guess:** when a request is ambiguous ("archive the post" with two posts on screen), the assistant asks one short question with clickable options. Turn it off with `act: { clarify: false }`.

**Unsaved changes:** `useSaydoGuard(form.isDirty)` tells the assistant the page has unsaved work. While it is active, AI navigation is refused with `blocked: unsaved_changes`, so the model asks the user to save first.

## 9. Existing client calls (React Query, fetch)

Keep your existing mutation and let the assistant call it through a declared action:

```ts
// capabilities/shared.ts: no handler means a client action, safe for the browser to import
export const publishPost = action({
  id: 'posts.publish',
  describe: 'Publish a post',
  input: z.object({ post: entityRef<PostRecord>('post') }),
  risk: 'write',
  entry: '/posts/[id]',          // where it lives, so it can be run from any page
});
```

```tsx
useCapability(publishPost, async ({ post }, ctx) => {
  await ctx.fetch(`/api/posts/${post.id}/publish`, { method: 'POST', body: JSON.stringify({ id: post.id }) });
  return { status: 'ok', message: 'Published.' };
});
```

```ts
// app/api/posts/[id]/publish/route.ts: human requests pass through; AI requests need the single-use grant
export const POST = withGrant(publishPost, handler, {
  match: ({ body, args }) => body.id === args.post.id,
});
```

**Keeping client caches in sync.** After an AI write, Saydo calls `router.refresh()` (server components update) and `onInvalidate`, so React Query, SWR or your store can refetch too:

```tsx
<SaydoProvider onInvalidate={(keys) => queryClient.invalidateQueries(keys ? { queryKey: keys } : undefined)}>
```

`keys` is undefined after any write ("something changed"), or the exact keys a handler returned with `invalidate('posts', 'tags')`. Non-React code can listen for the `saydo:invalidate` DOM event. In Next.js handlers you can also call `revalidatePath` / `revalidateTag` as usual.

## 10. External tools and APIs

```ts
import { tool } from 'ai';
import { aiTools, mcp, fromOpenAPI, fromTRPC } from 'saydo/server';

tools: [
  // Any MCP server. Tools default to 'destructive' unless you map them.
  mcp({ url: 'https://mcp.example.com/mcp', prefix: 'crm', risk: { search_contacts: 'read' } }),

  // Any AI SDK tool
  aiTools({ weather: tool({ description, inputSchema, execute }) }, { risk: 'read' }),

  // REST APIs from an OpenAPI 3 spec (JSON). Pick operations; GETs can be read-only.
  fromOpenAPI('./openapi.json', { include: ['listInvoices', 'refundInvoice'], methods: { GET: 'read' }, forwardCookies: true }),

  // tRPC routers: inputs from your Zod .input(), descriptions from .meta({ description })
  fromTRPC(appRouter, { caller: (ctx) => createCaller({ userId: ctx.user.id }), queries: 'read' }),
]
```

- Hints from another server (MCP `readOnlyHint` and similar) never lower risk unless you pass `trustAnnotations: true`.
- API error bodies are never passed to the model, so they cannot carry injected instructions.
- New tool sources show up in the lockfile for review.
- `mcp()` needs `npm install @ai-sdk/mcp`.
- Descriptions and results from MCP servers, OpenAPI specs and AI SDK tools are treated as third-party text: labeled and capped for the model, and their results taint the request (see `taint`). Pass `trusted: true` to a source you control. tRPC routers are yours and trusted by default.

## 11. Your own UI

The default UI is a ⌘K palette with a conversation, a confirm card, undo toasts and a live region for announcements. Restyle it with CSS variables (`--saydo-accent`, `--saydo-bg`, `--saydo-radius`, …), or replace it:

```tsx
<SaydoProvider ui={false}>{children}</SaydoProvider>

const ai = useSaydo();   // { open, items, busy, confirm, toasts, send, approve, deny, undo, goTo, … }
<ConfirmCard confirm={ai.confirm} onApprove={(trusted, typed) => ai.approve(trusted, typed)} onDeny={ai.deny} />
```

Always pass the click event's `isTrusted` to `approve`. The server refuses approvals from synthetic events.

**Streaming:** each step shows as it starts ("Opening Billing…", "Creating a draft…") and replies appear as the model writes them (newline-delimited JSON over the same endpoint; the final result is authoritative and a dropped stream is retried safely by `requestId`). Turn it off with `<SaydoProvider stream={false}>`.

**Translate or rephrase any text:** `<SaydoProvider messages={{ launcher: 'Preguntar a la IA', confirm: 'Confirmar', … }}>`. The palette always shows an AI disclosure line (`messages.disclosure`).

## 12. Passkeys for the riskiest steps

A click proves that an input event happened, not that a human made it, because browser automation produces trusted clicks too. For bulk deletes, money and permissions, require the user's passkey (Face ID, Touch ID, Windows Hello or a security key):

```ts
// saydo.config.ts
import { webauthn, postgresPasskeyStore } from 'saydo/server';

export default defineConfig({
  act: {
    stepUp: webauthn({
      rpId: 'example.com',                      // 'localhost' in dev
      origins: 'https://app.example.com',
      passkeys: postgresPasskeyStore(pool),     // or memoryPasskeyStore() in dev
      allowRegistration: (user) => user.recentlySignedIn === true, // adding a passkey must itself be protected
      // when: 'step-up' (default: bulk destructive, stepUp actions, over budget) | 'destructive' | 'gated'
      // fallback: 'typed' (default: typed confirmation without a passkey) | 'deny'
    }),
  },
});
```

```ts
action({ describe: 'Change a member’s role', risk: 'write', stepUp: true, /* … */ }); // always ask for the passkey
```

Users add a passkey from your settings page: `const passkeys = usePasskeys(); await passkeys.register('MacBook');`. The confirm card then shows **Confirm with passkey**. The server checks its own single-use challenge, the origin, the RP ID, user verification and the signature counter. Verification uses WebCrypto and needs no extra dependency.

## 13. Agents outside your app (MCP, WebMCP)

Your app can also serve AI agents the user runs elsewhere, such as Claude, ChatGPT or Cursor over MCP, and agents built into the browser over WebMCP. Nothing is exposed by default; each action opts in:

```ts
export const listInvoices = action({ describe: 'List invoices', risk: 'read', expose: { external: true, browserAgent: true }, /* … */ });
export const refund = action({ describe: 'Refund an invoice', risk: 'destructive', expose: { external: true }, /* … */ });
```

**MCP server** (one file):

```ts
// app/api/saydo/mcp/route.ts
export { POST, GET, DELETE } from 'saydo/next/mcp';
```

```ts
// saydo.config.ts
agents: {
  authenticate: (request) => userFromAccessToken(request.headers.get('authorization')), // your tokens or OAuth
  approvals: 'delegated',            // default 'deny': gated actions are refused for agents
  appOrigin: 'https://app.example.com',
},
```

**Approval page** (one file). When an agent asks for something gated, it gets a link instead of a result. The user opens it, sees the same card built from the stored arguments, and approves with a real click (and passkey, if required). The agent then polls `saydo_approval_status` for the result:

```tsx
// app/saydo/approve/[id]/page.tsx
export { default } from 'saydo/next/approve';
```

Or render `<SaydoApproval grantId={id} />` inside your own layout.

**WebMCP:** `<SaydoProvider agents>` registers the `browserAgent` actions with `document.modelContext` when the browser supports it. Calls run under the same policy, and gated ones show the normal confirm card and wait for the user.

Pages are served with `Permissions-Policy: tools=()` by default (WebMCP's policy feature), so no script on your page can register tools for browser agents, including a tag manager or a compromised dependency. When you turn agents on, also pass `agents: true` to `withSaydo(config, { agents: true })` (or the Vite plugin and `serveStatic`). The policy then becomes `tools=(self)`: your own origin only, no cross-origin frames.

Agents pass plain record ids, and Saydo checks each one through your entity's `get`, so an agent can never reach another user's data. `never` actions are never listed.

## 14. Without React (`saydo/dom`)

Vue, Svelte, Solid, Angular or server-rendered pages get the same palette, confirm card, undo toasts and page vision from a framework-free client (about 18 KB gzipped, no dependencies):

```ts
import { createSaydo } from 'saydo/dom';

const saydo = createSaydo();   // endpoint '/api/saydo'; full page loads unless you pass `router`
saydo.action('theme.toggle', 'Switch between light and dark mode', () => toggleTheme());
saydo.context('cart', { items: 3, total: '$42' });
saydo.guard(form.dirty ? 'You have an unsaved draft.' : null);
// single-page apps: createSaydo({ router: { push: (href) => router.push(href) } }) and saydo.navigated() after route changes
```

The server side is any fetch-style handler: `createHandler(registry)` from `saydo/handler`.

## 15. Conversations and storage

By default nothing is stored: the conversation lives in the browser tab as signed state. To give users **history, resume on any device, and erasure**, add a conversation store. The browser then holds only a small signed pointer, and the palette shows **History**.

```ts
// saydo.config.ts: pick any store, or write your own (7 small methods)
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreThreadStore, firestoreGrantStore } from 'saydo/server';

export default defineConfig({
  conversations: { store: firestoreThreadStore(getFirestore()) },   // or postgresThreadStore(pool), memoryThreadStore()
  store: firestoreGrantStore(getFirestore()),      // approvals too, so Firestore is the only database you need
});
```

| Store | Conversations | Approvals | Notes |
|---|---|---|---|
| Firestore | `firestoreThreadStore(db)` | `firestoreGrantStore(db)` | Transactions for compare-and-set and single-use approvals. One small document per conversation plus one per transcript line, so a long chat never becomes a hot, growing document. Create one composite index (`saydo_threads`: `userId` ascending, `updatedAt` descending) and TTL policies on `expireAt` (collection `saydo_threads`, collection group `entries`, collection `saydo_grants`). |
| Postgres | `postgresThreadStore(pool)` | `postgresGrantStore(pool)` | `await store.migrate()` once; `prune()` from a cron job. |
| Redis | (bring your own) | `redisGrantStore(…)` | |
| Memory | `memoryThreadStore()` | `'memory'` | One process only (dev, tests, single-instance servers). |

Your own store implements `ThreadStore` (`get`, `save`, `append`, `transcript`, `list`, `delete`, `deleteUser`). Two rules: `save` is an atomic compare-and-set on `version`, and the transcript is append-only. The contract test suite in the repo checks both against every store.

- **Hooks:** `const { enabled, list, open, remove, startNew } = useConversations()` to build your own history UI.
- **Retention:** conversations expire 30 days after the last message (`conversations.retentionDays`).
- **Erasure:** `await threads.deleteUser(userId)` and `await store.deleteUser(userId)` remove everything Saydo stored for a user.
- **Outages:** if the store is down during a turn, the response is never lost; that turn falls back to signed browser state and the conversation is saved again on the next turn.
- **What is stored:** the working state (messages, action results, record handles) and a transcript of what the user saw. Page snapshots are not stored.

## 16. Production

- **`SAYDO_SECRET`:** at least 32 random characters (`openssl rand -hex 32`). Required.
- **`model`:** required unless you pass `planner`.
- **Approval store:** for more than one server instance, use the durable Postgres store, which is atomic across instances (single-statement claims and compare-and-set):

```ts
import { postgresGrantStore } from 'saydo/server';
const store = postgresGrantStore(pool);   // pg.Pool, Neon, or anything with query(text, params)
await store.migrate();                    // once (or run store.schema in your migrations)
export default defineConfig({ store, /* … */ });
```

  Redis works the same way. Every operation is a single-key Lua script, so it is atomic and Redis Cluster safe, and keys expire on their own:

```ts
import { redisGrantStore } from 'saydo/server';
const store = redisGrantStore({ eval: (script, keys, args) => redis.eval(script, { keys, arguments: args }) }); // node-redis; adapt for ioredis or Upstash
```

  Any store implementing `create`, `claim`, `get`, `transition`, `update` and `deleteUser` works. `claim` and `transition` must be atomic. Use `store: 'memory'` only for a single process.
- **Exactly once:** every request carries a `requestId`, and the browser retries once on network errors. The server stores each response, so a retry never runs an action twice. Each tool call is also claimed once, and `ctx.invocationId` is your idempotency key for your own database writes.
- **Audit trail:** `observe: { audit: createAuditLog((record) => db.insert('saydo_audit', record)) }` gives you a hash-chained, append-only log (check it with `verifyAuditChain`). It records who did what, at which tier, how the user consented, a digest of the exact card they saw, the model and the deployed manifest, but never the arguments, so it holds no PII.
- **Right to erasure:** `store.deleteUser(userId)`. Conversation state is never stored on the server.
- **Central policy:** `act: { authorize: ({ user, capability, input, origin }) => … }` runs for every action call (assistant, MCP and browser agents) after records are resolved, so it sees real objects. Errors deny. It does not cover clicks on page elements; those follow `act`.
- **Reproducing incidents:** `observe: { record: (turn) => log.write(turn) }`, then in a test: `createEngine({ …, planner: replayPlanner(turns, { strict: true }) })`. `strict` fails when the app now offers the model different tools than when the turn happened.
- **Model outages:** `model: [anthropic('claude-sonnet-5-5'), openai('gpt-5')]` fails over per step; after repeated failures the circuit breaker answers fast and the palette keeps working.
- **Several instances:** use `limits: { store: redisLimitStore({ eval }) }` so rate limits and budgets are shared. The circuit breaker stays per instance on purpose: each instance stops calling a failing provider on its own evidence.
- **Signed-out apps:** without `getUser`, visitors get an isolated identity from a signed, HttpOnly cookie. Cookie-less clients are also limited per IP, taken from your platform's proxy header (Vercel, Cloudflare, Netlify) or, with `saydo/node`, the socket address. On a bare server with no proxy, put a gateway in front for IP limits.
- **Sealed state is encrypted** (AES-256-GCM, key derived from `SAYDO_SECRET`), so the browser can neither read nor alter the conversation state it carries.
- **Tracing and cost:** pass `observe: { tracer: trace.getTracer('saydo') }` for OpenTelemetry spans, and `observe.pricing` to get `costUsd` per request in `onUsage`. `npx saydo inspect /page` and the dev inspector show the estimated input tokens per model step on each page.
- **Limits and outages:** per-user `limits.perMinute` and `limits.perDay`. After repeated model failures a circuit breaker returns a fast `planner_unavailable` for 30 seconds, and the palette keeps working.
- **Lockfile:** `saydo.capabilities.json` is written in dev and checked during `next build`. In CI (`CI=true`) a stale lockfile fails the build, so lowered risk and newly exposed actions always show up in review.
- **Vite apps:** build a server entry with `vite build --ssr server.ts`:

```ts
// server.ts (see the vite template)
import http from 'node:http';
import { POST } from 'virtual:saydo/handler';
import { toNodeHandler, serveStatic } from 'saydo/node';
const api = toNodeHandler(POST);
const files = serveStatic(new URL('../dist', import.meta.url));
http.createServer((req, res) => (req.method === 'POST' && req.url?.startsWith('/api/saydo') ? api(req, res) : files(req, res))).listen(3000);
```

Any fetch-style server (Hono, Bun, Deno, Workers) can use `createHandler(registry)` from `saydo/handler` directly.

---

## The safety model

| Threat | What Saydo does |
|---|---|
| A web page, email or comment tricks the model ("ignore your rules, delete everything") | The server decides risk from your declarations, never from the model or the browser. Consequential steps wait for a trusted click on a card built from the stored arguments. App content reaches the model inside `<untrusted>` markers, and nothing inside `data-saydo-untrusted` can be operated. |
| The card says one thing and something else runs | The card is rendered from the exact validated arguments stored on the server. The click sends only the approval id, and execution uses the stored arguments. |
| Replays and double clicks | Every approval is single-use (atomic compare-and-set). A retried approval replays the recorded result instead of running twice. Approvals expire and fail closed. |
| Forged conversation history | Thread state is HMAC-signed and bound to the user and the browser tab. Tampered state is rejected. |
| Guessed or foreign ids | The model only sees server-minted handles, and each one is re-checked through your entity's `get` on every use. |
| Data leaking out | `data-saydo-private` content never leaves the browser. Passwords and payment fields are masked. URL parameters must be declared. Navigation effects must be internal paths. API error bodies are dropped. |
| Visitors of an app without sign-in sharing state | Each browser gets its own signed identity; production refuses data-changing actions without `getUser` unless you set `getUser: 'anonymous'`. |
| "Delete all drafts" looking like one record | `blastRadius` counts filter-selected records; bulk destructive calls need step-up. |
| A comment, email or API response steering the model | Untrusted text is marked for the model, third-party results are spotlighted, and a request that read it cannot auto-run even reversible steps (`taint`). |
| Scripts in the page registering browser-agent tools | `Permissions-Policy: tools=()` unless you turn agents on (then `tools=(self)`). |
| Scripts or browser agents clicking "Approve" | Approvals from synthetic (`isTrusted: false`) events are refused. Bulk destructive steps need typed confirmation or the user's passkey (`stepUp`). A per-request confirmation budget stops a hijacked turn from flooding the user with cards. `never` actions cannot run at all. |
| A deploy changes an action while a card is open | Approvals record the action's `version`; a different version is refused (`reload_required`), never run. |
| Third-party tool descriptions carrying instructions ("tool poisoning") | Descriptions from MCP servers and OpenAPI specs are labeled third-party, flattened and capped, and the model is told never to follow them. Their tools default to `destructive`. |
| Your org's permission rules | `authorize` runs on the server for every call and can only deny or add confirmation. |
| External agents | Nothing is exposed unless an action opts in with `expose`. Agents authenticate as the user, every id goes through your entity's `get`, and gated calls become a link the user approves in your app. |
| Abuse of your model budget | The endpoint accepts same-origin JSON only, is rate-limited and budgeted per user, step-capped with loop detection, and refuses off-topic work. A circuit breaker protects you during provider outages. |
| Retries and lost responses | Request-level idempotency (`requestId`), exactly-once tool-call claims, and replay of stored outcomes. |
| Data changing between card and click | Records are re-resolved with a fresh access check at approval; `entity.version` refuses if anything changed. |
| PII reaching the model provider | `data-saydo-private`, masked sensitive fields, and `redact` (on by default) applied before egress. |
| A teammate quietly loosening safety | `saydo.capabilities.json` records every action, risk, page and tool source. Changes appear in PR diffs, and CI fails if it is stale. |

## CLI

```bash
npx saydo init [--install]                 # add Saydo to an existing Next.js or Vite app
npx saydo ask "take me to billing" [--route /posts/1] [--url http://localhost:3000]
                                           # try a request against your dev server (never approves anything)
npx saydo inspect /settings                # tools and risks the model gets on that page
npx saydo actions                          # everything the assistant can do (from the lockfile)
npx saydo routes                           # pages found in app/
npx saydo doctor                           # check the setup end to end, and lint overlapping action descriptions
npx saydo eval                             # golden checks from saydo.evals.json: [{ "say": "…", "route": "/", "expect": "posts.create" }]
```

In development, the palette also has **"What the AI sees"**: the screen outline, the operable elements and every tool with its risk, live on the current page.

## API reference

| Import | Exports |
|---|---|
| `saydo` | `action` (`defineCapability`), `serverAction`, `workflow`, `entity` (`defineEntity`), `entityRef`, `page` (`defineRoute`), `pages` (`defineRoutes`), `navigate`, `refresh`, `toast`, `invalidate`, `CapabilityError`, types |
| `saydo/config` | `defineConfig` |
| `saydo/server` | `mcp`, `aiTools`, `fromOpenAPI`, `fromTRPC`, `memoryLimitStore`, `redisLimitStore`, `postgresGrantStore`, `redisGrantStore`, `firestoreGrantStore`, `MemoryGrantStore`, `memoryThreadStore`, `postgresThreadStore`, `firestoreThreadStore`, `replayPlanner`, `webauthn`, `memoryPasskeyStore`, `postgresPasskeyStore`, `createAuditLog`, `verifyAuditChain`, `redactor`, `costOf`, `createEngine`, `mockPlanner`, `aiSdkPlanner`, `seal`/`unseal` |
| `saydo/next` | `withSaydo` |
| `saydo/next/client` | `SaydoProvider`, `useAction`, `useCapability`, `useSaydoContext`, `useSaydoGuard`, `useSaydo`, `usePasskeys`, `useConversations`, `SaydoApproval`, `ConfirmCard`, `AssistantUI` |
| `saydo/next/server` | `createSaydoHandler`, `withGrant` |
| `saydo/next/route` | `POST` |
| `saydo/next/mcp` | `POST`, `GET`, `DELETE`: the MCP server |
| `saydo/next/approve` | Ready-made approval page for agent requests |
| `saydo/dom` | `createSaydo` (framework-free client and UI), `registerWebMcpTools`, `webauthnProof` |
| `saydo/react-router` | `SaydoProvider`, `useSaydoRefresh`, and the same hooks |
| `saydo/react` | Router-agnostic `SaydoProvider` (bring a `router` adapter) and hooks |
| `saydo/vite` | `saydo()` plugin, `toNodeHandler`, `serveStatic` |
| `saydo/handler` | `createHandler`, `createMcpHandler`, `withGrant`, `json` for any fetch-style server |
| `saydo/node` | `toNodeHandler`, `serveStatic` |

## FAQ

**Does Saydo scrape my DOM?** It reads the *visible* page the way a screen reader does, in the user's own browser, and only to answer that user. You control it with attributes, or turn it off with `see: { page: false }`. Actions on the page go through the same risk rules and consent as declared actions.

**What data goes to the model provider?** The user's message, the visible page outline (unless disabled), entity labels, any context you share with `useSaydoContext`, and action results. Nothing inside `data-saydo-private` and no password or payment field values.

**Can the assistant do something without the user knowing?** It can only run `read` steps and UI-only actions by itself, plus `reversible` steps (with Undo). Everything else needs the user's click. You can loosen that (`act.defaultRisk: 'read'`) or tighten it per action and per element. Every step shows a receipt line in the palette.

**Which models work?** Any [AI SDK](https://ai-sdk.dev/providers) model: Anthropic, OpenAI, Google, Mistral, local models through Ollama, and others. Small fast models handle navigation and simple actions well, and larger ones handle multi-step requests.

**Do I need an API key to try it?** No. Without one, development uses a deterministic mock planner that understands common phrasing ("take me to…", "click…", "fill … with …", "delete this post"). It is also what you use in tests.

**Pages Router? Remix? TanStack Router? Vue?** Today: Next.js App Router and React Router (with Vite) have full integrations. Any other React router works with `saydo/react` and a `router` adapter, and any other framework works with `saydo/dom`. The server side is `saydo/handler` on any fetch-style server.

**How do I test my assistant?** `npx saydo ask` against your dev server, `mockPlanner({ script })` for deterministic unit tests (including a fully compromised model that tries everything), and the lockfile for review.

## Status

v0.1. Built and tested (221 tests, including Postgres concurrency on PGlite, a real Redis server, a software WebAuthn authenticator and the AI SDK MCP client, plus real builds of both templates installed from packed tarballs):

- Next.js App Router, Vite + React Router, and framework-free `saydo/dom`
- page vision and element actions
- actions, Server Actions and entities
- MCP, AI SDK tools, OpenAPI and tRPC as sources
- consent tiers, single-use grants, undo, batched confirmations, passkey step-up
- Postgres and Redis approval stores, hash-chained audit log, budgets, circuit breaker
- MCP server and WebMCP for outside agents, with delegated approval
- workflows (composed actions with compensation), a central `authorize` policy, version-pinned approvals
- optional conversation storage (Firestore, Postgres, memory) with history and resume
- meaning-based action search, record and replay, model failover, automatic UI refresh after writes
- streaming replies, per-request model and instructions, encrypted sealed state, isolated anonymous visitors, shared Redis limits, taint escalation, blast-radius step-up
- OpenTelemetry tracing and cost estimates
- the lockfile, CLI, `create-saydo-app` and the dev inspector

Next on the roadmap:

- voice input
- Pages Router and TanStack Router hosts
- form-aware drafts with visible diffs
- a second, non-TypeScript server implementation of the protocol

Design notes: [plan/PLAN.md](plan/PLAN.md), [plan/ARCHITECTURE.md](plan/ARCHITECTURE.md), [plan/HARDENING.md](plan/HARDENING.md) (an item-by-item launch-readiness review), the protocol draft in [SPEC.md](SPEC.md) with its [IP policy](IP-POLICY.md), [contributing](CONTRIBUTING.md), and the [security policy](SECURITY.md).

## License

MIT
