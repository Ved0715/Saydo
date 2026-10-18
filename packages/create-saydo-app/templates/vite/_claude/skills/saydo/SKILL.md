---
name: saydo
description: Build with Saydo (npm package saydo-js), the AI-native framework for React and Next.js. Use when adding the in-app AI assistant to a Next.js, Vite or React app; writing actions, entities, pages or UI actions; editing saydo.config.ts; choosing an action's risk; hiding data from the model; connecting MCP, OpenAPI, tRPC or AI SDK tools; setting up stores, passkeys, conversations or outside agents; or fixing a Saydo error.
---

# Saydo

Saydo lets an app's users ask for things in plain words ("rename this post to Q4 Roadmap") and the app does them. The assistant can navigate, read the visible page, operate its elements, and call actions the developer declares. **Risk is declared by the developer and enforced on the server**: anything consequential waits for the user's click on a confirmation card built from the exact arguments that will run. The model proposes; it can never approve.

- npm package: `saydo-js`. Every import path starts with `saydo-js` (`saydo-js/next`, `saydo-js/server`, …). The brand and file names say "saydo".
- Version this skill describes: 0.1.x. If something here disagrees with `node_modules/saydo-js/README.md`, the README wins.

## Rules for agents working in a Saydo app

1. **Declare risk honestly.** `read` (looks only), `reversible` (needs an `undo`), `write`, `destructive` (the default when omitted), `never` (the assistant may only point the user to the page). Never set a lower risk just to skip a confirmation; ask the user if unsure.
2. **Server code stays server-only.** Files with a `handler`, database access or entities start with `import 'server-only';`. Client components import only handler-less declarations (`entityRef`, client actions).
3. **Authorize inside handlers, as with any endpoint.** `ctx.user` is the signed-in user; entity `get(id, { user })` is the access check for records.
4. **Never build confirmation dialogs, tool schemas or prompts yourself.** Saydo generates them from the declarations. Use `confirm: { view }` only to customize the card's wording.
5. **Hide, don't hope.** Sensitive data goes in `hide` in `saydo.config.ts`, or `data-saydo-private` in markup. Never rely on instructions to keep the model away from something.
6. **Commit `saydo.capabilities.json`.** It records every action and its risk. Builds with `CI=true` fail when it is stale. Regenerate it with `npm run dev` or a local `npm run build`, then review the diff.
7. **After changes, verify** (see Checking your work).

## Where things go in an app

| File | Purpose |
|---|---|
| `saydo.config.ts` | All configuration, grouped by question. See [references/configuration.md](references/configuration.md). |
| `capabilities/**/*.ts` | Actions. The path becomes the id: `capabilities/posts/archive.ts` is `posts.archive`. |
| `entities/*.ts` | Records the assistant refers to (`Post.ref()`), each with its access check. |
| `app/**/nav.ts` (Next) or `saydo.routes.ts` (Vite) | Optional page titles, aliases, URL params and per-page access. |
| `app/api/saydo/route.ts` | `export { POST } from 'saydo-js/next/route';` (Vite: the `saydo()` plugin serves it). |
| `next.config.ts` | `export default withSaydo({...})` from `saydo-js/next`. |
| root layout | `<SaydoProvider>` from `saydo-js/next/client` (Vite: `saydo-js/react-router`). |
| `saydo.capabilities.json` | Generated lockfile. Commit it. |
| `.saydo/` | Generated registry. Gitignored. |

## What to do for common requests

| The user wants the assistant to… | Do this |
|---|---|
| open pages | Nothing. Pages are discovered. Add `nav.ts` with `title` and `aliases` to improve matching. |
| open one record (`/posts/[id]`) | `page({ params: { id: Post.param() } })` in that page's `nav.ts`, plus a `Post` entity. |
| change filters held in the URL | `search: z.object({...})` in `nav.ts`. Undeclared query params are rejected. |
| click buttons and fill forms on the page | Nothing (the default). Annotate risky elements with `data-saydo-risk`, and use `data-saydo-untrusted` around user-generated content. |
| call server logic | `action({ describe, input, risk, handler })` in `capabilities/`. |
| reuse a Server Action the UI already calls | Wrap it with `serverAction(def, fn)` in its `'use server'` file. |
| reuse a client mutation or API route | A handler-less `action` plus `useCapability` in a component, and `withGrant` on the route. |
| open a dialog, switch a tab, toggle a theme | `useAction(id, describe, fn)` in the component. Add `phrases` for instant, model-free triggers. |
| do several steps as one ("publish and notify") | `workflow({ steps })`. One confirmation, compensation on failure. |
| answer "how do I…" | `knowledge.docs` in config. A guide is also built from pages and actions automatically. |
| use an MCP server, OpenAPI spec, tRPC router or AI SDK tool | `tools: [mcp(...), fromOpenAPI(...), fromTRPC(...), aiTools(...)]`. They default to `destructive` until mapped. |
| never see something | `hide: { routes, actions, fields, selectors, context }` or `data-saydo-private`. |
| be usable by Claude, ChatGPT or Cursor from outside | `expose: { external: true }` on actions, `agents` in config, and the MCP route and approval page. |

Code for all of these: [references/actions-and-ui.md](references/actions-and-ui.md). Full setups (existing apps, production, stores, passkeys, conversations, agents): [references/recipes.md](references/recipes.md).

## Writing an action (the core loop)

```ts
// capabilities/posts.ts
import 'server-only';
import { z } from 'zod';
import { action, navigate, CapabilityError } from 'saydo-js';
import { Post } from '@/entities/post';

export const archivePost = action({
  describe: 'Archive a post',                       // what it does, for the model: specific, no overlap with others
  input: z.object({ post: Post.ref() }),            // the handler receives the record, already access-checked
  risk: 'reversible',
  handler: async ({ post }, ctx) => {
    if (post.archived) throw new CapabilityError('precondition_failed', 'That post is already archived.');
    await db.post.update({ where: { id: post.id }, data: { archived: true } });
    return { result: { id: post.id }, effects: [navigate('/posts')] };
  },
  undo: async ({ post }) => db.post.update({ where: { id: post.id }, data: { archived: false } }),
});
```

- `describe` is what the model reads to choose the action. Overlapping descriptions cause wrong picks (`npx saydo doctor` flags them).
- Throw `CapabilityError(status, hint)` for expected failures. The hint is what the model sees; raw exception text never reaches it.
- Return `{ result, effects }`. Effects: `navigate(href)`, `refresh()`, `toast(message)`, `invalidate(...keys)`. The page refreshes on its own after any successful write.
- Filter-shaped destructive inputs (`{ status: 'draft' }` instead of a list) need `blastRadius: (input, { user }) => count`, so bulk changes get step-up.

## Checking your work

```bash
npx saydo doctor                       # setup check, plus overlapping action descriptions
npx saydo inspect /posts/1             # exactly which tools and risks the model gets on that page
npx saydo ask "archive this post" --route /posts/1   # try a request against the dev server (never approves)
npx saydo eval                         # golden cases from saydo.evals.json
CI=true npm run build                  # fails if saydo.capabilities.json is stale
```

In development, the ⌘K palette also has **What the AI sees**. Errors and fixes: [references/troubleshooting.md](references/troubleshooting.md).
