---
name: saydo-contributing
description: Work on the Saydo framework itself (this monorepo: packages/saydo published as saydo-js, create-saydo-app, the examples and the site). Use when fixing a bug, adding a feature, option, store, tool or UI to Saydo, writing its tests, updating its docs or SPEC, or preparing a release.
---

# Working on Saydo

Read `CONTRIBUTING.md` first. It has the full repo map, the request flow, step-by-step recipes and the test helpers. This skill is the short version an agent needs to start safely.

## Commands

```bash
pnpm install
pnpm check                      # typecheck + all tests + build + export check (run before saying "done")
pnpm vitest run packages/saydo/test/<file>.test.ts -t "<name>"
pnpm templates                  # after changing anything in examples/ (templates are generated from them)
pnpm demo | pnpm demo:react | pnpm site
```

CI (GitHub Actions) also runs: Node 22 and 24, the real Firestore emulator, builds of both examples and the site with `CI=true`, and an `npx create-saydo-app` install from packed tarballs.

## Where to change things

| Change | Files |
|---|---|
| Agent behavior, tools, consent tiers, grants | `packages/saydo/src/core/engine.ts` |
| A config option | `src/core/config.ts` (public `SaydoConfig`), then `normalizeConfig` in `src/core/handler.ts`, then `EngineOptions` in `engine.ts`; moved keys go in `configWarnings` |
| HTTP, limits, streaming, identity | `src/core/handler.ts` |
| Browser runtime, instant path, streaming client | `src/react/runtime.ts` |
| React UI / framework-free UI (keep both in step) | `src/react/ui.tsx` / `src/dom/index.ts`; styles in `src/react/styles.ts`; strings in `src/react/strings.ts` |
| Stores | `src/core/grants.ts`, `threads.ts`, `firestore.ts`, `limits.ts`; run `test/contracts.ts` on any new store |
| Tool sources | `src/core/sources.ts` |
| Next.js / Vite integration | `src/next/`, `src/vite/` |
| A public export | `packages/saydo/package.json` `exports` + `scripts/build.mjs` + a file in `src/` (checked by `scripts/check-exports.mjs`) |
| The app-developer skill | `packages/saydo/skill/` (ships in the npm package and the templates; keep it in sync with the README) |

## Non-negotiable rules

1. Risk is decided on the server from developer declarations, never from the model, the browser or third-party annotations. Unspecified risk is `destructive`.
2. Friction can be added (policy, taint, step-up), never removed.
3. Confirmation cards are built from stored, validated arguments; approval sends only the grant id.
4. Untrusted text (page content, entity labels, tool results, third-party descriptions) reaches the model marked as untrusted; raw exception text never does.
5. Every error and warning carries a `fix`.
6. No network egress except the developer's model provider and configured sources. The only runtime dependency is `zod`.
7. Document what you add: README (users), `SPEC.md` (message shapes), `plan/HARDENING.md` (security), and `packages/saydo/skill/` when developers or their agents need to know it.

## Testing pattern

```ts
import { alice, bob, call, client, message, ok, say, setup } from './fixtures';
const { engine, db, plannerCalls } = setup([call('posts_archive', { post: 'post#1' }), say('Archived.')], { /* EngineOptions */ });
ok(await engine.handle(message('archive it', undefined, client({ route: '/posts/p2' })), alice));
```

Test the refusal path (a scripted model asking for the dangerous thing must not get it), that `bob` cannot reach `alice`'s data, and the public surface through `createHandler` or the provider.

## Commits and releases

Plain commit messages, signed off (`git commit -s`). Releases: bump both package versions together, run `pnpm templates`, tag `vX.Y.Z`; the release workflow publishes.
