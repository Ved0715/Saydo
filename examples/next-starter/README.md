# next-starter

A Next.js app with [Saydo](https://github.com/Ved0715/Saydo) wired in. Press **⌘K** (Ctrl K) anywhere.

```bash
npm run dev        # works without an API key (deterministic mock planner)
```

For a real model, add `ANTHROPIC_API_KEY=…` to `.env.local` (any AI SDK model works; see `saydo.config.ts`).
For `npm start`, set `SAYDO_SECRET` to 32+ random characters.

## Where things live

| File | What it does |
|---|---|
| `saydo.config.ts` | Model, user, and what the assistant may see, know and do |
| `app/layout.tsx` | `<SaydoProvider>`: the ⌘K assistant on every page |
| `app/api/saydo/route.ts` | The assistant endpoint (one line) |
| `capabilities/*.ts` | Your actions, `action({ … })`; the file path is the id |
| `saydo.capabilities.json` | Generated lockfile of everything the assistant can do; commit it |

Docs: [github.com/Ved0715/Saydo](https://github.com/Ved0715/Saydo#readme). A full example app: [examples/next-demo](https://github.com/Ved0715/Saydo/tree/main/examples/next-demo).
