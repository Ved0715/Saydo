# Actions, entities, pages and UI: code

All imports below come from `saydo-js` unless noted. Server files start with `import 'server-only';`.

## Risk ladder

| Risk | What happens | Use for |
|---|---|---|
| `read` | Runs immediately | Lookups, counts, search |
| `reversible` | Runs immediately, offers Undo (requires `undo`) | Archive, hide, move |
| `write` | Confirm card first | Create, update, send |
| `destructive` (default) | Confirm card with full details; more than 5 records (or `blastRadius` > 5) needs a passkey or the typed count | Delete, refund, bulk changes |
| `never` | Never offered; the assistant points the user to the page | Delete account, change password |

## Server action

```ts
// capabilities/invoices.ts
import 'server-only';
import { z } from 'zod';
import { action, CapabilityError, invalidate } from 'saydo-js';
import { Invoice } from '@/entities/invoice';

export const refundInvoice = action({
  describe: 'Refund a paid invoice in full',
  input: z.object({ invoice: Invoice.ref(), reason: z.string().max(200) }),
  risk: 'destructive',
  can: (user) => user.role === 'admin',          // hidden from users who fail it
  handler: async ({ invoice, reason }, ctx) => {
    if (invoice.status !== 'paid') throw new CapabilityError('precondition_failed', 'Only paid invoices can be refunded.');
    await payments.refund(invoice.id, { reason, idempotencyKey: ctx.invocationId });
    return { result: { refunded: invoice.total }, effects: [invalidate('invoices')] };
  },
});
```

