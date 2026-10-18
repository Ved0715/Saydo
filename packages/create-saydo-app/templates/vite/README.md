# {{name}}

An AI-native React app (Vite + React Router) built with [Saydo](https://www.npmjs.com/package/saydo). Press **⌘K** (Ctrl K) anywhere.

```bash
npm run dev        # works without an API key (deterministic mock planner)
npm run build && SAYDO_SECRET=$(openssl rand -hex 32) npm start   # production server
```

For a real model, export `ANTHROPIC_API_KEY=…` (any AI SDK model works; see `saydo.config.ts`).

## Try

- “take me to settings”
- On Profile: “fill name with Ada Lovelace”, then “click Save profile” — no Saydo code on that page at all
- On Settings: “switch to dark mode” — a one-line `useAction`
- “send feedback saying the new palette is great” — a server action in `capabilities/feedback.ts`, confirmed first

## Where things live

| File | What it does |
|---|---|
| `vite.config.ts` | `saydo()` plugin: discovers everything and serves `/api/saydo` in dev |
| `saydo.routes.ts` | The pages the assistant may open (React Router paths) |
| `saydo.config.ts` | Model, user, what the assistant may see and do, external tools |
| `capabilities/*.ts` | Server actions for the assistant, file path = id |
| `server.ts` | Production server (static files + the Saydo endpoint) |
