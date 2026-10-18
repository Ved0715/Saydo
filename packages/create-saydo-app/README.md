# create-saydo-app

Create a React or Next.js app with an AI assistant built in, using [Saydo](https://www.npmjs.com/package/saydo-js). Your users say what they want; the app does it, and anything consequential waits for their click.

```bash
npx create-saydo-app my-app
cd my-app && npm run dev        # open http://localhost:3000 and press ⌘K (Ctrl K)
```

It works right away without an API key: a built-in demo planner understands everyday phrasing ("take me to billing", "start a post titled Launch Notes"). Add a key when you want a real model.

## What you get

A working app, not an empty shell:

- **A ⌘K assistant** that can open any page, read the visible screen, and fill fields and press buttons the way a user would.
- **Example actions** across the risk levels Saydo enforces: a lookup that runs at once, an archive with Undo, a create that asks first, and a delete that shows the exact records before anything happens.
- **Records the assistant can't invent:** a `Post` entity, so "delete this post" means *this* post, checked against the signed-in user.
- **A Server Action** shared by a form and the assistant.
- **Conversation history**, an MCP endpoint for outside agents (off until you configure it), and an approval page.
- **An agent skill** in `.claude/skills/saydo` and an `AGENTS.md`, so Claude Code, Cursor and other coding agents know how to build with Saydo from the first prompt.
- **A reviewed safety lockfile** (`saydo.capabilities.json`) that lists every action and its risk.

## Templates

| Template | Command | Stack |
|---|---|---|
| `next` (default) | `npx create-saydo-app my-app` | Next.js 16 App Router, React 19, TypeScript |
| `vite` | `npx create-saydo-app my-app --template vite` | Vite, React Router, a small Node production server |

```
my-app/                       (next template)
├─ app/
│  ├─ layout.tsx              <SaydoProvider> around the app
│  ├─ api/saydo/route.ts      the assistant endpoint (one line)
│  ├─ posts/…, billing/…      pages, with optional nav.ts titles and aliases
│  └─ settings/actions.ts     a Server Action the assistant can call too
├─ capabilities/posts.ts      actions: create, archive (undo), delete (confirm)
├─ entities/post.ts           records the assistant may refer to, with the access check
├─ saydo.config.ts            model, user, store, and what the assistant knows and must not see
├─ saydo.capabilities.json    every action and its risk (commit it)
├─ .claude/skills/saydo/      the agent skill
└─ AGENTS.md
```

## Options

| Option | What it does |
|---|---|
| `--template next\|vite` | Pick the stack (asks when interactive). |
| `--pm npm\|pnpm\|yarn\|bun` | Package manager. Default: the one you ran it with. |
| `--install` | Install dependencies right away. |
| `--yes` | Accept the defaults without asking (good for CI and scripts). |

## Next steps

1. **Use a real model:** put `ANTHROPIC_API_KEY=…` in `.env.local`. Any [AI SDK](https://ai-sdk.dev/providers) provider works: change `model` in `saydo.config.ts`.
2. **Connect your auth:** return your signed-in user from `getUser` in `saydo.config.ts`.
3. **Add your own actions** in `capabilities/`: a typed function and a risk level. Saydo builds the tool, the confirmation card and the receipt.
4. **Decide what it knows and what it must never see:** the `knowledge` and `hide` groups in `saydo.config.ts`.
5. **Before production:** set `SAYDO_SECRET` (`openssl rand -hex 32`) and a durable approval store (Postgres, Redis or Firestore).

Working with a coding agent? Ask it to "add a Saydo action that…". The bundled skill tells it the rules, the APIs and how to check its work (`npx saydo doctor`, `npx saydo inspect /page`).

## Already have an app?

```bash
npx saydo-js init --install     # Next.js App Router or Vite + React Router
```

## Requirements

Node.js 22 or newer.

## Links

- Framework and full documentation: [saydo-js on npm](https://www.npmjs.com/package/saydo-js) · [README on GitHub](https://github.com/Ved0715/Saydo#readme)
- Source, issues and contributing: [github.com/Ved0715/Saydo](https://github.com/Ved0715/Saydo)
- License: MIT