Options: `id` (default from the file path), `title`, `describe`, `input` (a `z.object`), `risk`, `handler`, `undo`, `can(user)`, `scope: { routes }` (relevance hint), `expose: { assistant, browserAgent, external }` (assistant only by default), `version` (bump when behavior changes; old approvals are then refused), `confirm: { view: (input) => ({ title, fields, danger?, confirmLabel? }) }`, `stepUp: true`, `blastRadius: (input, { user }) => count`, `untrustedResults: true` (results contain other people's text).

Handler context: `ctx.user`, `ctx.request`, `ctx.signal`, `ctx.invocationId` (use as idempotency key), `ctx.threadId`, `ctx.route`.

`CapabilityError` statuses: `invalid_args`, `not_found`, `forbidden`, `precondition_failed`, `blocked`, `timeout`, `error`.

## Server Action used by the UI and the assistant

```ts
// app/settings/actions.ts
'use server';
import { z } from 'zod';
import { serverAction } from 'saydo-js';

export const updateSettings = serverAction(
  { describe: 'Update display name and language', input: z.object({ displayName: z.string().max(60).optional(), language: z.enum(['en', 'es']).optional() }), risk: 'write' },
  async (input) => {
    await db.settings.update(input);
    return { ok: true };
  },
);
```

The UI calls `updateSettings({...})` or `<form action={updateSettings}>` as usual. The id defaults to the export name. Check authorization inside, as with any Server Action.

## Entities

```ts
// entities/post.ts
import 'server-only';
import { entity } from 'saydo-js';

export const Post = entity<PostRecord>({
  type: 'post',
  label: (p) => p.title,
  get: (id, { user }) => db.post.findFirst({ where: { id, authorId: user.id } }),   // the access check
  find: (query, { user }) => db.post.search({ query, authorId: user.id }),          // enables "find my Q4 post"
  version: (p) => p.updatedAt.toISOString(),                                        // optional: refuse if changed since the card
});
```

- `Post.ref()`: the handler receives the record. `Post.ref({ as: 'id' })`: the id. `z.array(Post.ref())`: several.
- `entityRef<PostRecord>('post')`: browser-safe form, for client actions.
- `Post.param()`: binds a route segment (`params: { id: Post.param() }`).
- The model sees handles like `post#1`, never raw ids.

## Pages

```ts
// app/invoices/nav.ts   (Next.js; Vite: pages([...]) in saydo.routes.ts)
import { z } from 'zod';
import { page } from 'saydo-js';

export default page({
  title: 'Invoices',
  aliases: ['billing', 'payments'],
  describe: 'All invoices, filterable by status',
  search: z.object({ status: z.enum(['paid', 'unpaid']).optional() }),
  access: (user) => user.role !== 'guest',
});
```

`hidden: true` hides a page for everyone. Dynamic pages (`/invoices/[id]`) are offered only once params are bound with `params: { id: Invoice.param() }`.

## Workflow (several steps, one approval)

```ts
import { workflow } from 'saydo-js';

export const launchPost = workflow({
  describe: 'Publish a post and email its subscribers',
  input: z.object({ post: Post.ref(), subject: z.string().max(80) }),
  steps: [
    { run: publishPost, input: ({ post }) => ({ post }) },
    { run: notifySubscribers, input: ({ post, subject }) => ({ postId: post.id, subject }), when: ({ post }) => post.public },
  ],
});
```

Its risk is the riskiest step's (raise it with `risk`). On failure, completed steps with `undo` are undone in reverse.

## UI actions and context (client components)

```tsx
'use client';
import { useAction, useSaydoContext, useSaydoGuard } from 'saydo-js/next/client';   // Vite: 'saydo-js/react-router'
import { z } from 'zod';

useAction('share.open', 'Open the share dialog for this post', () => setOpen(true));
useAction('tab.show', 'Switch the settings tab', ({ tab }) => setTab(tab), { input: z.object({ tab: z.enum(['profile', 'billing']) }) });
useAction('theme.dark', 'Switch to dark mode', toDark, { phrases: ['dark mode', 'lights off'] });   // instant, no model call
useSaydoContext('cart', { items: cart.length, total });   // small state the model may read (untrusted)
useSaydoGuard(form.isDirty);                               // AI navigation waits while there are unsaved changes
```

UI actions run without confirmation, so they must not change server data.

## Existing client mutation or API route

```ts
// capabilities/shared.ts: no handler, so it is safe to import in the browser
export const publishPost = action({
  id: 'posts.publish',
  describe: 'Publish a post',
  input: z.object({ post: entityRef<PostRecord>('post') }),
  risk: 'write',
  entry: '/posts/[id]',            // where the component that implements it lives
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
import { withGrant } from 'saydo-js/next/server';
export const POST = withGrant(publishPost, handler, { match: ({ body, args }) => body.id === args.post.id });
```

## Markup attributes

| Attribute | Effect |
|---|---|
| `data-saydo-private` | Never seen or touched (subtree). |
| `data-saydo="off"` | Visible but not operable. |
| `data-saydo="Publishes the post"` | Describes an element; in `'annotated'` mode, allows it. |
| `data-saydo-risk="read\|reversible\|write\|destructive\|never"` | Risk of an element or a whole form. |
| `data-saydo-untrusted` | User-generated content: readable as untrusted data, nothing inside is operable. |
| `data-saydo-context="Invoice INV-1042"` | Labels a row so repeated buttons are not confused. |

## External tools

```ts
import { aiTools, mcp, fromOpenAPI, fromTRPC } from 'saydo-js/server';

tools: [
  mcp({ url: 'https://mcp.example.com/mcp', prefix: 'crm', risk: { search_contacts: 'read' } }),   // needs npm i @ai-sdk/mcp
  aiTools({ weather }, { risk: 'read', trusted: true }),                                            // trusted: your own code
  fromOpenAPI('./openapi.json', { include: ['listInvoices', 'refundInvoice'], methods: { GET: 'read' }, forwardCookies: true }),
  fromTRPC(appRouter, { caller: (ctx) => appRouter.createCaller({ user: ctx.user }), queries: 'read' }),
]
```

Unmapped tools are `destructive`. Descriptions and results from MCP, OpenAPI and AI SDK tools count as third-party text unless `trusted: true`.

## Effects a handler can return

`navigate('/path')` (internal paths only), `refresh()`, `toast('message')`, `invalidate('posts', 'tags')` (with `onInvalidate` on the provider).
