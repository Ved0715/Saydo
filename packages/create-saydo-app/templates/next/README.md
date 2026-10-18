# {{name}}

An AI-native Next.js app built with [Saydo](https://www.npmjs.com/package/saydo). Press **⌘K** (Ctrl K) anywhere.

```bash
npm run dev        # works without an API key (deterministic mock planner)
```

For a real model, add `ANTHROPIC_API_KEY=…` to `.env.local` (any AI SDK model works; see `saydo.config.ts`).
For `npm start`, set `SAYDO_SECRET` to 32+ random characters.

## Try

- “take me to billing” — every page is navigable, no code needed
- “start a new post titled Launch Notes” — a declared action (`capabilities/posts.ts`), confirmed first
- On a post: “archive this” (undo toast), “delete this post” (destructive confirm), “publish this post”
- On Settings: “set display name to Ada”, then “click Save settings” — the assistant uses the page like you do
- “convert 49 USD to INR” — an AI SDK tool plugged in via `saydo.config.ts` (needs a real model)

## Where things live

| File | What it does |
|---|---|
| `saydo.config.ts` | Model, user, what the assistant may see and do, external tools |
| `capabilities/*.ts` | Server actions for the assistant (`action({ … })`), file path = id |
| `app/settings/actions.ts` | `serverAction(…)`: one function for your form *and* the assistant |
| `app/**/nav.ts` | Optional page metadata: titles, aliases, URL state, entity params |
| `entities/*.ts` | Typed records the assistant can refer to safely (`post#1`) |
| `saydo.capabilities.json` | Generated lockfile of everything the assistant can do — commit it |

Useful commands: `npx saydo ask "take me to billing"`, `npx saydo inspect /settings`, `npx saydo actions`, `npx saydo doctor`.
