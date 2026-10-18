# vite-starter

A React app (Vite + React Router) with [Saydo](https://github.com/Ved0715/Saydo) wired in. Press **⌘K** (Ctrl K) anywhere.

```bash
npm run dev        # works without an API key (deterministic mock planner)
npm run build && SAYDO_SECRET=$(openssl rand -hex 32) npm start   # production server
```

For a real model, export `ANTHROPIC_API_KEY=…` (any AI SDK model works; see `saydo.config.ts`).

## Where things live

| File | What it does |
|---|---|
| `saydo.config.ts` | Model, user, and what the assistant may see, know and do |
| `saydo.routes.ts` | The pages the assistant may open (React Router paths) |
| `vite.config.ts` | `saydo()` plugin: discovers everything and serves `/api/saydo` in dev |
| `capabilities/*.ts` | Your actions, `action({ … })`; the file path is the id |
| `server.ts` | Production server (static files + the Saydo endpoint) |
| `saydo.capabilities.json` | Generated lockfile of everything the assistant can do; commit it |

Docs: [github.com/Ved0715/Saydo](https://github.com/Ved0715/Saydo#readme). A full example app: [examples/vite-demo](https://github.com/Ved0715/Saydo/tree/main/examples/vite-demo).
