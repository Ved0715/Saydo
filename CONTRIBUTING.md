# Contributing to Saydo

Thanks for helping. This guide gets you from a fresh clone to a merged pull request. If anything here is unclear or out of date, that is a bug too: open an issue.

- [Quick start](#quick-start)
- [What lives where](#what-lives-where)
- [How a request flows](#how-a-request-flows)
- [Common changes, step by step](#common-changes-step-by-step)
- [Tests](#tests)
- [Rules every change follows](#rules-every-change-follows)
- [Pull requests](#pull-requests)
- [Releases](#releases)

## Quick start

You need Node 22 or newer and pnpm 10 (`corepack enable` gives you the right pnpm).

```bash
git clone https://github.com/Ved0715/Saydo.git && cd Saydo
pnpm install
pnpm check            # typecheck, all tests, build, export check: what CI runs first
```

Then try it:

```bash
pnpm demo             # Next.js example at http://localhost:3000, press ⌘K
pnpm demo:react       # Vite + React Router example
pnpm site             # the website and its playground
```

No API key is needed: without one, everything runs on the deterministic mock planner. To use a real model, put `ANTHROPIC_API_KEY=…` in `examples/next-demo/.env.local`.

Useful while working:

| Command | What it does |
|---|---|
| `pnpm test:watch` | Re-runs tests as you edit. |
| `pnpm vitest run packages/saydo/test/engine.test.ts` | One file. Add `-t "name"` for one test. |
| `pnpm typecheck` | Types only, fast. |
| `pnpm build` | Builds `packages/saydo/dist` (esbuild, then `.d.ts`). |
| `pnpm templates` | Copies the starters (`examples/*-starter`) into the `create-saydo-app` templates. Run it after changing a starter. |
| `pnpm test:firestore` | Store contract tests against the real Firestore emulator (needs Java). CI runs these on every push. |

The Redis contract tests start a throwaway `redis-server` when one is installed (`brew install redis`, `apt install redis-server`) and are skipped otherwise. CI always runs them.

## What lives where

```
packages/saydo/            the framework, published to npm as "saydo-js"
  src/core/                runs anywhere (Node, edge, browser-safe parts)
    engine.ts              the heart: tools, the agent loop, consent tiers, grants, receipts
    config.ts              the public, grouped saydo.config.ts shape (SaydoConfig)
    handler.ts             HTTP: the route handler, limits, streaming, normalizeConfig()
    capability.ts          action() / defineCapability, serverAction, effects
    entity.ts, route.ts    entities (Post.ref()) and page declarations
    policy.ts              risk → tier, annotations for MCP/WebMCP
    grants.ts              approval stores: memory, Postgres, Redis (+ the GrantStore contract)
    threads.ts, firestore.ts   conversation stores, Firestore stores
    limits.ts              rate-limit and budget counters (memory, Redis)
    guide.ts               the "how do I…" guide built from pages and actions
    workflow.ts            workflow(): composed actions
    sources.ts             mcp(), aiTools(), fromOpenAPI(), fromTRPC()
    ai-sdk.ts, planner.ts  the AI SDK planner, the mock planner, replayPlanner
    mcp.ts, webauthn.ts, audit.ts, seal.ts, lockfile.ts, fastpath.ts, …
    protocol.ts, types.ts  the wire format and shared types (mirrors SPEC.md)
  src/react/               the browser runtime and React bindings
    runtime.ts             SaydoRuntime: requests, streaming, effects, the instant path
    provider.tsx, hooks.ts, ui.tsx, page.ts (reads the visible page), webmcp.ts, …
  src/next/                withSaydo(), the App Router scanner and registry generator, route exports
  src/vite/                the Vite plugin and Node adapters
  src/dom/                 framework-free client and UI (saydo-js/dom)
  src/cli/                 npx saydo: init, ask, inspect, doctor, eval, …
  src/*.ts                 one file per public entry point (saydo-js, saydo-js/server, …)
  test/                    vitest suites (see Tests)
packages/create-saydo-app/ npx create-saydo-app; templates/ are generated from the starters
examples/next-starter/     the "next" template: one page explaining Saydo and how to set it up
examples/vite-starter/     the "vite" template, the same for Vite + React Router
examples/next-demo/        Next.js App Router demo that exercises most features
examples/vite-demo/        Vite + React Router demo
site/                      the website, a Next.js app built with Saydo
SPEC.md                    the protocol; README.md the user docs; plan/ the design notes
```

Public entry points are listed in `packages/saydo/package.json` under `exports`. Each points at a small file in `src/` that re-exports from the folders above. A new public export needs both an `exports` entry and a line in `scripts/build.mjs`, and `scripts/check-exports.mjs` (run in CI) fails if they drift apart.

## How a request flows

1. **Browser.** `SaydoRuntime.send(text)` first tries the instant path: declared phrases, "undo", "go back", page names. Otherwise it POSTs `{ type: 'message', text, state, client, stream: true }`, where `client` describes the route, the mounted actions and a snapshot of the visible page.
2. **Handler** (`core/handler.ts`). It checks same-origin, JSON and the body size, resolves the user, applies rate limits and budgets, then calls `engine.handle(…)`. With `stream: true` it answers newline-delimited JSON: `step` and `text` events, then one `result`.
3. **Engine** (`core/engine.ts`, `processRequest` → `run`):
   - It decrypts the conversation state.
   - It builds the tool list (`buildTools`) from routes, actions, page elements, the guide and clarifying questions, all filtered by `can`, `hide` and exposure.
   - It asks the planner for the next step. The planner only proposes calls; it never executes anything.
4. **Each call** (`processCall`). The engine validates the input, resolves entity references through your `get` (fresh access checks), computes the tier on the server (`prepareCapability`: risk, blast radius, taint, the `authorize` policy), then either runs the call, stages a single-use grant behind a confirm card, or dispatches it to the browser.
5. **Response.** Receipts go back into the history, effects (`navigate`, `refresh`, `invalidate`, `toast`) go to the browser, and the state is sealed again or saved to the conversation store.

`SPEC.md` describes the same flow as a protocol. When you change message shapes, change both.

## Common changes, step by step

**A new configuration option**

1. Add it to the right group in `SaydoConfig` (`core/config.ts`) with a one-line doc comment that says what it does and its default.
2. Map it in `normalizeConfig` (`core/handler.ts`) and pass it to `createEngine` (`EngineOptions` in `core/engine.ts`), or use it in the handler.
3. Test it through `createHandler` (the public shape), not only through the engine.
4. Document it in the README configuration tables (§2). If you moved or renamed an option, add the old name to `configWarnings` so users get a pointer.

**A new built-in tool for the model** (like `app_guide` or `ask_user`)

1. Add a constant next to `GUIDE_TOOL`, a `Target` kind, the tool definition in `buildTools`, and the handling in `processCall`.
2. Give it a progress label in `announceStep`. If its successful receipts are noise for users, add it to `QUIET_TOOLS` in `react/runtime.ts`.
3. Teach the mock planner (`core/planner.ts`) to use it, so demos and tests exercise it without a model.

**A new store** (approvals, conversations or limits)

1. Implement the interface: `GrantStore` (`core/grants.ts`), `ThreadStore` (`core/threads.ts`) or `LimitStore` (`core/limits.ts`). The atomicity rules are in each interface's doc comment.
2. Run the shared contract suite on it: `grantStoreContract` / `threadStoreContract` in `test/contracts.ts` (see `test/stores.test.ts`). A store that does not pass it is not safe to ship.

**A new action source** (like `mcp()`)

Add it to `core/sources.ts` and build capabilities with `jsonCapability`. Unmapped tools must default to `destructive`. Third-party descriptions go through `thirdParty()`, and results are untrusted unless the developer passes `trusted: true`.

**UI changes**

The React UI lives in `react/ui.tsx` and the framework-free one in `dom/index.ts`; keep the two in step. Styles are one string in `react/styles.ts` using `--saydo-*` variables. Every visible string comes from `react/strings.ts`, so it can be translated.

## Tests

All tests are in `packages/saydo/test` and run with vitest. Files ending in `.tsx`, or starting with `// @vitest-environment jsdom`, run in a browser-like DOM.

The helpers in `test/fixtures.ts` make most tests a few lines long:

```ts
import { alice, call, client, message, ok, say, setup } from './fixtures';

it('archives the post on screen', async () => {
  // A scripted "model": first it calls a tool, then it answers.
  const { engine, db } = setup([call('posts_archive', { post: 'post#1' }), say('Archived.')]);
  ok(await engine.handle(message('archive it', undefined, client({ route: '/posts/p2' })), alice));
  expect(db.posts.get('p2')!.archived).toBe(true);
});
```

- `setup(script, engineOptions)`: an engine over a small in-memory blog (`makeDb`, `makeApp`) with a scripted planner. `plannerCalls` records what the model was shown.
- `call(tool, args)` / `say(text)`: script steps. A step can also be a function of the planner input.
- `alice`, `bob`: two users, for checking that nothing leaks between them.
- `test/contracts.ts`: the store contract suites.
- `test/firestore-fake.ts`: an in-memory Firestore with real transaction semantics.

What we test for every change:

- **The happy path and the refusal path.** For anything near consent, add a test where a "compromised" model asks for the dangerous thing and nothing runs.
- **Users stay apart.** If it stores or reads anything per user, test that `bob` cannot see or change `alice`'s.
- **The public surface.** If users configure it, one test goes through `createHandler` or the React provider.

## Rules every change follows

These are what make Saydo safe to put on a write path. A pull request that breaks one will be asked to change, however useful it is.

1. **Risk is decided on the server, from the developer's declarations.** Never from the model, the browser or a third-party annotation. Unspecified risk is `destructive`.
2. **Friction can be added, never removed.** Policies, taint and step-up may raise a tier; nothing lowers one below what the developer declared.
3. **The card shows what will run.** Confirmation views are built from the stored, validated arguments, and approval sends only the grant id.
4. **Untrusted text stays data.** Page content, entity labels, tool results and third-party descriptions reach the model marked as untrusted, and raw exception text never does.
5. **Fails with a fix.** Every error status and warning tells the developer what to do (`fix`), and the unit tests check that.
6. **No egress of our own.** The framework talks only to the developer's model provider and the sources they configure.
7. **Document what you add.** README for users, `SPEC.md` for message shapes, and a short note in `plan/HARDENING.md` for anything security-relevant.

Code style: match the code around you. Two-space indentation, single quotes, named exports, and short doc comments that say *why*. Keep dependencies out of the runtime; `zod` is the only one.

## Pull requests

1. Open an issue first for anything larger than a fix, so we can agree on the shape before you write it.
2. Branch from `main`, keep the change focused, and run `pnpm check`.
3. If you changed an example, run `pnpm templates`, and if you changed actions in an example, commit its regenerated `saydo.capabilities.json`.
4. Sign off your commits (`git commit -s`): the [Developer Certificate of Origin](https://developercertificate.org/).
5. Changes to the protocol (`SPEC.md`: anything with MUST, SHOULD or MAY, or a message shape) follow the RFC process in [IP-POLICY.md](IP-POLICY.md).

Security issues: please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Releases

Maintainers release from CI:

1. Bump the version in `packages/saydo/package.json` and `packages/create-saydo-app/package.json` (they stay equal), then run `pnpm templates`.
2. Commit, then tag and push: `git tag v0.2.0 && git push --tags`.
3. The release workflow type-checks, tests, builds, checks that the tag matches both versions, and publishes both packages with npm provenance.
